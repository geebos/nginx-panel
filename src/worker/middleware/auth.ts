import { and, eq, gt } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sessions, users } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { hashSessionToken, SESSION_COOKIE } from "@/worker/lib/auth";
import { managerUrl } from "@/worker/lib/runtime-env";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ code: "UNAUTHENTICATED", message: "errors:loginRequired" }, 401);

  const idHash = hashSessionToken(token);
  const db = c.get("db");
  const rows = await db
    .select({
      sessionIdHash: sessions.idHash,
      userId: users.id,
      username: users.username,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, Date.now())))
    .limit(1);
  const auth = rows[0];
  if (!auth) return c.json({ code: "UNAUTHENTICATED", message: "errors:sessionExpired" }, 401);

  c.set("user", { id: auth.userId, username: auth.username });
  c.set("sessionIdHash", auth.sessionIdHash);
  if (Date.now() - auth.lastSeenAt > 60 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: Date.now() }).where(eq(sessions.idHash, idHash));
  }
  await next();
});

export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  let allowed = false;
  try {
    if (origin && process.env.APP_ENV === "development") {
      allowed = ["localhost", "127.0.0.1", "::1"].includes(new URL(origin).hostname);
    } else if (origin) {
      allowed = new URL(origin).origin === managerUrl()?.origin;
    }
  } catch (error) {
    console.error("[auth] failed to validate request origin", error);
    allowed = false;
  }

  if (!allowed) {
    return c.json({ code: "INVALID_ORIGIN", message: "errors:invalidOrigin" }, 403);
  }
  await next();
});
