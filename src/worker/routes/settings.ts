import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { acmeOrders, changePasswordSchema, cloudflareCredentialInputSchema, cloudflareCredentials, deployments, nginxLogSettingsInputSchema, rebuildActiveSchema, replaceCloudflareCredentialTokenSchema, runtimeStorageSettingsSchema, sessionPolicySchema, sessions, settings, users } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { createDiagnosticNginxTestDeployment, createLogSettingsDeployment, createRebuildActiveDeployment, createReloadManagerTlsDeployment, enqueueDiagnosticNginxTest, enqueueLogSettings, enqueueRebuildActive, enqueueReloadManagerTls } from "@/worker/lib/deployment/runner";
import { getActiveLogSettings } from "@/worker/lib/log-settings";
import { renderAccessLogFormat } from "@/worker/lib/nginx/config";
import { jsonValidator } from "@/worker/lib/validator";
import { assertPasswordChangeAllowed, assertRebuildAllowed, clearPasswordChangeFailures, clearRebuildFailures, createSessionToken, hashPassword, hashSessionToken, recordPasswordChangeFailure, recordRebuildFailure, setSessionCookie, verifyPassword } from "@/worker/lib/auth";
import { getRuntimeState } from "@/worker/lib/runtime/state";
import { getSessionPolicy } from "@/worker/lib/session-policy";
import { encryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";
import { getCloudflareDnsProvider } from "@/worker/lib/cloudflare/dns";
import { validateManagerTlsEnvironment } from "@/worker/lib/runtime/manager-tls";
import { collectRuntimeDiagnostics, getActiveRuntimeConfig } from "@/worker/lib/runtime/diagnostics";
import { cleanupRuntimeStorage, getRuntimeStorageSnapshot } from "@/worker/lib/runtime/storage";

export const settingsRoute = new Hono<AppEnv>();
const execFileAsync = promisify(execFile);

async function getNginxVersion() {
  try {
    const result = await execFileAsync(process.env.NGINX_BIN || "/usr/sbin/nginx", ["-v"], { timeout: 5_000 });
    const output = `${result.stdout}\n${result.stderr}`;
    return output.match(/nginx version:\s*nginx\/([^\s]+)/)?.[1] ?? null;
  } catch (error) {
    const output = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    return output.match(/nginx version:\s*nginx\/([^\s]+)/)?.[1] ?? null;
  }
}

function publicCloudflareCredential(credential: typeof cloudflareCredentials.$inferSelect) {
  const { tokenCiphertext: _ciphertext, tokenIv: _iv, tokenAuthTag: _tag, ...safe } = credential;
  void _ciphertext; void _iv; void _tag;
  return safe;
}

async function verifyCloudflareToken(token: string) {
  try {
    const result = await getCloudflareDnsProvider().verify(token);
    if (result.status !== "active") {
      throw new BusinessError("errors:cloudflareTokenInactive", 422, "CLOUDFLARE_TOKEN_INACTIVE", {
        params: { status: result.status },
      });
    }
    return result;
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("errors:cloudflareTokenVerifyFailed", 422, "CLOUDFLARE_TOKEN_VERIFY_FAILED", {
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
  if (existing) throw new BusinessError("errors:cloudflareCredentialNameExists", 409, "CLOUDFLARE_CREDENTIAL_NAME_EXISTS");
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
  if (!credential) throw new BusinessError("errors:cloudflareCredentialNotFound", 404, "CLOUDFLARE_CREDENTIAL_NOT_FOUND");
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
  if (activeOrder) throw new BusinessError("errors:cloudflareCredentialInUse", 409, "CLOUDFLARE_CREDENTIAL_IN_USE");
  await db.delete(cloudflareCredentials).where(eq(cloudflareCredentials.id, credential.id));
  return c.body(null, 204);
});

settingsRoute.get("/settings/security/session-policy", async (c) => {
  return c.json({ policy: await getSessionPolicy(c.get("db")) });
});

settingsRoute.get("/settings/nginx", async (c) => {
  const [version, storage] = await Promise.all([
    getNginxVersion(),
    getRuntimeStorageSnapshot(c.get("db")),
  ]);
  return c.json({
    nginx: { version },
    paths: {
      configRoot: process.env.NGINX_RUNTIME_ROOT || "/data/nginx",
      staticAllowedRoots: ["/srv/sites"],
    },
    storage,
    health: getRuntimeState(),
  });
});

settingsRoute.patch("/settings/nginx", jsonValidator(runtimeStorageSettingsSchema), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const current = await getRuntimeStorageSnapshot(db, { maxBytes: input.revisionMaxBytes });
  if (input.revisionMaxBytes < current.minimumAllowedBytes) {
    throw new BusinessError(
      "errors:revisionStorageLimitTooLow",
      409,
      "REVISION_STORAGE_LIMIT_TOO_LOW",
      {
        context: { minimumAllowedBytes: current.minimumAllowedBytes },
        details: { minimumBytes: current.minimumAllowedBytes },
        params: { bytes: current.minimumAllowedBytes },
      },
    );
  }
  const now = Date.now();
  await db.insert(settings).values({
    key: "runtime_storage",
    valueJson: JSON.stringify(input),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: settings.key,
    set: { valueJson: JSON.stringify(input), updatedAt: now },
  });
  const storage = await cleanupRuntimeStorage(db);
  return c.json({ storage });
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
  if (!user) throw new BusinessError("errors:unauthenticated", 401, "UNAUTHENTICATED");

  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptId = await assertPasswordChangeAllowed(db, user.id, clientIp);
  const input = c.req.valid("json");
  if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
    await recordPasswordChangeFailure(db, attemptId);
    throw new BusinessError("errors:invalidCredentials", 401, "INVALID_CREDENTIALS");
  }

  const currentSession = await db.query.sessions.findFirst({
    where: eq(sessions.idHash, c.get("sessionIdHash")!),
  });
  if (!currentSession) throw new BusinessError("errors:unauthenticated", 401, "UNAUTHENTICATED");

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
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new BusinessError("errors:deploymentUnavailable", 409, "DEPLOYMENT_UNAVAILABLE");
  const db = c.get("db");
  const pending = await db.query.deployments.findFirst({
    where: and(eq(deployments.type, "apply_log_settings"), inArray(deployments.status, ["queued", "running"])),
  });
  if (pending) throw new BusinessError("errors:deploymentAlreadyRunning", 409, "DEPLOYMENT_ALREADY_RUNNING");
  const deployment = await createLogSettingsDeployment(db, {
    settings: c.req.valid("json"),
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
  });
  if (deployment.status === "queued") void enqueueLogSettings(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

settingsRoute.get("/settings/diagnostics", async (c) => {
  const runtime = getRuntimeState();
  let managerTls: { status: "valid" | "invalid" | "unavailable"; certificate?: ReturnType<typeof validateManagerTlsEnvironment>; error?: string };
  if (process.env.RUNTIME_MODE !== "nginx-manager") {
    managerTls = { status: "unavailable" };
  } else {
    try {
      managerTls = { status: "valid", certificate: validateManagerTlsEnvironment() };
    } catch {
      managerTls = { status: "invalid", error: "Mounted manager certificate is invalid; check expiry, SAN, and private key" };
    }
  }
  return c.json({
    runtime,
    rebuildAvailable: runtime.status === "degraded",
    managerTls,
    ...await collectRuntimeDiagnostics(),
  });
});

settingsRoute.get("/settings/diagnostics/runtime-config", async (c) => {
  const domainId = c.req.query("domainId")?.trim();
  if (!domainId) throw new BusinessError("errors:domainIdRequired", 400, "DOMAIN_ID_REQUIRED");
  return c.json(await getActiveRuntimeConfig(c.get("db"), domainId));
});

settingsRoute.post("/settings/diagnostics/nginx-test", async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") {
    throw new BusinessError("errors:deploymentUnavailable", 409, "DEPLOYMENT_UNAVAILABLE");
  }
  const deployment = await createDiagnosticNginxTestDeployment(c.get("db"), {
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
  });
  if (deployment.status === "queued") void enqueueDiagnosticNginxTest(c.get("db"), deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

settingsRoute.post("/settings/diagnostics/reload-manager-tls", async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") {
    throw new BusinessError("errors:deploymentUnavailable", 409, "DEPLOYMENT_UNAVAILABLE");
  }
  const db = c.get("db");
  const pending = await db.query.deployments.findFirst({
    where: and(eq(deployments.type, "reload_manager_tls"), inArray(deployments.status, ["queued", "running"])),
  });
  if (pending) return c.json({ deploymentId: pending.id, statusUrl: `/api/deployments/${pending.id}` }, 202);
  const deployment = await createReloadManagerTlsDeployment(db, {
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
  });
  if (deployment.status === "queued") void enqueueReloadManagerTls(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

settingsRoute.post("/settings/diagnostics/rebuild-active", jsonValidator(rebuildActiveSchema), async (c) => {
  const db = c.get("db");
  const idempotencyKey = c.req.header("Idempotency-Key") || randomUUID();
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, idempotencyKey) });
  if (existing) return c.json({ deploymentId: existing.id, statusUrl: `/api/deployments/${existing.id}` }, 202);
  if (getRuntimeState().status !== "degraded") {
    throw new BusinessError("errors:runtimeNotDegraded", 409, "RUNTIME_NOT_DEGRADED");
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, c.get("user")!.id) });
  if (!user) throw new BusinessError("errors:unauthenticated", 401, "UNAUTHENTICATED");
  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptId = await assertRebuildAllowed(db, user.id, clientIp);
  if (!await verifyPassword(c.req.valid("json").currentPassword, user.passwordHash)) {
    await recordRebuildFailure(db, attemptId);
    throw new BusinessError("errors:invalidCredentials", 401, "INVALID_CREDENTIALS");
  }
  await clearRebuildFailures(db, attemptId);
  const deployment = await createRebuildActiveDeployment(db, {
    requestedBy: user.id,
    idempotencyKey,
  });
  if (deployment.status === "queued") void enqueueRebuildActive(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});
