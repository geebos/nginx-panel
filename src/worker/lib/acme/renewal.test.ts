import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { createRenewalOrder, recordRenewalOrderFailure, runRenewalRetryOnce, runRenewalSchedulerOnce } from "@/worker/lib/acme/renewal";

function fixture(input: { autoRenew?: boolean; enabled?: boolean } = {}) {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: input.enabled ?? true, runtimeStatus: "running", createdAt: now, updatedAt: now }).run();
  db.insert(schema.domainAliases).values({ id: "alias-1", domainId: "domain-1", hostname: "www.example.com", displayHostname: "www.example.com" }).run();
  db.insert(schema.acmeOrders).values({ id: "source-order", domainId: "domain-1", validationMethod: "dns-01", dnsProvider: "manual", accountEmail: "original@example.com", environment: "production", status: "succeeded", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), cleanupStatus: "succeeded", idempotencyKey: "source-key", createdAt: now, updatedAt: now }).run();
  db.insert(schema.certificates).values({ id: "certificate-1", domainId: "domain-1", acmeOrderId: "source-order", provider: "letsencrypt", environment: "production", status: "active", sansJson: JSON.stringify(["example.com", "www.example.com"]), certPath: "/cert.pem", keyPath: "/key.pem", certFileChecksum: "cert", publicKeySpkiChecksum: "key", notAfter: now + 10 * 24 * 60 * 60 * 1000, autoRenew: input.autoRenew ?? true, lastValidationMethod: "dns-01", lastDnsProvider: "manual", nextCheckAt: now - 1 }).run();
  return { connection, db, now };
}

test("manual renewal copies the source account and validation strategy idempotently", async () => {
  const { connection, db, now } = fixture();
  const created = await createRenewalOrder(db, { certificateId: "certificate-1", idempotencyKey: "manual-renewal", now });
  assert.equal(created.created, true);
  assert.equal(created.order.replacesCertificateId, "certificate-1");
  assert.equal(created.order.accountEmail, "original@example.com");
  assert.equal(created.order.environment, "production");
  assert.equal(created.order.validationMethod, "dns-01");
  assert.equal(created.order.dnsProvider, "manual");
  assert.deepEqual(JSON.parse(created.order.identifiersJson), ["example.com", "www.example.com"]);
  const repeated = await createRenewalOrder(db, { certificateId: "certificate-1", idempotencyKey: "manual-renewal", now });
  assert.equal(repeated.created, false);
  assert.equal(repeated.order.id, created.order.id);
  connection.close();
});

test("automatic renewal includes disabled domains but skips certificates with auto renew disabled", async () => {
  const disabled = fixture({ enabled: false });
  await runRenewalSchedulerOnce(disabled.db, { now: disabled.now });
  const order = disabled.db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.replacesCertificateId, "certificate-1")).get();
  assert.equal(order?.status, "preparing");
  disabled.connection.close();

  const manual = fixture({ autoRenew: false });
  await runRenewalSchedulerOnce(manual.db, { now: manual.now });
  assert.equal(manual.db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.replacesCertificateId, "certificate-1")).get(), undefined);
  manual.connection.close();
});

test("failed renewal records a bounded retry schedule on the old Active certificate", async () => {
  const { connection, db, now } = fixture();
  const created = await createRenewalOrder(db, { certificateId: "certificate-1", idempotencyKey: "failed-renewal", now });
  db.update(schema.acmeOrders).set({ status: "failed", errorCode: "ACME_VALIDATION_FAILED" }).where(eq(schema.acmeOrders.id, created.order.id)).run();
  const before = Date.now();
  await recordRenewalOrderFailure(db, created.order.id, "ACME_VALIDATION_FAILED");
  const certificate = db.select().from(schema.certificates).where(eq(schema.certificates.id, "certificate-1")).get();
  assert.equal(certificate?.status, "active");
  assert.equal(certificate?.lastErrorCode, "ACME_VALIDATION_FAILED");
  assert.ok((certificate?.nextCheckAt ?? 0) >= before + 60 * 60 * 1000 - 1_000);
  connection.close();
});

test("daily scans and hourly failure retries use separate due queues", async () => {
  const { connection, db, now } = fixture();
  db.update(schema.certificates).set({ lastErrorCode: "CLOUDFLARE_PREFLIGHT_FAILED", nextCheckAt: now - 1 }).where(eq(schema.certificates.id, "certificate-1")).run();
  await runRenewalSchedulerOnce(db, { now });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.replacesCertificateId, "certificate-1")).get(), undefined);
  await runRenewalRetryOnce(db, { now });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.replacesCertificateId, "certificate-1")).get()?.status, "preparing");
  connection.close();
});
