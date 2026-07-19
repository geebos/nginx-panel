import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { AcmeRecoveryError, type AcmeAdapter } from "./client";
import type { CertificateStore } from "./certificate-store";
import type { DnsPropagationChecker } from "./dns";
import { runAcmeSchedulerOnce } from "./scheduler";
import { encryptCloudflareToken } from "@/worker/cloudflare/credentials";
import type { CloudflareDnsProvider } from "@/worker/cloudflare/dns";

function fixture(validationMethod: "http-01" | "dns-01") {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "unknown", createdAt: now, updatedAt: now }).run();
  db.insert(schema.acmeOrders).values({ id: `order-${validationMethod}`, domainId: "domain-1", validationMethod, dnsProvider: validationMethod === "dns-01" ? "manual" : null, accountEmail: "admin@example.com", environment: "staging", status: "preparing", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), cleanupStatus: "pending", idempotencyKey: `key-${validationMethod}`, createdAt: now, updatedAt: now }).run();
  return { connection, db, orderId: `order-${validationMethod}` };
}

function fakeAdapter(overrides: Partial<AcmeAdapter>): AcmeAdapter {
  return {
    prepareOrder: async () => { throw new Error("prepareOrder was not configured"); },
    acknowledgeChallenges: async () => undefined,
    pollOrder: async () => ({ orderStatus: "pending", authorizations: [] }),
    finalizeOrder: async () => ({ status: "pending" }),
    ...overrides,
  };
}

const missingDns: DnsPropagationChecker = {
  check: async () => ({ authoritative: false, recursiveVisible: 0 }),
};

const unusedStore: CertificateStore = {
  persist: async () => { throw new Error("persist should not be called"); },
  cleanupOrder: async () => undefined,
};

test("scheduler atomically persists HTTP challenges before entering waiting_http", async () => {
  const { connection, db, orderId } = fixture("http-01");
  let calls = 0;
  const adapter = fakeAdapter({ prepareOrder: async () => {
    calls += 1;
    return { orderUrl: "https://ca.test/order/1", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "http-01" as const, token: `token-${hostname}`, keyAuthorization: `token-${hostname}.thumbprint`, dnsRecordName: null, dnsRecordValue: null, expiresAt: Date.now() + 60_000 })) };
  } });
  await Promise.all([runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore }), runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore })]);
  assert.equal(calls, 1);
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get();
  assert.equal(order?.status, "waiting_http");
  assert.equal(order?.orderUrl, "https://ca.test/order/1");
  const challenges = db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.orderId, orderId)).all();
  assert.equal(challenges.length, 2);
  assert.ok(challenges.every((challenge) => challenge.status === "presented" && challenge.token && challenge.keyAuthorization));
  connection.close();
});

test("renewal preparation forbids silently creating a replacement ACME account", async () => {
  const { connection, db, orderId } = fixture("http-01");
  db.update(schema.acmeOrders).set({ replacesCertificateId: "certificate-old" }).where(eq(schema.acmeOrders.id, orderId)).run();
  let allowAccountCreate: boolean | undefined;
  const adapter = fakeAdapter({ prepareOrder: async (input) => {
    allowAccountCreate = input.allowAccountCreate;
    return { orderUrl: "https://ca.test/order/renew", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "http-01" as const, token: `token-${hostname}`, keyAuthorization: `token-${hostname}.thumbprint`, dnsRecordName: null, dnsRecordValue: null, expiresAt: Date.now() + 60_000 })) };
  } });
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore });
  assert.equal(allowAccountCreate, false);
  connection.close();
});

test("manual DNS preparation stores TXT instructions and enters waiting_dns", async () => {
  const { connection, db, orderId } = fixture("dns-01");
  const adapter = fakeAdapter({ prepareOrder: async () => ({ orderUrl: "https://ca.test/order/2", expiresAt: null, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "dns-01" as const, token: null, keyAuthorization: null, dnsRecordName: `_acme-challenge.${hostname}`, dnsRecordValue: `txt-${hostname}`, expiresAt: Date.now() + 60_000 })) }) });
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "waiting_dns");
  const challenges = db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.orderId, orderId)).all();
  assert.ok(challenges.every((challenge) => challenge.status === "propagating" && challenge.dnsRecordValue && challenge.token === null));
  connection.close();
});

