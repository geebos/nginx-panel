import { and, eq, gt, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { configVersions, domains, managerConfigSchema, managerUserHostnames, sessions, users } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { hashSessionToken, SESSION_COOKIE } from "@/worker/lib/auth";
import { isOriginAllowed } from "@/worker/lib/auth-origin";

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

async function loadActiveManagerUserHosts(db: AppEnv["Variables"]["db"]) {
  try {
    const manager = await db.query.domains.findFirst({
      where: and(eq(domains.type, "manager"), isNull(domains.deletedAt)),
    });
    if (!manager?.activeVersionId) return [] as string[];
    const version = await db.query.configVersions.findFirst({
      where: eq(configVersions.id, manager.activeVersionId),
    });
    if (!version) return [] as string[];
    const snapshot = managerConfigSchema.safeParse(JSON.parse(version.snapshotJson));
    if (!snapshot.success) return [] as string[];
    return managerUserHostnames(snapshot.data);
  } catch {
    return [] as string[];
  }
}

export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  // Restore pre-manager policy: mutating requests without Origin are rejected (H1).
  // Non-browser automation must send an allowed Origin (bootstrap or bound host).
  if (!origin) {
    return c.json({ code: "INVALID_ORIGIN", message: "errors:invalidOrigin" }, 403);
  }

  const userHosts = await loadActiveManagerUserHosts(c.get("db"));
  if (!isOriginAllowed(origin, userHosts)) {
    return c.json({ code: "INVALID_ORIGIN", message: "errors:invalidOrigin" }, 403);
  }
  await next();
});
