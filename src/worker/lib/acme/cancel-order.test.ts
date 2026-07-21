import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { cancelAcmeOrder } from "@/worker/lib/acme/cancel-order";

function fixture() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.domains).values({
    id: "domain-1",
    type: "domain",
    primaryHostname: "example.com",
    displayHostname: "example.com",
    enabled: true,
    runtimeStatus: "running",
    createdAt: now,
    updatedAt: now,
  }).run();
  return { connection, db, now };
}

test("cancelAcmeOrder is a no-op for terminal orders", async () => {
  const { connection, db, now } = fixture();
  db.insert(schema.acmeOrders).values({
    id: "order-1",
    domainId: "domain-1",
    validationMethod: "http-01",
    accountEmail: "admin@example.com",
    environment: "staging",
    status: "succeeded",
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: "succeeded",
    idempotencyKey: "order-1",
    createdAt: now,
    updatedAt: now,
  }).run();
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()!;
  const result = await cancelAcmeOrder(db, order);
  assert.equal(result.order.status, "succeeded");
  assert.equal(
    db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()?.status,
    "succeeded",
  );
  connection.close();
});

test("cancelAcmeOrder cancels in-flight orders and scrubs non-cloudflare challenges", async () => {
  const { connection, db, now } = fixture();
  db.insert(schema.acmeOrders).values({
    id: "order-1",
    domainId: "domain-1",
    validationMethod: "http-01",
    accountEmail: "admin@example.com",
    environment: "staging",
    status: "waiting_http",
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: "pending",
    idempotencyKey: "order-1",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.acmeChallenges).values({
    id: "challenge-1",
    orderId: "order-1",
    domainId: "domain-1",
    hostname: "example.com",
    type: "http-01",
    token: "token",
    keyAuthorization: "secret",
    status: "presented",
    expiresAt: now + 60_000,
    createdAt: now,
    updatedAt: now,
  }).run();
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()!;
  const result = await cancelAcmeOrder(db, order);
  assert.equal(result.order.status, "cancelled");
  assert.equal(result.order.cleanupStatus, "succeeded");
  assert.equal(result.order.nextPollAt, null);
  const challenge = db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.id, "challenge-1")).get();
  assert.equal(challenge?.token, null);
  assert.equal(challenge?.keyAuthorization, null);
  assert.equal(challenge?.status, "cleaned");
  connection.close();
});

test("cancelAcmeOrder marks the replaced active certificate for a delayed recheck", async () => {
  const { connection, db, now } = fixture();
  db.insert(schema.acmeOrders).values({
    id: "source-order",
    domainId: "domain-1",
    validationMethod: "http-01",
    accountEmail: "admin@example.com",
    environment: "production",
    status: "succeeded",
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: "succeeded",
    idempotencyKey: "source-order",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.certificates).values({
    id: "certificate-1",
    domainId: "domain-1",
    acmeOrderId: "source-order",
    provider: "letsencrypt",
    environment: "production",
    status: "active",
    sansJson: JSON.stringify(["example.com"]),
    certPath: "/cert.pem",
    keyPath: "/key.pem",
    certFileChecksum: "cert",
    publicKeySpkiChecksum: "key",
    notAfter: now + 10 * 24 * 60 * 60 * 1000,
    autoRenew: true,
  }).run();
  db.insert(schema.acmeOrders).values({
    id: "renewal-order",
    domainId: "domain-1",
    replacesCertificateId: "certificate-1",
    validationMethod: "http-01",
    accountEmail: "admin@example.com",
    environment: "production",
    status: "preparing",
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: "pending",
    idempotencyKey: "renewal-order",
    createdAt: now,
    updatedAt: now,
  }).run();
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "renewal-order")).get()!;
  const before = Date.now();
  await cancelAcmeOrder(db, order);
  const certificate = db.select().from(schema.certificates).where(eq(schema.certificates.id, "certificate-1")).get();
  assert.equal(certificate?.lastErrorCode, "RENEWAL_CANCELLED");
  assert.ok((certificate?.nextCheckAt ?? 0) >= before + 24 * 60 * 60 * 1000 - 1_000);
  assert.ok((certificate?.nextCheckAt ?? 0) <= Date.now() + 24 * 60 * 60 * 1000 + 1_000);
  connection.close();
});