test("Cloudflare TXT presentation resumes from persisted challenge IDs after a failure", async () => {
  const { connection, db, orderId } = fixture("dns-01");
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const encrypted = await encryptCloudflareToken("credential-1", "cloudflare-secret-token");
  const now = Date.now();
  db.insert(schema.cloudflareCredentials).values({ id: "credential-1", name: "test", tokenCiphertext: encrypted.ciphertext, tokenIv: encrypted.iv, tokenAuthTag: encrypted.authTag, tokenLast4: "oken", status: "active", createdAt: now, updatedAt: now }).run();
  db.update(schema.acmeOrders).set({ dnsProvider: "cloudflare", cloudflareCredentialId: "credential-1", cloudflareCredentialName: "test" }).where(eq(schema.acmeOrders.id, orderId)).run();
  let prepareCalls = 0;
  const adapter = fakeAdapter({ prepareOrder: async () => {
    prepareCalls += 1;
    return { orderUrl: "https://ca.test/order/cloudflare", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "dns-01" as const, token: null, keyAuthorization: null, dnsRecordName: `_acme-challenge.${hostname}`, dnsRecordValue: `txt-${hostname}`, expiresAt: Date.now() + 60_000 })) };
  } });
  let presentCalls = 0;
  let failSecond = true;
  const cleanupCalls: Array<{ zoneId: string; recordId: string }> = [];
  const cloudflare: CloudflareDnsProvider = {
    verify: async () => ({ tokenId: "token-1", status: "active", expiresAt: null, zones: [{ id: "zone-1", name: "example.com" }] }),
    preflight: async () => [{ id: "zone-1", name: "example.com" }],
    present: async (_token, input) => {
      presentCalls += 1;
      if (input.hostname === "www.example.com" && failSecond) throw new Error("temporary Cloudflare failure");
      return { zoneId: "zone-1", recordId: `record-${input.hostname}` };
    },
    cleanup: async (_token, zoneId, recordId) => { cleanupCalls.push({ zoneId, recordId }); },
  };
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore, cloudflare });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "preparing");
  assert.equal(db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.orderId, orderId)).all().filter((challenge) => challenge.cloudflareRecordId).length, 1);
  failSecond = false;
  db.update(schema.acmeOrders).set({ nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore, cloudflare });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "waiting_dns");
  assert.equal(prepareCalls, 1);
  assert.equal(presentCalls, 3);
  assert.ok(db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.orderId, orderId)).all().every((challenge) => challenge.cloudflareRecordId));
  db.update(schema.acmeOrders).set({ status: "cancelled", cleanupStatus: "pending", nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore, cloudflare });
  assert.deepEqual(cleanupCalls.map((call) => call.recordId).sort(), ["record-example.com", "record-www.example.com"]);
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.cleanupStatus, "succeeded");
  assert.ok(db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.orderId, orderId)).all().every((challenge) => challenge.cleanedAt && challenge.dnsRecordValue === null));
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
  connection.close();
});

test("preparation failure becomes a recoverable terminal error without partial challenges", async () => {
  const { connection, db, orderId } = fixture("http-01");
  const adapter = fakeAdapter({ prepareOrder: async () => { throw new Error("CA refused https://secret.example/order"); } });
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore });
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get();
  assert.equal(order?.status, "failed");
  assert.equal(order?.errorCode, "ACME_PREPARE_FAILED");
  assert.equal(order?.errorMessage?.includes("secret.example"), false);
  assert.equal(db.select().from(schema.acmeChallenges).all().length, 0);
  connection.close();
});

