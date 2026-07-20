import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as schema from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { createSnapshot } from "@/worker/lib/snapshot";
import { defaultLogSettings, logSettingsChecksum } from "@/worker/lib/log-settings";
import { checksum, createRuntimeManifest } from "@/worker/lib/runtime/manifest";
import { verifyRuntime } from "@/worker/lib/runtime/verifier";

function createDb(
  domainRows: Array<typeof schema.domains.$inferSelect>,
  versionRows: Array<typeof schema.configVersions.$inferSelect>,
) {
  const db = {
    query: { settings: { findFirst: async () => undefined } },
    select: () => ({
      from: (table: unknown) => ({
        where: async () => table === schema.domains ? domainRows : versionRows,
      }),
    }),
  };
  return db as unknown as AppEnv["Variables"]["db"];
}

const snapshot = {
  schemaVersion: 1 as const,
  primaryHostname: "example.com",
  aliases: [],
  routes: [{ id: "root", type: "redirect" as const, path: "/", target: "https://example.org", statusCode: 302 as const, enabled: true, order: 0 }],
  headers: [],
  ssl: { enabled: false, provider: "letsencrypt" as const, environment: "production" as const, email: "", autoRenew: true, forceHttps: false, validation: { method: "http-01" as const } },
  advanced: { serverSnippet: "" },
};

test("runtime verifier accepts a complete revision and rejects source projection drift", async (t) => {
  const previousMode = process.env.RUNTIME_MODE;
  process.env.RUNTIME_MODE = "nginx-manager";
  t.after(() => { process.env.RUNTIME_MODE = previousMode; });
  const root = await mkdtemp(join(tmpdir(), "nginx-runtime-verifier-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logsRoot = join(root, "logs");
  const revision = join(root, "revisions", "rev-1");
  await mkdir(join(revision, "domains"), { recursive: true });
  await mkdir(logsRoot);
  await symlink("revisions/rev-1", join(root, "active"));

  const saved = createSnapshot(snapshot);
  const versionRows: Array<typeof schema.configVersions.$inferSelect> = [{ id: "version-1", domainId: "domain-1", versionNumber: 1, status: "active", sourceVersionId: null, sourceCertificateId: null, changeSummary: "test", snapshotJson: saved.json, snapshotChecksum: saved.checksum, createdBy: null, createdAt: 1, updatedAt: 1 }];
  const domainRows: Array<typeof schema.domains.$inferSelect> = [{ id: "domain-1", type: "domain", primaryHostname: "example.com", displayHostname: "example.com", enabled: true, runtimeStatus: "running", activeVersionId: "version-1", draftVersionId: null, createdAt: 1, updatedAt: 1, deletedAt: null }];
  const db = createDb(domainRows, versionRows);

  const rootConfig = "events {}\nhttp { include domains/*.conf; }\n";
  const domainConfig = "server { listen 8080; }\n";
  await writeFile(join(revision, "nginx.conf"), rootConfig);
  await writeFile(join(revision, "domains", "domain-1.conf"), domainConfig);
  const manifest = createRuntimeManifest({
    rootConfig,
    logSettings: { revision: 0, checksum: logSettingsChecksum(defaultLogSettings) },
    rootInputs: { logsRoot, runtimeRoot: root },
    domains: { "domain-1": { sourceVersionId: "version-1", snapshotChecksum: saved.checksum, enabled: true, certificateId: null, configChecksum: checksum(domainConfig) } },
  });
  await writeFile(join(revision, "manifest.json"), JSON.stringify(manifest));

  const healthy = await verifyRuntime(db, { runtimeRoot: root, logsRoot, runNginxTest: async () => undefined });
  assert.equal(healthy.status, "healthy");

  domainRows[0].enabled = false;
  const drifted = await verifyRuntime(db, { runtimeRoot: root, logsRoot, runNginxTest: async () => undefined });
  assert.equal(drifted.status, "degraded");
  assert.equal(drifted.issues[0]?.code, "SOURCE_PROJECTION_MISMATCH");
});

test("runtime verifier rejects unexpected files without following them", async (t) => {
  const previousMode = process.env.RUNTIME_MODE;
  process.env.RUNTIME_MODE = "nginx-manager";
  t.after(() => { process.env.RUNTIME_MODE = previousMode; });
  const root = await mkdtemp(join(tmpdir(), "nginx-runtime-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logsRoot = join(root, "logs");
  const revision = join(root, "revisions", "rev-1");
  await mkdir(join(revision, "domains"), { recursive: true });
  await mkdir(logsRoot);
  await symlink("revisions/rev-1", join(root, "active"));
  const db = createDb([], []);
  const rootConfig = "events {}\n";
  await writeFile(join(revision, "nginx.conf"), rootConfig);
  await writeFile(join(revision, "domains", "unexpected.conf"), "server {}\n");
  await writeFile(join(revision, "manifest.json"), JSON.stringify(createRuntimeManifest({
    rootConfig,
    logSettings: { revision: 0, checksum: logSettingsChecksum(defaultLogSettings) },
    rootInputs: { logsRoot, runtimeRoot: root },
    domains: {},
  })));
  const state = await verifyRuntime(db, { runtimeRoot: root, logsRoot, runNginxTest: async () => undefined });
  assert.equal(state.status, "degraded");
  assert.equal(state.issues[0]?.code, "DOMAIN_FILE_SET_MISMATCH");
});
