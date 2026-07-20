import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/shared/schemas";
import type { DomainConfig } from "@/shared/schemas";
import { checksum, createRuntimeManifest } from "@/worker/lib/runtime/manifest";
import { collectRuntimeDiagnostics, getActiveRuntimeConfig } from "@/worker/lib/runtime/diagnostics";
import { createSnapshot } from "@/worker/lib/snapshot";
import { getRuntimeState, setRuntimeState } from "@/worker/lib/runtime/state";

const snapshot: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: ["www.example.com"],
  routes: [],
  headers: [],
  ssl: {
    enabled: false,
    provider: "letsencrypt",
    environment: "production",
    email: "ops@example.com",
    autoRenew: true,
    forceHttps: false,
    validation: { method: "http-01" },
  },
  advanced: { serverSnippet: "" },
};

test("runtime diagnostics report storage without exposing non-log absolute paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runtime-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sqlite = join(root, "sqlite");
  const runtime = join(root, "runtime");
  const certificates = join(root, "certificates");
  const logs = join(root, "logs");
  await Promise.all([
    mkdir(sqlite),
    mkdir(join(runtime, "revisions", "old"), { recursive: true }),
    mkdir(certificates),
    mkdir(logs),
  ]);
  await writeFile(join(sqlite, "app.db"), "database");
  await writeFile(join(certificates, "fullchain.pem"), "certificate");
  await writeFile(join(runtime, "revisions", "old", "manifest.json"), JSON.stringify(createRuntimeManifest({
    rootConfig: "root",
    logSettings: { revision: 1, checksum: "a".repeat(64) },
    rootInputs: { runtimeRoot: runtime, logsRoot: join(root, "old-logs") },
    domains: {},
  })));

  const result = await collectRuntimeDiagnostics({ sqliteDirectory: sqlite, runtimeRoot: runtime, certificateRoot: certificates, logsRoot: logs });
  assert.equal(result.storage.every((item) => item.status === "available"), true);
  assert.equal(result.storage.find((item) => item.key === "sqlite")?.path, "<sqlite>/app.db");
  assert.equal(result.storage.find((item) => item.key === "sqlite")?.itemBytes, 8);
  assert.equal(result.storage.find((item) => item.key === "certificates")?.itemBytes, 11);
  assert.equal(result.logRoots.current?.path, logs);
  assert.deepEqual(result.logRoots.historical, [{ path: join(root, "old-logs"), readable: false }]);
});

test("active runtime config returns verified source metadata and redacted config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runtime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousState = getRuntimeState();
  t.after(() => setRuntimeState(previousState));
  const runtimeRoot = join(root, "runtime");
  const logsRoot = join(root, "logs");
  const certificateRoot = join(root, "certificates");
  const revision = "revision-1";
  const revisionRoot = join(runtimeRoot, "revisions", revision);
  await mkdir(join(revisionRoot, "domains"), { recursive: true });

  const connection = new Database(":memory:");
  t.after(() => connection.close());
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  const source = createSnapshot(snapshot);
  db.insert(schema.domains).values({ id: "domain-1", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "running", createdAt: now, updatedAt: now }).run();
  db.insert(schema.configVersions).values({ id: "version-1", domainId: "domain-1", versionNumber: 1, status: "active", changeSummary: "Initial", snapshotJson: source.json, snapshotChecksum: source.checksum, createdAt: now, updatedAt: now }).run();
  db.update(schema.domains).set({ activeVersionId: "version-1" }).run();

  const config = `server {\n  access_log "${logsRoot}/example.com/access.log";\n  root /srv/sites/example;\n  ssl_certificate ${certificateRoot}/domain-1/cert.pem;\n}\n`;
  const manifest = createRuntimeManifest({
    rootConfig: "root",
    logSettings: { revision: 2, checksum: "b".repeat(64) },
    rootInputs: { runtimeRoot, logsRoot },
    domains: {
      "domain-1": { sourceVersionId: "version-1", snapshotChecksum: source.checksum, enabled: true, certificateId: null, configChecksum: checksum(config) },
    },
  });
  await writeFile(join(revisionRoot, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(revisionRoot, "domains", "domain-1.conf"), config);
  setRuntimeState({ status: "healthy", checkedAt: now, activeRevision: revision, issues: [] });

  const result = await getActiveRuntimeConfig(db, "domain-1", { runtimeRoot, logsRoot, certificateRoot });
  assert.equal(result.revision, revision);
  assert.equal(result.checksums.config, checksum(config));
  assert.equal(result.inputs.sourceVersionId, "version-1");
  assert.match(result.config, /<logs>\/example\.com\/access\.log/);
  assert.match(result.config, /root <absolute-path>/);
  assert.match(result.config, /ssl_certificate <certificates>\/domain-1\/cert\.pem/);
  assert.equal(result.config.includes(root), false);

  await writeFile(join(revisionRoot, "manifest.json"), JSON.stringify({
    ...manifest,
    domains: { ...manifest.domains, "domain-1": { ...manifest.domains["domain-1"], sourceVersionId: "version-tampered" } },
  }));
  await assert.rejects(
    () => getActiveRuntimeConfig(db, "domain-1", { runtimeRoot, logsRoot, certificateRoot }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ACTIVE_RUNTIME_CONFIG_INVALID",
  );
});
