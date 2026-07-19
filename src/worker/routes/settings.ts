import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { acmeOrders, changePasswordSchema, cloudflareCredentialInputSchema, cloudflareCredentials, deployments, nginxLogSettingsInputSchema, rebuildActiveSchema, replaceCloudflareCredentialTokenSchema, sessionPolicySchema, sessions, settings, users } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { createLogSettingsDeployment, createRebuildActiveDeployment, enqueueLogSettings, enqueueRebuildActive } from "@/worker/lib/deployment-runner";
import { getActiveLogSettings } from "@/worker/lib/log-settings";
import { renderAccessLogFormat } from "@/worker/lib/nginx-config";
import { jsonValidator } from "@/worker/lib/validator";
import { assertPasswordChangeAllowed, assertRebuildAllowed, clearPasswordChangeFailures, clearRebuildFailures, createSessionToken, hashPassword, hashSessionToken, recordPasswordChangeFailure, recordRebuildFailure, setSessionCookie, verifyPassword } from "@/worker/lib/auth";
import { getRuntimeState } from "@/worker/lib/runtime-state";
import { getSessionPolicy } from "@/worker/lib/session-policy";
import { encryptCloudflareToken } from "@/worker/cloudflare/credentials";
import { getCloudflareDnsProvider } from "@/worker/cloudflare/dns";

export const settingsRoute = new Hono<AppEnv>();

function publicCloudflareCredential(credential: typeof cloudflareCredentials.$inferSelect) {
  const { tokenCiphertext: _ciphertext, tokenIv: _iv, tokenAuthTag: _tag, ...safe } = credential;
  void _ciphertext; void _iv; void _tag;
  return safe;
}

async function verifyCloudflareToken(token: string) {
  try {
    const result = await getCloudflareDnsProvider().verify(token);
    if (result.status !== "active") throw new BusinessError(`Cloudflare API Token 状态为 ${result.status}`, 422, "CLOUDFLARE_TOKEN_INACTIVE");
    return result;
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("Cloudflare API Token 验证失败，请检查权限和网络", 422, "CLOUDFLARE_TOKEN_VERIFY_FAILED", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

settingsRoute.get("/settings/cloudflare", async (c) => {
  const items = await c.get("db").select().from(cloudflareCredentials).orderBy(cloudflareCredentials.createdAt);
  return c.json({ items: items.map(publicCloudflareCredential) });
});

settingsRoute.post("/settings/cloudflare", jsonValidator(cloudflareCredentialInputSchema), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const existing = await db.query.cloudflareCredentials.findFirst({ where: eq(cloudflareCredentials.name, input.name) });
  if (existing) throw new BusinessError("凭据名称已存在", 409, "CLOUDFLARE_CREDENTIAL_NAME_EXISTS");
  const verification = await verifyCloudflareToken(input.token);
  const id = randomUUID();
  const encrypted = await encryptCloudflareToken(id, input.token);
  const now = Date.now();
  const credential = {
    id,
    name: input.name,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    tokenLast4: input.token.slice(-4),
    cloudflareTokenId: verification.tokenId,
    status: verification.status,
    expiresAt: verification.expiresAt,
    visibleZoneCount: verification.zones.length,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  } as const;
  await db.insert(cloudflareCredentials).values(credential);
  return c.json({ credential: publicCloudflareCredential({ ...credential, lastUsedAt: null }) }, 201);
});

settingsRoute.put("/settings/cloudflare/:id/token", jsonValidator(replaceCloudflareCredentialTokenSchema), async (c) => {
  const db = c.get("db");
  const credential = await db.query.cloudflareCredentials.findFirst({ where: eq(cloudflareCredentials.id, c.req.param("id")) });
  if (!credential) throw new BusinessError("Cloudflare 凭据不存在", 404, "CLOUDFLARE_CREDENTIAL_NOT_FOUND");
  const token = c.req.valid("json").token;
  const verification = await verifyCloudflareToken(token);
  const encrypted = await encryptCloudflareToken(credential.id, token);
  const now = Date.now();
  await db.update(cloudflareCredentials).set({
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    tokenLast4: token.slice(-4),
    cloudflareTokenId: verification.tokenId,
    status: verification.status,
    expiresAt: verification.expiresAt,
    visibleZoneCount: verification.zones.length,
    lastVerifiedAt: now,
    updatedAt: now,
  }).where(eq(cloudflareCredentials.id, credential.id));
  const updated = await db.query.cloudflareCredentials.findFirst({ where: eq(cloudflareCredentials.id, credential.id) });
  return c.json({ credential: publicCloudflareCredential(updated!) });
});

settingsRoute.delete("/settings/cloudflare/:id", async (c) => {
  const db = c.get("db");
  const credential = await db.query.cloudflareCredentials.findFirst({ where: eq(cloudflareCredentials.id, c.req.param("id")) });
  if (!credential) return c.body(null, 204);
  const activeOrder = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.cloudflareCredentialId, credential.id), inArray(acmeOrders.cleanupStatus, ["pending", "failed"])),
  });
  if (activeOrder) throw new BusinessError("该凭据仍有订单等待使用或清理", 409, "CLOUDFLARE_CREDENTIAL_IN_USE");
  await db.delete(cloudflareCredentials).where(eq(cloudflareCredentials.id, credential.id));
  return c.body(null, 204);
});

