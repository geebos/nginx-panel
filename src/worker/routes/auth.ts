import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { deleteCookie, getCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  configVersions,
  deployments,
  domains,
  loginSchema,
  sessions,
  setupAdminSchema,
  users,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import {
  assertLoginAllowed,
  clearLoginFailures,
  createSession,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashSessionToken,
  recordLoginFailure,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "@/worker/lib/auth";
import { BusinessError } from "@/worker/lib/errors";
import { jsonValidator } from "@/worker/lib/validator";
import { requireAuth, requireSameOrigin } from "@/worker/middleware/auth";
import { createManagerDraftFromSetupInTx } from "@/worker/lib/manager/service";
import { assertHostnamesAvailable } from "@/worker/lib/domain/validation";
import { createConfigTestDeployment, runConfigTest } from "@/worker/lib/deployment/config-test";
import { createPublishDeployment, enqueuePublish } from "@/worker/lib/deployment/runner";

function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export const authRoute = new Hono<AppEnv>();

authRoute.use("/setup/admin", requireSameOrigin);
authRoute.use("/auth/login", requireSameOrigin);
authRoute.use("/auth/logout", requireSameOrigin);
authRoute.use("/auth/sessions/revoke-all", requireSameOrigin);

authRoute.get("/setup/status", async (c) => {
  const result = await c.get("db").select({ count: count() }).from(users);
  return c.json({ setupRequired: (result[0]?.count ?? 0) === 0 });
});

authRoute.post("/setup/admin", jsonValidator(setupAdminSchema), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const user = {
    id: randomUUID(),
    username: input.username,
    passwordHash: await hashPassword(input.password),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Preflight hostname availability before writing the admin row so a reserved
  // hostname failure does not permanently complete setup (H2).
  if (input.managerPrimaryHostname) {
    const existingManager = await db.query.domains.findFirst({
      where: eq(domains.type, "manager"),
    });
    await assertHostnamesAvailable(
      db,
      [input.managerPrimaryHostname, ...(input.managerAliases ?? [])],
      existingManager?.id,
    );
  }

  let managerDomainId: string | null = null;
  let managerDraftVersionId: string | null = null;
  let managerSnapshotChecksum: string | null = null;

  // Single transaction: admin + optional manager draft. Failure rolls back both.
  db.transaction((tx) => {
    const result = tx.select({ count: count() }).from(users).get();
    if ((result?.count ?? 0) > 0) {
      throw new BusinessError("errors:setupAlreadyCompleted", 409, "SETUP_ALREADY_COMPLETED");
    }
    tx.insert(users).values(user).run();

    if (input.managerPrimaryHostname) {
      const created = createManagerDraftFromSetupInTx(tx, {
        primaryHostname: input.managerPrimaryHostname,
        aliases: input.managerAliases,
        userId: user.id,
      });
      managerDomainId = created.domainId;
      managerDraftVersionId = created.versionId;
      managerSnapshotChecksum = created.snapshotChecksum;
    }
  });

  // Enqueue root deploy after commit so a deploy failure keeps the draft for Settings retry.
  if (managerDomainId && managerDraftVersionId && managerSnapshotChecksum && process.env.RUNTIME_MODE === "nginx-manager") {
    try {
      const version = await db.query.configVersions.findFirst({
        where: eq(configVersions.id, managerDraftVersionId),
      });
      if (version) {
        const preflight = await createConfigTestDeployment(db, {
          domainId: managerDomainId,
          versionId: version.id,
          requestedBy: user.id,
          idempotencyKey: `setup-manager:${version.id}:test`,
          expectedSnapshotChecksum: version.snapshotChecksum,
        });
        await runConfigTest(db, preflight.id);
        const preflightAfter = await db.query.deployments.findFirst({
          where: eq(deployments.id, preflight.id),
        });
        if (preflightAfter?.status === "succeeded") {
          const deployment = await createPublishDeployment(db, {
            domainId: managerDomainId,
            versionId: version.id,
            requestedBy: user.id,
            idempotencyKey: `setup-manager:${version.id}:deploy`,
            expectedSnapshotChecksum: version.snapshotChecksum,
            preflightDeploymentId: preflight.id,
          });
          void enqueuePublish(db, deployment.id);
        }
      }
    } catch (error) {
      console.error("[setup] manager deploy enqueue failed; draft retained for retry", error);
    }
  }

  const session = await createSession(db, user, true);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({
    user: { id: user.id, username: user.username },
    managerDomainId,
  }, 201);
});

authRoute.post("/auth/login", jsonValidator(loginSchema), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const attemptId = await assertLoginAllowed(db, input.username, clientIp(c.req.raw.headers));
  const user = await db.query.users.findFirst({ where: eq(users.username, input.username) });
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    await recordLoginFailure(db, attemptId);
    throw new BusinessError("errors:invalidCredentials", 401, "INVALID_CREDENTIALS");
  }

  await clearLoginFailures(db, attemptId);
  const session = await createSession(db, user, input.remember);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user: { id: user.id, username: user.username } });
});

authRoute.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c
      .get("db")
      .delete(sessions)
      .where(eq(sessions.idHash, hashSessionToken(token)));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

authRoute.post("/auth/sessions/revoke-all", requireAuth, async (c) => {
  await c.get("db").delete(sessions).where(eq(sessions.userId, c.get("user")!.id));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

authRoute.get("/auth/me", requireAuth, (c) => c.json({ user: c.get("user") }));
