import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "@/shared/schemas";
import type { DomainConfig } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { createErrorHandler } from "@/worker/middleware/error";
import { createSnapshot } from "@/worker/lib/snapshot";
import { createPublishDeployment } from "@/worker/lib/deployment/runner";
import { setRuntimeHealthy } from "@/worker/lib/runtime/state";
import { domainsRoute } from "@/worker/routes/domains";
import { dashboardRoute } from "@/worker/routes/dashboard";
import { versionsRoute } from "@/worker/routes/versions";

process.env.MANAGER_URL = "https://manager.example.test";

const baseConfig: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: [],
  routes: [],
  headers: [],
  ssl: {
    enabled: false,
    provider: "letsencrypt",
    environment: "production",
    email: "",
    autoRenew: true,
    forceHttps: false,
    validation: { method: "http-01" },
  },
  advanced: { serverSnippet: "" },
};

function createFixture(route: Hono<AppEnv>) {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const saved = createSnapshot(baseConfig);
  db.insert(schema.users).values({
    id: "user-1",
    username: "admin",
    passwordHash: "unused",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.domains).values({
    id: "domain-1",
    type: "domain",
    primaryHostname: "example.com",
    displayHostname: "example.com",
    enabled: true,
    runtimeStatus: "unknown",
    draftVersionId: "version-1",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.configVersions).values({
    id: "version-1",
    domainId: "domain-1",
    versionNumber: 1,
    status: "draft",
    changeSummary: "initial",
    snapshotJson: saved.json,
    snapshotChecksum: saved.checksum,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
  }).run();

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("user", { id: "user-1", username: "admin" });
    await next();
  });
  app.route("/api", route);
  app.onError(createErrorHandler<AppEnv>());
  return { app, connection, db, checksum: saved.checksum };
}

test("concurrent PATCH saves produce one version and one conflict without an orphan", async () => {
  const { app, connection, db } = createFixture(domainsRoute);
  const request = (alias: string) => app.request("/api/domains/domain-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersionId: "version-1",
      expectedSnapshotChecksum: createSnapshot(baseConfig).checksum,
      config: { ...baseConfig, aliases: [alias] },
    }),
  });

  const responses = await Promise.all([request("a.example.com"), request("b.example.com")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const versions = db.select().from(schema.configVersions)
    .where(eq(schema.configVersions.domainId, "domain-1")).all();
  assert.equal(versions.length, 1);
  assert.deepEqual(versions.map((version) => version.versionNumber), [1]);
  connection.close();
});

test("concurrent version POSTs return a conflict instead of a unique-index 500", async () => {
  const { app, connection, db, checksum } = createFixture(versionsRoute);
  const request = (alias: string) => app.request("/api/domains/domain-1/versions", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `\"${checksum}\"` },
    body: JSON.stringify({
      changeSummary: "concurrent save",
      config: { ...baseConfig, aliases: [alias] },
    }),
  });

  const responses = await Promise.all([request("a.example.com"), request("b.example.com")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const success = responses.find((response) => response.status === 200)!;
  const successBody = await success.json() as {
    changed: boolean;
    version: { versionNumber: number; sourceVersionId: string | null; sourceCertificateId: string | null };
  };
  assert.equal(successBody.changed, true);
  assert.equal(successBody.version.versionNumber, 1);
  assert.equal(successBody.version.sourceVersionId, null);
  assert.equal(successBody.version.sourceCertificateId, null);
  const versions = db.select().from(schema.configVersions)
    .where(eq(schema.configVersions.domainId, "domain-1")).all();
  assert.equal(versions.length, 1);
  assert.deepEqual(versions.map((version) => version.versionNumber), [1]);
  connection.close();
});