settingsRoute.get("/settings/security/session-policy", async (c) => {
  return c.json({ policy: await getSessionPolicy(c.get("db")) });
});

settingsRoute.patch("/settings/security/session-policy", jsonValidator(sessionPolicySchema), async (c) => {
  const db = c.get("db");
  const policy = c.req.valid("json");
  const now = Date.now();
  await db.insert(settings).values({
    key: "security_session",
    valueJson: JSON.stringify(policy),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: settings.key,
    set: { valueJson: JSON.stringify(policy), updatedAt: now },
  });
  return c.json({ policy });
});

settingsRoute.post("/settings/security/password", jsonValidator(changePasswordSchema), async (c) => {
  const db = c.get("db");
  const auth = c.get("user")!;
  const user = await db.query.users.findFirst({ where: eq(users.id, auth.id) });
  if (!user) throw new BusinessError("管理员不存在", 401, "UNAUTHENTICATED");

  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptId = await assertPasswordChangeAllowed(db, user.id, clientIp);
  const input = c.req.valid("json");
  if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
    await recordPasswordChangeFailure(db, attemptId);
    throw new BusinessError("当前密码错误", 401, "INVALID_CREDENTIALS");
  }

  const currentSession = await db.query.sessions.findFirst({
    where: eq(sessions.idHash, c.get("sessionIdHash")!),
  });
  if (!currentSession) throw new BusinessError("会话已过期", 401, "UNAUTHENTICATED");

  const passwordHash = await hashPassword(input.newPassword);
  const token = createSessionToken();
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, user.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
    tx.insert(sessions).values({
      idHash: hashSessionToken(token),
      userId: user.id,
      expiresAt: currentSession.expiresAt,
      createdAt: now,
      lastSeenAt: now,
    }).run();
  });
  await clearPasswordChangeFailures(db, attemptId);
  setSessionCookie(c, token, currentSession.expiresAt);
  return c.json({ user: { id: user.id, username: user.username } });
});

settingsRoute.get("/settings/logs", async (c) => {
  const db = c.get("db");
  const [active, pending] = await Promise.all([
    getActiveLogSettings(db),
    db.query.deployments.findFirst({
      where: and(eq(deployments.type, "apply_log_settings"), inArray(deployments.status, ["queued", "running"])),
    }),
  ]);
  return c.json({
    active,
    pendingDeploymentId: pending?.id ?? null,
    preview: renderAccessLogFormat(active),
    logRootConfigured: Boolean(process.env.NGINX_LOG_DIR),
  });
});

settingsRoute.put("/settings/logs", jsonValidator(nginxLogSettingsInputSchema), async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new BusinessError("日志设置只允许在 Nginx runtime 中修改", 409, "DEPLOYMENT_UNAVAILABLE");
  const db = c.get("db");
  const pending = await db.query.deployments.findFirst({
    where: and(eq(deployments.type, "apply_log_settings"), inArray(deployments.status, ["queued", "running"])),
  });
  if (pending) throw new BusinessError("已有日志设置任务正在执行", 409, "DEPLOYMENT_ALREADY_RUNNING");
  const deployment = await createLogSettingsDeployment(db, {
    settings: c.req.valid("json"),
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
  });
  if (deployment.status === "queued") void enqueueLogSettings(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

settingsRoute.get("/settings/diagnostics", (c) => {
  const runtime = getRuntimeState();
  return c.json({
    runtime,
    rebuildAvailable: runtime.status === "degraded",
    paths: {
      sqliteConfigured: Boolean(process.env.DB_SQLITE_DIR),
      runtimeConfigured: Boolean(process.env.NGINX_RUNTIME_ROOT),
      logsConfigured: Boolean(process.env.NGINX_LOG_DIR),
    },
  });
});

settingsRoute.post("/settings/diagnostics/rebuild-active", jsonValidator(rebuildActiveSchema), async (c) => {
  const db = c.get("db");
  const idempotencyKey = c.req.header("Idempotency-Key") || randomUUID();
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, idempotencyKey) });
  if (existing) return c.json({ deploymentId: existing.id, statusUrl: `/api/deployments/${existing.id}` }, 202);
  if (getRuntimeState().status !== "degraded") {
    throw new BusinessError("运行配置当前不需要重建", 409, "RUNTIME_NOT_DEGRADED");
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, c.get("user")!.id) });
  if (!user) throw new BusinessError("管理员不存在", 401, "UNAUTHENTICATED");
  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptId = await assertRebuildAllowed(db, user.id, clientIp);
  if (!await verifyPassword(c.req.valid("json").currentPassword, user.passwordHash)) {
    await recordRebuildFailure(db, attemptId);
    throw new BusinessError("当前密码错误", 401, "INVALID_CREDENTIALS");
  }
  await clearRebuildFailures(db, attemptId);
  const deployment = await createRebuildActiveDeployment(db, {
    requestedBy: user.id,
    idempotencyKey,
  });
  if (deployment.status === "queued") void enqueueRebuildActive(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});
