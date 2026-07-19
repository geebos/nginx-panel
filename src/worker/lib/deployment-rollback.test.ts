import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import type { DomainConfig } from "@/shared/schemas";
import { createSnapshot } from "./snapshot";
import { createRollbackDeployment } from "./deployment-runner";
import { setRuntimeHealthy } from "./runtime-state";

const config: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: [],
  routes: [],
  headers: [],
  ssl: { enabled: false, provider: "letsencrypt", environment: "production", email: "", autoRenew: true, forceHttps: false, validation: { method: "http-01" } },
  advanced: { serverSnippet: "" },
};

function fixture() {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const v1 = createSnapshot(config);
  const v2 = createSnapshot({ ...config, aliases: ["www.example.com"] });
  db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: "unused", createdAt: now, updatedAt: now }).run();
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "running", activeVersionId: "version-2", createdAt: now, updatedAt: now }).run();
  db.insert(schema.configVersions).values([
    { id: "version-1", domainId: "domain-1", versionNumber: 1, status: "superseded", changeSummary: "initial", snapshotJson: v1.json, snapshotChecksum: v1.checksum, createdBy: "user-1", createdAt: now, updatedAt: now },
    { id: "version-2", domainId: "domain-1", versionNumber: 2, status: "active", changeSummary: "add alias", snapshotJson: v2.json, snapshotChecksum: v2.checksum, createdBy: "user-1", createdAt: now, updatedAt: now },
  ]).run();
  setRuntimeHealthy("rollback-test");
  return { connection, db, v1 };
}

test("rollback copies a historical snapshot into a new queued version and is idempotent", async () => {
  const { connection, db, v1 } = fixture();
  const first = await createRollbackDeployment(db, { domainId: "domain-1", sourceVersionId: "version-1", requestedBy: "user-1", idempotencyKey: "rollback-1" });
  assert.equal(first.version?.versionNumber, 3);
  assert.equal(first.version?.sourceVersionId, "version-1");
  assert.equal(first.version?.snapshotChecksum, v1.checksum);
  assert.equal(first.deployment.type, "rollback");
  assert.equal(first.deployment.previousVersionId, "version-2");
  assert.equal(first.deployment.status, "queued");
  const domain = db.select().from(schema.domains).where(eq(schema.domains.id, "domain-1")).get();
  assert.equal(domain?.activeVersionId, "version-2");
  assert.equal(domain?.draftVersionId, first.version?.id);

  const repeated = await createRollbackDeployment(db, { domainId: "domain-1", sourceVersionId: "version-1", requestedBy: "user-1", idempotencyKey: "rollback-1" });
  assert.equal(repeated.deployment.id, first.deployment.id);
  assert.equal(db.select().from(schema.configVersions).all().length, 3);
  connection.close();
});

test("rollback refuses to overwrite an unpublished draft", async () => {
  const { connection, db } = fixture();
  db.update(schema.domains).set({ draftVersionId: "version-1" }).where(eq(schema.domains.id, "domain-1")).run();
  await assert.rejects(
    () => createRollbackDeployment(db, { domainId: "domain-1", sourceVersionId: "version-1", requestedBy: "user-1", idempotencyKey: "rollback-2" }),
    (error: unknown) => error instanceof Error && error.message.includes("未发布草稿"),
  );
  assert.equal(db.select().from(schema.deployments).all().length, 0);
  connection.close();
});
