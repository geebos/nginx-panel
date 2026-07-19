import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import type { DomainConfig } from "@/shared/schemas";
import { createSnapshot } from "@/worker/lib/snapshot";
import { setRuntimeHealthy } from "@/worker/lib/runtime-state";
import { retryCertificateActivation, runCertificateActivationOnce } from "./activation";

const activeConfig: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: ["www.example.com"],
  routes: [{ id: "route-active", path: "/", order: 0, type: "redirect", target: "https://active.example", statusCode: 302, enabled: true }],
  headers: [],
  ssl: { enabled: true, provider: "letsencrypt", environment: "staging", email: "admin@example.com", autoRenew: true, forceHttps: false, validation: { method: "dns-01", provider: "manual" } },
  advanced: { serverSnippet: "" },
};

function fixture(certificateSans = ["example.com", "www.example.com"]) {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const active = createSnapshot(activeConfig);
  const draft = createSnapshot({ ...activeConfig, routes: [{ ...activeConfig.routes[0], target: "https://draft.example" }] });
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "running", activeVersionId: "version-active", draftVersionId: "version-draft", createdAt: now, updatedAt: now }).run();
  db.insert(schema.domainAliases).values({ id: "alias-1", domainId: "domain-1", hostname: "www.example.com", displayHostname: "www.example.com" }).run();
  db.insert(schema.configVersions).values([
    { id: "version-active", domainId: "domain-1", versionNumber: 1, status: "active", changeSummary: "active", snapshotJson: active.json, snapshotChecksum: active.checksum, createdAt: now, updatedAt: now },
    { id: "version-draft", domainId: "domain-1", versionNumber: 2, status: "draft", sourceVersionId: "version-active", changeSummary: "unpublished route", snapshotJson: draft.json, snapshotChecksum: draft.checksum, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(schema.acmeOrders).values({ id: "order-1", domainId: "domain-1", validationMethod: "dns-01", dnsProvider: "manual", accountEmail: "admin@example.com", environment: "staging", status: "succeeded", identifiersJson: JSON.stringify(["example.com", "www.example.com"]), cleanupStatus: "succeeded", idempotencyKey: "order-key", createdAt: now, updatedAt: now }).run();
  db.insert(schema.certificates).values({ id: "certificate-1", domainId: "domain-1", acmeOrderId: "order-1", provider: "letsencrypt", environment: "staging", status: "ready", sansJson: JSON.stringify(certificateSans), certPath: "/data/certs/domain-1/certificate-1/fullchain.pem", keyPath: "/data/certs/domain-1/certificate-1/private.key", certFileChecksum: "cert-checksum", publicKeySpkiChecksum: "key-checksum", autoRenew: true, issuedAt: now }).run();
  setRuntimeHealthy("activation-test");
  return { connection, db };
}

test("activation uses the Active Version and preserves an unrelated Draft", async () => {
  const { connection, db } = fixture();
  const enqueued: string[] = [];
  await runCertificateActivationOnce(db, async (_db, deploymentId) => { enqueued.push(deploymentId); });

  const activation = db.select().from(schema.certificateActivations).where(eq(schema.certificateActivations.certificateId, "certificate-1")).get();
  assert.equal(activation?.status, "created");
  assert.ok(activation?.configVersionId);
  assert.ok(activation?.deploymentId);
  const version = db.select().from(schema.configVersions).where(eq(schema.configVersions.id, activation!.configVersionId!)).get();
  const config = schema.domainConfigSchema.parse(JSON.parse(version!.snapshotJson));
  assert.equal(version?.sourceVersionId, "version-active");
  assert.equal(version?.sourceCertificateId, "certificate-1");
  assert.equal(version?.status, "pending");
  assert.equal(config.routes[0].type === "redirect" ? config.routes[0].target : null, "https://active.example");
  assert.equal(config.ssl.certificateId, "certificate-1");
  assert.equal(db.select().from(schema.domains).where(eq(schema.domains.id, "domain-1")).get()?.draftVersionId, "version-draft");
  assert.equal(enqueued.length, 1);

  await runCertificateActivationOnce(db, async (_db, deploymentId) => { enqueued.push(deploymentId); });
  assert.equal(db.select().from(schema.configVersions).all().length, 3);
  assert.equal(db.select().from(schema.deployments).all().length, 1);
  assert.equal(enqueued.length, 1);
  connection.close();
});

test("SAN drift fails only the Activation and leaves the ACME result Ready", async () => {
  const { connection, db } = fixture(["example.com"]);
  await runCertificateActivationOnce(db, async () => undefined);
  const activation = db.select().from(schema.certificateActivations).where(eq(schema.certificateActivations.certificateId, "certificate-1")).get();
  assert.equal(activation?.status, "failed");
  assert.equal(db.select().from(schema.certificates).where(eq(schema.certificates.id, "certificate-1")).get()?.status, "ready");
  assert.equal(db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()?.status, "succeeded");
  assert.equal(db.select().from(schema.deployments).all().length, 0);
  connection.close();
});

test("retry reuses the same failed certificate Deployment", async () => {
  const { connection, db } = fixture();
  await runCertificateActivationOnce(db, async () => undefined);
  const activation = db.select().from(schema.certificateActivations).where(eq(schema.certificateActivations.certificateId, "certificate-1")).get()!;
  db.update(schema.deployments).set({ status: "failed", errorCode: "NGINX_TEST_FAILED", errorMessage: "test failed", finishedAt: Date.now() }).where(eq(schema.deployments.id, activation.deploymentId!)).run();
  db.update(schema.deploymentSteps).set({ status: "failed", message: "test failed", finishedAt: Date.now() }).where(eq(schema.deploymentSteps.deploymentId, activation.deploymentId!)).run();
  const enqueued: string[] = [];
  const result = await retryCertificateActivation(db, activation.id, async (_db, deploymentId) => { enqueued.push(deploymentId); });
  assert.equal(result.deployment?.id, activation.deploymentId);
  assert.equal(result.deployment?.status, "queued");
  assert.equal(db.select().from(schema.deployments).all().length, 1);
  assert.ok(db.select().from(schema.deploymentSteps).where(eq(schema.deploymentSteps.deploymentId, activation.deploymentId!)).all().every((step) => step.status === "pending"));
  assert.deepEqual(enqueued, [activation.deploymentId]);
  connection.close();
});