test("repeated saves update one draft in place and preserve its identity", async () => {
  const { app, connection, db, checksum } = createFixture(versionsRoute);
  let expectedChecksum = checksum;
  for (let index = 1; index <= 5; index += 1) {
    const response = await app.request("/api/domains/domain-1/versions", {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": `\"${expectedChecksum}\"` },
      body: JSON.stringify({
        changeSummary: `save ${index}`,
        config: { ...baseConfig, aliases: [`save-${index}.example.com`] },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { mode: string; version: { id: string; versionNumber: number; snapshotChecksum: string } };
    assert.equal(body.mode, "updated");
    assert.equal(body.version.id, "version-1");
    assert.equal(body.version.versionNumber, 1);
    expectedChecksum = body.version.snapshotChecksum;
  }
  const versions = db.select().from(schema.configVersions).where(eq(schema.configVersions.domainId, "domain-1")).all();
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.id, "version-1");
  assert.equal(versions[0]?.versionNumber, 1);
  assert.ok((versions[0]?.updatedAt ?? 0) >= (versions[0]?.createdAt ?? 0));
  connection.close();
});

test("a queued deploy locks its draft until the deployment reaches a terminal state", async () => {
  const { app, connection, db, checksum } = createFixture(versionsRoute);
  db.insert(schema.deployments).values({
    id: "deploy-1",
    domainId: "domain-1",
    configVersionId: "version-1",
    type: "deploy",
    status: "queued",
    idempotencyKey: "deploy-lock",
    createdAt: Date.now(),
  }).run();
  const locked = await app.request("/api/domains/domain-1/versions", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `\"${checksum}\"` },
    body: JSON.stringify({ changeSummary: "locked save", config: { ...baseConfig, aliases: ["locked.example.com"] } }),
  });
  assert.equal(locked.status, 409);
  assert.equal((await locked.json() as { code: string }).code, "DRAFT_DEPLOYMENT_RUNNING");
  db.update(schema.deployments).set({ status: "failed", finishedAt: Date.now() }).where(eq(schema.deployments.id, "deploy-1")).run();
  const unlocked = await app.request("/api/domains/domain-1/versions", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `\"${checksum}\"` },
    body: JSON.stringify({ changeSummary: "unlocked save", config: { ...baseConfig, aliases: ["unlocked.example.com"] } }),
  });
  assert.equal(unlocked.status, 200);
  connection.close();
});

test("deploy creation requires a successful checksum-bound preflight", async () => {
  const { connection, db, checksum } = createFixture(versionsRoute);
  setRuntimeHealthy(null);
  db.insert(schema.deployments).values({
    id: "test-1",
    domainId: "domain-1",
    configVersionId: "version-1",
    type: "test",
    status: "succeeded",
    idempotencyKey: "preflight",
    inputJson: JSON.stringify({ expectedSnapshotChecksum: checksum }),
    createdAt: Date.now(),
    finishedAt: Date.now(),
  }).run();
  await assert.rejects(
    createPublishDeployment(db, { domainId: "domain-1", versionId: "version-1", requestedBy: "user-1", idempotencyKey: "stale-deploy", expectedSnapshotChecksum: "stale", preflightDeploymentId: "test-1" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_STALE",
  );
  const deployment = await createPublishDeployment(db, { domainId: "domain-1", versionId: "version-1", requestedBy: "user-1", idempotencyKey: "valid-deploy", expectedSnapshotChecksum: checksum, preflightDeploymentId: "test-1" });
  assert.equal(deployment.status, "queued");
  assert.deepEqual(JSON.parse(deployment.inputJson ?? "null"), { expectedSnapshotChecksum: checksum, preflightDeploymentId: "test-1" });
  connection.close();
});

test("domain list filters aliases and paginates in SQL with structured query errors", async () => {
  const { app, connection, db } = createFixture(domainsRoute);
  db.insert(schema.domainAliases).values({
    id: "alias-1",
    domainId: "domain-1",
    hostname: "www.example.com",
    displayHostname: "www.example.com",
  }).run();

  const response = await app.request("/api/domains?search=www&page=1&pageSize=1");
  assert.equal(response.status, 200);
  const body = await response.json() as { total: number; items: { aliases: string[] }[] };
  assert.equal(body.total, 1);
  assert.deepEqual(body.items[0]?.aliases, ["www.example.com"]);

  const invalidResponse = await app.request("/api/domains?status=invalid&page=0");
  assert.equal(invalidResponse.status, 400);
  const invalidBody = await invalidResponse.json() as { fieldErrors: Record<string, string[]> };
  assert.ok(invalidBody.fieldErrors.page);
  assert.ok(invalidBody.fieldErrors.status);
  connection.close();
});

test("dashboard uses aggregate counts and a bounded recent-domain query", async () => {
  const { app, connection } = createFixture(dashboardRoute);
  const response = await app.request("/api/dashboard");
  assert.equal(response.status, 200);
  const body = await response.json() as {
    domains: { total: number; enabled: number; drafts: number; failed: number };
    recentDomains: unknown[];
  };
  assert.deepEqual(body.domains, { total: 1, enabled: 1, drafts: 1, failed: 0 });
  assert.equal(body.recentDomains.length, 1);
  connection.close();
});

test("concurrent domain creates return DOMAIN_CONFLICT instead of 500", async () => {
  const { app, connection, db } = createFixture(domainsRoute);
  const request = () => app.request("/api/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: { ...baseConfig, primaryHostname: "new.example.com" },
    }),
  });

  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const conflict = responses.find((response) => response.status === 409)!;
  assert.equal((await conflict.json() as { code: string }).code, "DOMAIN_CONFLICT");
  const created = db.select().from(schema.domains)
    .where(eq(schema.domains.primaryHostname, "new.example.com")).all();
  assert.equal(created.length, 1);
  connection.close();
});

