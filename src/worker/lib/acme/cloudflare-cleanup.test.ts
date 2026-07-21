import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { cleanupCloudflareOrder } from "@/worker/lib/acme/cloudflare-cleanup";
import { encryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";
import type { CloudflareDnsProvider } from "@/worker/lib/cloudflare/dns";

async function fixtureWithCredential() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const encrypted = await encryptCloudflareToken("credential-1", "cloudflare-secret-token");
  db.insert(schema.domains)
    .values({
      id: "domain-1",
      type: "domain",
      primaryHostname: "example.com",
      displayHostname: "example.com",
      enabled: true,
      runtimeStatus: "unknown",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.cloudflareCredentials)
    .values({
      id: "credential-1",
      name: "test",
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      tokenLast4: "oken",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.acmeOrders)
    .values({
      id: "order-1",
      domainId: "domain-1",
      validationMethod: "dns-01",
      dnsProvider: "cloudflare",
      cloudflareCredentialId: "credential-1",
      accountEmail: "admin@example.com",
      environment: "staging",
      status: "succeeded",
      identifiersJson: JSON.stringify(["example.com"]),
      cleanupStatus: "pending",
      idempotencyKey: "key-1",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.acmeChallenges)
    .values({
      id: "challenge-1",
      orderId: "order-1",
      domainId: "domain-1",
      hostname: "example.com",
      type: "dns-01",
      status: "propagating",
      dnsRecordName: "_acme-challenge.example.com",
      dnsRecordValue: "txt-value",
      cloudflareZoneId: "zone-1",
      cloudflareRecordId: "record-1",
      cleanedAt: null,
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { connection, db };
}

function fixtureMissingCredential() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.domains)
    .values({
      id: "domain-1",
      type: "domain",
      primaryHostname: "example.com",
      displayHostname: "example.com",
      enabled: true,
      runtimeStatus: "unknown",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.acmeOrders)
    .values({
      id: "order-1",
      domainId: "domain-1",
      validationMethod: "dns-01",
      dnsProvider: "cloudflare",
      cloudflareCredentialId: null,
      accountEmail: "admin@example.com",
      environment: "staging",
      status: "succeeded",
      identifiersJson: JSON.stringify(["example.com"]),
      cleanupStatus: "pending",
      idempotencyKey: "key-1",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { connection, db };
}

function unusedPresentProvider(cleanup: CloudflareDnsProvider["cleanup"]): CloudflareDnsProvider {
  return {
    verify: async () => ({ tokenId: "t", status: "active", expiresAt: null, zones: [] }),
    preflight: async () => [],
    present: async () => {
      throw new Error("present unused");
    },
    cleanup,
  };
}

test("cleanup failure with URL redacts errorMessage", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const { connection, db } = await fixtureWithCredential();
  await cleanupCloudflareOrder(
    db,
    "order-1",
    unusedPresentProvider(async () => {
      throw new Error("cleanup failed https://api.cloudflare.com/client/v4/zones/z/dns_records/r");
    }),
  );
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(order?.cleanupStatus, "failed");
  assert.equal(order?.errorMessage, "cleanup failed [URL]");
  assert.ok(!order?.errorMessage?.includes("https://"));
  assert.ok((order?.errorMessage?.length ?? 0) <= 500);
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
  connection.close();
});

test("cleanup failure without URL keeps plain Error message", async () => {
  const { connection, db } = fixtureMissingCredential();
  await cleanupCloudflareOrder(db, "order-1");
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(order?.cleanupStatus, "failed");
  assert.equal(order?.errorMessage, "Cloudflare credential association is missing");
  connection.close();
});

test("cleanup failure with non-Error uses fallback message", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const { connection, db } = await fixtureWithCredential();
  await cleanupCloudflareOrder(
    db,
    "order-1",
    unusedPresentProvider(async () => {
      await Promise.reject({ reason: "raw-object-failure" });
    }),
  );
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(order?.cleanupStatus, "failed");
  assert.equal(order?.errorMessage, "Cloudflare DNS cleanup failed");
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
  connection.close();
});

test("successful cleanup marks succeeded without errorMessage", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const { connection, db } = await fixtureWithCredential();
  await cleanupCloudflareOrder(
    db,
    "order-1",
    unusedPresentProvider(async () => undefined),
  );
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(order?.cleanupStatus, "succeeded");
  assert.equal(order?.errorMessage, null);
  const challenge = db.select().from(schema.acmeChallenges).where(eq(schema.acmeChallenges.id, "challenge-1")).get();
  assert.ok(challenge?.cleanedAt);
  assert.equal(challenge?.dnsRecordValue, null);
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
  connection.close();
});