test("manual DNS remains waiting until the TXT value is authoritative", async () => {
  const { connection, db, orderId } = fixture("dns-01");
  let acknowledgements = 0;
  const adapter = fakeAdapter({
    prepareOrder: async () => ({ orderUrl: "https://ca.test/order/3", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "dns-01" as const, token: null, keyAuthorization: null, dnsRecordName: `_acme-challenge.${hostname}`, dnsRecordValue: `txt-${hostname}`, expiresAt: Date.now() + 60_000 })) }),
    acknowledgeChallenges: async () => { acknowledgements += 1; },
  });
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore });
  db.update(schema.acmeOrders).set({ nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: missingDns, certificates: unusedStore });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "waiting_dns");
  assert.equal(acknowledgements, 0);
  connection.close();
});

test("a ready DNS challenge fails clearly when restart lost the ACME account key", async () => {
  const { connection, db, orderId } = fixture("dns-01");
  const adapter = fakeAdapter({
    prepareOrder: async () => ({ orderUrl: "https://ca.test/order/lost-key", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "dns-01" as const, token: null, keyAuthorization: null, dnsRecordName: `_acme-challenge.${hostname}`, dnsRecordValue: `txt-${hostname}`, expiresAt: Date.now() + 60_000 })) }),
    acknowledgeChallenges: async () => { throw new AcmeRecoveryError("ACME_ACCOUNT_KEY_MISSING", "ACME account key 不存在，无法恢复订单"); },
  });
  const visibleDns: DnsPropagationChecker = { check: async () => ({ authoritative: true, recursiveVisible: 2 }) };
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: unusedStore });
  db.update(schema.acmeOrders).set({ nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: unusedStore });
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get();
  assert.equal(order?.status, "failed");
  assert.equal(order?.errorCode, "ACME_ACCOUNT_KEY_MISSING");
  connection.close();
});

test("authoritative DNS advances through validation and creates a Ready certificate", async () => {
  const { connection, db, orderId } = fixture("dns-01");
  let acknowledgements = 0;
  let cleaned = false;
  const adapter = fakeAdapter({
    prepareOrder: async () => ({ orderUrl: "https://ca.test/order/4", expiresAt: Date.now() + 60_000, challenges: ["example.com", "www.example.com"].map((hostname) => ({ hostname, type: "dns-01" as const, token: null, keyAuthorization: null, dnsRecordName: `_acme-challenge.${hostname}`, dnsRecordValue: `txt-${hostname}`, expiresAt: Date.now() + 60_000 })) }),
    acknowledgeChallenges: async () => { acknowledgements += 1; },
    pollOrder: async () => ({ orderStatus: "ready", authorizations: ["example.com", "www.example.com"].map((hostname) => ({ hostname, status: "valid" as const })) }),
    finalizeOrder: async () => ({ status: "downloaded", certificatePem: "test certificate" }),
  });
  const visibleDns: DnsPropagationChecker = { check: async () => ({ authoritative: true, recursiveVisible: 2 }) };
  const store: CertificateStore = {
    persist: async ({ certificateId, domainId }) => ({ sans: ["example.com", "www.example.com"], certPath: `/certs/${domainId}/${certificateId}/fullchain.pem`, keyPath: `/certs/${domainId}/${certificateId}/private.key`, certFileChecksum: "cert-sha", publicKeySpkiChecksum: "key-sha", notBefore: Date.now() - 1_000, notAfter: Date.now() + 90 * 24 * 60 * 60 * 1000 }),
    cleanupOrder: async () => { cleaned = true; },
  };
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: store });
  db.update(schema.acmeOrders).set({ nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: store });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "validating");
  assert.equal(acknowledgements, 1);
  db.update(schema.acmeOrders).set({ nextPollAt: 0 }).where(eq(schema.acmeOrders.id, orderId)).run();
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: store });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "validated");
  await runAcmeSchedulerOnce(db, adapter, { dns: visibleDns, certificates: store });
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, orderId)).get()?.status, "succeeded");
  const certificate = db.select().from(schema.certificates).where(eq(schema.certificates.acmeOrderId, orderId)).get();
  assert.equal(certificate?.status, "ready");
  assert.equal(certificate?.keyPath.includes("private.key"), true);
  assert.equal(cleaned, true);
  connection.close();
});
