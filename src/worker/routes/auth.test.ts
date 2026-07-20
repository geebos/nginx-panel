import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import * as schema from "@/shared/schemas";
import { hashSessionToken } from "@/worker/lib/auth";
import { createErrorHandler } from "@/worker/middleware/error";
import type { AppEnv } from "@/worker/types";
import { authRoute } from "@/worker/routes/auth";

test("revoke all sessions includes the current browser session", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const token = "current-plain-session-token";
  await db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: "unused", createdAt: now, updatedAt: now });
  await db.insert(schema.sessions).values([
    { idHash: hashSessionToken(token), userId: "user-1", expiresAt: now + 86_400_000, createdAt: now, lastSeenAt: now },
    { idHash: "other-session", userId: "user-1", expiresAt: now + 86_400_000, createdAt: now, lastSeenAt: now },
  ]);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/api", authRoute);
  app.onError(createErrorHandler<AppEnv>());

  const response = await app.request("/api/auth/sessions/revoke-all", {
    method: "POST",
    headers: { cookie: `nginx_manager_session=${token}`, origin: "http://localhost:3000" },
  });
  assert.equal(response.status, 204);
  assert.equal(db.select().from(schema.sessions).all().length, 0);
  assert.match(response.headers.get("set-cookie") ?? "", /nginx_manager_session=;/);

  connection.close();
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});