test("concurrent alias claims return DOMAIN_CONFLICT and roll back the losing version", async () => {
  const { app, connection, db } = createFixture(domainsRoute);
  const now = Date.now();
  const saved = createSnapshot({ ...baseConfig, primaryHostname: "second.example.com" });
  db.insert(schema.domains).values({
    id: "domain-2",
    primaryHostname: "second.example.com",
    displayHostname: "second.example.com",
    enabled: true,
    runtimeStatus: "unknown",
    draftVersionId: "version-2",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.configVersions).values({
    id: "version-2",
    domainId: "domain-2",
    versionNumber: 1,
    status: "draft",
    changeSummary: "initial",
    snapshotJson: saved.json,
    snapshotChecksum: saved.checksum,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
  }).run();
  const request = (domainId: string, versionId: string, primaryHostname: string, expectedSnapshotChecksum: string) => app.request(`/api/domains/${domainId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersionId: versionId,
      expectedSnapshotChecksum,
      config: { ...baseConfig, primaryHostname, aliases: ["shared.example.com"] },
    }),
  });

  const responses = await Promise.all([
    request("domain-1", "version-1", "example.com", createSnapshot(baseConfig).checksum),
    request("domain-2", "version-2", "second.example.com", saved.checksum),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const conflict = responses.find((response) => response.status === 409)!;
  assert.equal((await conflict.json() as { code: string }).code, "DOMAIN_CONFLICT");
  assert.equal(db.select().from(schema.domainAliases)
    .where(eq(schema.domainAliases.hostname, "shared.example.com")).all().length, 1);
  assert.equal(db.select().from(schema.configVersions).all().length, 2);
  connection.close();
});

test("soft-deleted domains return DOMAIN_NOT_FOUND from both save endpoints", async () => {
  const patchFixture = createFixture(domainsRoute);
  patchFixture.db.update(schema.domains).set({ deletedAt: Date.now() })
    .where(eq(schema.domains.id, "domain-1")).run();
  const patchResponse = await patchFixture.app.request("/api/domains/domain-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersionId: "version-1", expectedSnapshotChecksum: patchFixture.checksum, config: baseConfig }),
  });
  assert.equal(patchResponse.status, 404);
  assert.equal((await patchResponse.json() as { code: string }).code, "DOMAIN_NOT_FOUND");
  patchFixture.connection.close();

  const versionFixture = createFixture(versionsRoute);
  versionFixture.db.update(schema.domains).set({ deletedAt: Date.now() })
    .where(eq(schema.domains.id, "domain-1")).run();
  const versionResponse = await versionFixture.app.request("/api/domains/domain-1/versions", {
    method: "POST",
    headers: { "content-type": "application/json", "if-match": `\"${versionFixture.checksum}\"` },
    body: JSON.stringify({ changeSummary: "save", config: baseConfig }),
  });
  assert.equal(versionResponse.status, 404);
  assert.equal((await versionResponse.json() as { code: string }).code, "DOMAIN_NOT_FOUND");
  versionFixture.connection.close();
});
