import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshActiveRoot } from "../../../../docker/scripts/runtime-root.mjs";
import { checksum } from "@/worker/lib/runtime/manifest";

test("startup refreshes a persisted active root without changing its domain projection", async (t) => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "nginx-root-refresh-"));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  const revision = join(runtimeRoot, "revisions", "rev-1");
  await mkdir(join(revision, "domains"), { recursive: true });

  const oldRoot = `http {
  # nginx-manager:log-format:start
  log_format domain_manager 'custom';
  # nginx-manager:log-format:end
  server { listen 8080; server_name localhost; }
  include domains/*.conf;
}
`;
  const currentTemplate = `http {
  # nginx-manager:log-format:start
  log_format domain_manager 'default';
  # nginx-manager:log-format:end
  server { listen 8080 default_server; server_name _; return 444; }
  server { listen 8080; server_name localhost; }
  include domains/*.conf;
}
`;
  const domainConfig = "server { listen 8080; server_name example.com; }\n";
  await writeFile(join(revision, "nginx.conf"), oldRoot);
  await writeFile(join(revision, "domains", "domain-1.conf"), domainConfig);
  await writeFile(join(revision, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    rootConfigChecksum: checksum(oldRoot),
    logSettings: { revision: 1, checksum: "a".repeat(64) },
    rootInputs: { logsRoot: "/data/logs", runtimeRoot },
    domains: { "domain-1": { sourceVersionId: "version-1" } },
  }));
  await symlink("revisions/rev-1", join(runtimeRoot, "active"));

  const changed = refreshActiveRoot({
    runtimeRoot,
    rootConfig: currentTemplate,
    validate: () => undefined,
  });

  assert.equal(changed, true);
  const activeTarget = await readlink(join(runtimeRoot, "active"));
  assert.notEqual(activeTarget, "revisions/rev-1");
  const activeRoot = join(runtimeRoot, activeTarget);
  const refreshedRoot = await readFile(join(activeRoot, "nginx.conf"), "utf8");
  assert.match(refreshedRoot, /listen 8080 default_server/);
  assert.match(refreshedRoot, /log_format domain_manager 'custom'/);
  assert.equal(await readFile(join(activeRoot, "domains", "domain-1.conf"), "utf8"), domainConfig);
  const refreshedManifest = JSON.parse(await readFile(join(activeRoot, "manifest.json"), "utf8"));
  assert.equal(refreshedManifest.rootConfigChecksum, checksum(refreshedRoot));
  assert.deepEqual(refreshedManifest.domains, { "domain-1": { sourceVersionId: "version-1" } });
  assert.equal(await readFile(join(revision, "nginx.conf"), "utf8"), oldRoot);
});
