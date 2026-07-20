import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { deleteCookie, getCookie } from "hono/cookie";
import { Hono } from "hono";
import { loginSchema, sessions, setupAdminSchema, users } from "@/shared/schemas";
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
  db.transaction((tx) => {
    const result = tx.select({ count: count() }).from(users).get();
    if ((result?.count ?? 0) > 0) {
      throw new BusinessError("errors:setupAlreadyCompleted", 409, "SETUP_ALREADY_COMPLETED");
    }
    tx.insert(users).values(user).run();
  });
  const session = await createSession(db, user, true);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user: { id: user.id, username: user.username } }, 201);
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
