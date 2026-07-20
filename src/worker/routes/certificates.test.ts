import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { createSnapshot } from "@/worker/lib/snapshot";
import { assertHostnamesMutable } from "@/worker/lib/domain-validation";
import { createErrorHandler } from "@/worker/middleware/error";
import { acmeChallengeRoute, certificatesRoute } from "./certificates";

function fixture() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const config: schema.DomainConfig = {
    schemaVersion: 1,
    primaryHostname: "example.com",
    aliases: ["www.example.com"],
    routes: [],
    headers: [],
    ssl: { enabled: true, provider: "letsencrypt", environment: "staging", email: "admin@example.com", autoRenew: true, forceHttps: false, validation: { method: "http-01" } },
    advanced: { serverSnippet: "" },
  };
  const snapshot = createSnapshot(config);
  db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: "unused", createdAt: now, updatedAt: now }).run();
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "unknown", draftVersionId: "version-1", createdAt: now, updatedAt: now }).run();
  db.insert(schema.domainAliases).values({ id: "alias-1", domainId: "domain-1", hostname: "www.example.com", displayHostname: "www.example.com" }).run();
  db.insert(schema.configVersions).values({ id: "version-1", domainId: "domain-1", versionNumber: 1, status: "draft", changeSummary: "enable ssl", snapshotJson: snapshot.json, snapshotChecksum: snapshot.checksum, createdBy: "user-1", createdAt: now, updatedAt: now }).run();

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); c.set("user", { id: "user-1", username: "admin" }); await next(); });
  app.route("/api", certificatesRoute);
  app.route("/", acmeChallengeRoute);
  app.onError(createErrorHandler<AppEnv>());
  return { app, connection, db };
}

test("order creation is durable and idempotent without creating a certificate or deployment", async () => {
  const { app, connection, db } = fixture();
  const request = () => app.request("/api/domains/domain-1/certificate/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "order-1" },
    body: JSON.stringify({ accountEmail: "admin@example.com", environment: "staging", validation: { method: "http-01" } }),
  });
  const created = await request();
  assert.equal(created.status, 201);
  const body = await created.json() as { order: { id: string; status: string; identifiers: string[] } };
  assert.equal(body.order.status, "preparing");
  assert.deepEqual(body.order.identifiers, ["example.com", "www.example.com"]);
  const repeated = await request();
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json() as { order: { id: string } }).order.id, body.order.id);
  assert.equal(db.select().from(schema.acmeOrders).all().length, 1);
  assert.equal(db.select().from(schema.certificates).all().length, 0);
  assert.equal(db.select().from(schema.deployments).all().length, 0);
  assert.equal(db.select().from(schema.configVersions).all().length, 1);
  connection.close();
});

test("manual renewal creates a replacement order from the Active Certificate source", async () => {
  const { app, connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "source-order", domainId: "domain-1", validationMethod: "http-01", accountEmail: "source@example.com", environment: "production", status: "succeeded", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), cleanupStatus: "succeeded", idempotencyKey: "source-order-key", createdAt: now, updatedAt: now }).run();
  db.insert(schema.certificates).values({ id: "active-certificate", domainId: "domain-1", acmeOrderId: "source-order", provider: "letsencrypt", environment: "production", status: "active", sansJson: JSON.stringify(["example.com", "www.example.com"]), certPath: "/cert.pem", keyPath: "/key.pem", certFileChecksum: "cert", publicKeySpkiChecksum: "key", notAfter: now + 10 * 24 * 60 * 60 * 1000, autoRenew: true }).run();
  const response = await app.request("/api/domains/domain-1/certificate/renew", { method: "POST", headers: { "idempotency-key": "manual-renewal" } });
  assert.equal(response.status, 201);
  const body = await response.json() as { order: { id: string; replacesCertificateId: string; accountEmail: string; environment: string; status: string } };
  assert.equal(body.order.replacesCertificateId, "active-certificate");
  assert.equal(body.order.accountEmail, "source@example.com");
  assert.equal(body.order.environment, "production");
  assert.equal(body.order.status, "preparing");
  const repeated = await app.request("/api/domains/domain-1/certificate/renew", { method: "POST", headers: { "idempotency-key": "manual-renewal" } });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json() as { order: { id: string } }).order.id, body.order.id);
  connection.close();
});

test("global certificate list returns domain context without filesystem or checksum fields", async () => {
  const { app, connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "source-order", domainId: "domain-1", validationMethod: "http-01", accountEmail: "source@example.com", environment: "production", status: "succeeded", identifiersJson: JSON.stringify(["example.com"]), cleanupStatus: "succeeded", idempotencyKey: "source-order-key", createdAt: now, updatedAt: now }).run();
  db.insert(schema.certificates).values({ id: "certificate-1", domainId: "domain-1", acmeOrderId: "source-order", provider: "letsencrypt", environment: "production", status: "active", sansJson: JSON.stringify(["example.com"]), certPath: "/secret/cert.pem", keyPath: "/secret/key.pem", certFileChecksum: "cert-checksum", publicKeySpkiChecksum: "key-checksum", notAfter: now + 10 * 24 * 60 * 60 * 1000, autoRenew: true }).run();

  const response = await app.request("/api/certificates");
  assert.equal(response.status, 200);
  const body = await response.json() as { items: Array<Record<string, unknown>> };
  assert.equal(body.items[0]?.primaryHostname, "example.com");
  assert.equal(body.items[0]?.domainEnabled, true);
  assert.equal(body.items[0]?.acmeOrderId, "source-order");
  assert.equal("certPath" in body.items[0]!, false);
  assert.equal("keyPath" in body.items[0]!, false);
  assert.equal("certFileChecksum" in body.items[0]!, false);
  assert.equal("publicKeySpkiChecksum" in body.items[0]!, false);
  connection.close();
});

