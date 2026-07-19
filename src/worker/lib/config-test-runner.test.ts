import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { createSnapshot } from "./snapshot";
import { runConfigTest } from "./config-test-runner";
import { recoverInterruptedDeployments } from "./deployment-recovery";

const snapshot = {
  schemaVersion: 1 as const,
  primaryHostname: "example.com",
  aliases: [],
  routes: [],
  headers: [],
  ssl: {
    enabled: false,
    provider: "letsencrypt" as const,
    environment: "production" as const,
    email: "",
    autoRenew: true,
    forceHttps: false,
    validation: { method: "http-01" as const },
  },
  advanced: { serverSnippet: "" },
};

function createTestDb() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  return { connection, db };
}

test("missing config-test target marks the queued deployment failed", async () => {
  const { connection, db } = createTestDb();
  const saved = createSnapshot(snapshot);
  const now = Date.now();
  db.insert(schema.domains).values({
    id: "domain-1",
    primaryHostname: "example.com",
    displayHostname: "example.com",
    enabled: true,
    runtimeStatus: "unknown",
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
  }).run();
  db.insert(schema.configVersions).values({
    id: "version-1",
    domainId: "domain-1",
    versionNumber: 1,
    status: "draft",
    changeSummary: "test",
    snapshotJson: saved.json,
    snapshotChecksum: saved.checksum,
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.deployments).values({
    id: "deployment-1",
    domainId: "domain-1",
    configVersionId: "version-1",
    type: "test",
    status: "queued",
    idempotencyKey: "test-1",
    createdAt: now,
  }).run();
  db.insert(schema.deploymentSteps).values({
    id: "step-1",
    deploymentId: "deployment-1",
    sequence: 0,
    name: "Generate candidate config",
    status: "pending",
  }).run();

  await runConfigTest(db, "deployment-1");

  const deployment = db.select().from(schema.deployments)
    .where(eq(schema.deployments.id, "deployment-1")).get();
  const step = db.select().from(schema.deploymentSteps)
    .where(eq(schema.deploymentSteps.id, "step-1")).get();
  assert.equal(deployment?.status, "failed");
  assert.equal(deployment?.errorCode, "NGINX_TEST_FAILED");
  assert.equal(step?.status, "failed");
  connection.close();
});

test("database failures do not escape the fire-and-forget runner", async () => {
  const { connection, db } = createTestDb();
  connection.close();
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.doesNotReject(runConfigTest(db, "deployment-1"));
  } finally {
    console.error = originalError;
  }
});

test("startup recovery fails deployments interrupted before persistence", () => {
  const { connection, db } = createTestDb();
  const now = Date.now();
  db.insert(schema.deployments).values({
    id: "deployment-interrupted",
    type: "test",
    status: "running",
    idempotencyKey: "interrupted",
    createdAt: now,
    startedAt: now,
  }).run();
  db.insert(schema.deploymentSteps).values({
    id: "step-interrupted",
    deploymentId: "deployment-interrupted",
    sequence: 0,
    name: "Generate candidate config",
    status: "running",
    startedAt: now,
  }).run();
  db.insert(schema.deployments).values({
    id: "deployment-queued",
    type: "test",
    status: "queued",
    idempotencyKey: "queued",
    createdAt: now,
  }).run();
  db.insert(schema.deploymentSteps).values({
    id: "step-queued",
    deploymentId: "deployment-queued",
    sequence: 0,
    name: "Generate candidate config",
    status: "pending",
  }).run();

  recoverInterruptedDeployments(db);

  const deployment = db.select().from(schema.deployments)
    .where(eq(schema.deployments.id, "deployment-interrupted")).get();
  const step = db.select().from(schema.deploymentSteps)
    .where(eq(schema.deploymentSteps.id, "step-interrupted")).get();
  assert.equal(deployment?.status, "failed");
  assert.equal(deployment?.errorCode, "WORKER_INTERRUPTED");
  assert.equal(step?.status, "failed");
  const queued = db.select().from(schema.deployments)
    .where(eq(schema.deployments.id, "deployment-queued")).get();
  const queuedStep = db.select().from(schema.deploymentSteps)
    .where(eq(schema.deploymentSteps.id, "step-queued")).get();
  assert.equal(queued?.status, "queued");
  assert.equal(queuedStep?.status, "pending");
  connection.close();
});
