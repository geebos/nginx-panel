import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import * as schema from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { setCloudflareDnsProvider } from "@/worker/cloudflare/dns";
import { createErrorHandler } from "@/worker/middleware/error";
import { assertLoginAllowed, assertRebuildAllowed, createSession, hashPassword, verifyPassword } from "@/worker/lib/auth";
import { settingsRoute } from "./settings";

test("Cloudflare credential APIs verify and encrypt tokens without returning them", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  setCloudflareDnsProvider({
    verify: async () => ({ tokenId: "token-id", status: "active", expiresAt: null, zones: [{ id: "zone-id", name: "example.com" }] }),
    preflight: async () => [{ id: "zone-id", name: "example.com" }],
    present: async () => ({ zoneId: "zone-id", recordId: "record-id" }),
    cleanup: async () => undefined,
  });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); c.set("user", { id: "user-1", username: "admin" }); await next(); });
  app.route("/api", settingsRoute);
  app.onError(createErrorHandler<AppEnv>());
  const token = "cloudflare-secret-token";
  const created = await app.request("/api/settings/cloudflare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Production DNS", token }),
  });
  assert.equal(created.status, 201);
  const body = await created.text();
  assert.equal(body.includes(token), false);
  assert.equal(body.includes("tokenCiphertext"), false);
  const stored = db.select().from(schema.cloudflareCredentials).get();
  assert.ok(stored);
  assert.equal(stored.tokenLast4, "oken");
  assert.equal(Buffer.from(stored.tokenCiphertext as Uint8Array).includes(Buffer.from(token)), false);
  const listed = await app.request("/api/settings/cloudflare");
  assert.equal(listed.status, 200);
  const listBody = await listed.text();
  assert.equal(listBody.includes(token), false);
  assert.equal(listBody.includes("tokenCiphertext"), false);
  setCloudflareDnsProvider(null);
  connection.close();
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});

test("password change rotates the current session and revokes every old session", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const oldPassword = "old-password-123";
  const newPassword = "new-password-456";
  await db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: await hashPassword(oldPassword), createdAt: now, updatedAt: now });
  await db.insert(schema.sessions).values([
    { idHash: "current-session", userId: "user-1", expiresAt: now + 86_400_000, createdAt: now, lastSeenAt: now },
    { idHash: "other-session", userId: "user-1", expiresAt: now + 86_400_000, createdAt: now, lastSeenAt: now },
  ]);

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("user", { id: "user-1", username: "admin" });
    c.set("sessionIdHash", "current-session");
    await next();
  });
  app.route("/api", settingsRoute);
  app.onError(createErrorHandler<AppEnv>());

  const response = await app.request("/api/settings/security/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword, confirmPassword: newPassword }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /nginx_manager_session=.*HttpOnly.*SameSite=Lax/i);
  const storedUser = db.select().from(schema.users).get();
  assert.ok(storedUser);
  assert.equal(await verifyPassword(oldPassword, storedUser.passwordHash), false);
  assert.equal(await verifyPassword(newPassword, storedUser.passwordHash), true);
  const storedSessions = db.select().from(schema.sessions).all();
  assert.equal(storedSessions.length, 1);
  assert.notEqual(storedSessions[0]?.idHash, "current-session");
  assert.notEqual(storedSessions[0]?.idHash, "other-session");

  connection.close();
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});

test("password change uses an isolated three-failure rate limit bucket", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  await db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: await hashPassword("correct-password-123"), createdAt: now, updatedAt: now });
  await db.insert(schema.sessions).values({ idHash: "current-session", userId: "user-1", expiresAt: now + 86_400_000, createdAt: now, lastSeenAt: now });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("user", { id: "user-1", username: "admin" });
    c.set("sessionIdHash", "current-session");
    await next();
  });
  app.route("/api", settingsRoute);
  app.onError(createErrorHandler<AppEnv>());
  const request = () => app.request("/api/settings/security/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.20" },
    body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-password-456", confirmPassword: "new-password-456" }),
  });

  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await request()).status, 401);
  const blocked = await request();
  assert.equal(blocked.status, 429);
  const body = await blocked.json() as { retryAfterSeconds: number };
  assert.ok(body.retryAfterSeconds > 29 * 60);
  await assertLoginAllowed(db, "admin", "192.0.2.20");
  await assertRebuildAllowed(db, "user-1", "192.0.2.20");

  connection.close();
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});

test("session policy persists valid ranges and only affects newly issued sessions", async () => {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  await db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: "unused", createdAt: now, updatedAt: now });
  const existingExpiry = now + 86_400_000;
  await db.insert(schema.sessions).values({ idHash: "existing-session", userId: "user-1", expiresAt: existingExpiry, createdAt: now, lastSeenAt: now });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); c.set("user", { id: "user-1", username: "admin" }); await next(); });
  app.route("/api", settingsRoute);
  app.onError(createErrorHandler<AppEnv>());

  const defaults = await app.request("/api/settings/security/session-policy");
  assert.equal(defaults.status, 200);
  assert.deepEqual(await defaults.json(), { policy: { standardDays: 1, rememberDays: 30 } });
  const invalid = await app.request("/api/settings/security/session-policy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardDays: 8, rememberDays: 6 }),
  });
  assert.equal(invalid.status, 400);
  const updated = await app.request("/api/settings/security/session-policy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardDays: 3, rememberDays: 45 }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { policy: { standardDays: 3, rememberDays: 45 } });
  assert.equal(db.select().from(schema.sessions).all().find((session) => session.idHash === "existing-session")?.expiresAt, existingExpiry);

  await createSession(db, { id: "user-1" }, false);
  await createSession(db, { id: "user-1" }, true);
  const issued = db.select().from(schema.sessions).all().filter((session) => session.idHash !== "existing-session");
  assert.deepEqual(issued.map((session) => (session.expiresAt - session.createdAt) / 86_400_000).sort((a, b) => a - b), [3, 45]);
  const stored = db.select().from(schema.settings).get();
  assert.equal(stored?.key, "security_session");
  assert.deepEqual(JSON.parse(stored?.valueJson ?? "{}"), { standardDays: 3, rememberDays: 45 });
  connection.close();
});