test("HTTP-01 serves only an unexpired persisted challenge for the exact Host and token", async () => {
  const { app, connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "order-1", domainId: "domain-1", validationMethod: "http-01", accountEmail: "admin@example.com", environment: "staging", status: "waiting_http", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), unpublishedBaseVersionId: "version-1", cleanupStatus: "pending", idempotencyKey: "order-1", expiresAt: now + 60_000, createdAt: now, updatedAt: now }).run();
  db.insert(schema.acmeChallenges).values({ id: "challenge-1", orderId: "order-1", domainId: "domain-1", hostname: "www.example.com", type: "http-01", token: "token_123", keyAuthorization: "token_123.thumbprint", status: "presented", expiresAt: now + 60_000, createdAt: now, updatedAt: now }).run();

  const valid = await app.request("/.well-known/acme-challenge/token_123", { headers: { host: "www.example.com" } });
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "token_123.thumbprint");
  assert.equal(valid.headers.get("cache-control"), "no-store");
  const head = await app.request("/.well-known/acme-challenge/token_123", { method: "HEAD", headers: { host: "www.example.com:8080" } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const wrongToken = await app.request("/.well-known/acme-challenge/wrong", { headers: { host: "www.example.com" } });
  const wrongHost = await app.request("/.well-known/acme-challenge/token_123", { headers: { host: "example.com" } });
  assert.equal(wrongToken.status, 404);
  assert.equal(wrongHost.status, 404);

  db.update(schema.acmeChallenges).set({ expiresAt: now - 1 }).where(eq(schema.acmeChallenges.id, "challenge-1")).run();
  const expired = await app.request("/.well-known/acme-challenge/token_123", { headers: { host: "www.example.com" } });
  assert.equal(expired.status, 404);
  connection.close();
});

test("cancelling an order clears temporary challenge secrets", async () => {
  const { app, connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "order-1", domainId: "domain-1", validationMethod: "http-01", accountEmail: "admin@example.com", environment: "staging", status: "waiting_http", identifiersJson: JSON.stringify(["example.com"]), cleanupStatus: "pending", idempotencyKey: "order-1", createdAt: now, updatedAt: now }).run();
  db.insert(schema.acmeChallenges).values({ id: "challenge-1", orderId: "order-1", domainId: "domain-1", hostname: "example.com", type: "http-01", token: "token", keyAuthorization: "secret", status: "presented", expiresAt: now + 60_000, createdAt: now, updatedAt: now }).run();
  const response = await app.request("/api/domains/domain-1/certificate/orders/order-1/cancel", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()?.status, "cancelled");
  const challenge = db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.id, "challenge-1")).get();
  assert.equal(challenge?.token, null);
  assert.equal(challenge?.keyAuthorization, null);
  assert.equal(challenge?.status, "cleaned");
  connection.close();
});

test("an active order locks primary and alias hostnames without blocking unrelated edits", async () => {
  const { connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "order-1", domainId: "domain-1", validationMethod: "http-01", accountEmail: "admin@example.com", environment: "staging", status: "preparing", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), cleanupStatus: "pending", idempotencyKey: "order-1", createdAt: now, updatedAt: now }).run();
  await assert.doesNotReject(() => assertHostnamesMutable(db, "domain-1", ["example.com", "www.example.com"]));
  await assert.rejects(
    () => assertHostnamesMutable(db, "domain-1", ["example.com", "api.example.com"]),
    (error: unknown) => error instanceof Error && error.message.includes("errors:domainHasActiveOrder"),
  );
  connection.close();
});

test("manual recheck only advances the persisted poll schedule and debounces repeats", async () => {
  const { app, connection, db } = fixture();
  const now = Date.now();
  db.insert(schema.acmeOrders).values({ id: "order-recheck", domainId: "domain-1", validationMethod: "dns-01", dnsProvider: "manual", accountEmail: "admin@example.com", environment: "staging", status: "waiting_dns", identifiersJson: JSON.stringify(["example.com"]), cleanupStatus: "pending", idempotencyKey: "order-recheck", nextPollAt: now + 60_000, createdAt: now, updatedAt: now }).run();
  const response = await app.request("/api/domains/domain-1/certificate/orders/order-recheck/recheck", { method: "POST" });
  assert.equal(response.status, 200);
  const scheduled = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-recheck")).get();
  assert.ok((scheduled?.nextPollAt ?? Infinity) <= Date.now());
  db.update(schema.acmeOrders).set({ lastPolledAt: Date.now() }).where(eq(schema.acmeOrders.id, "order-recheck")).run();
  const debounced = await app.request("/api/domains/domain-1/certificate/orders/order-recheck/recheck", { method: "POST" });
  assert.equal((await debounced.json() as { debounced: boolean }).debounced, true);
  connection.close();
});
