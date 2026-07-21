import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveManagerKey, loadMasterKey } from "@/worker/lib/master-key";

async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("loadMasterKey returns file contents when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "master-key-"));
  const path = join(dir, "master.key");
  await writeFile(path, "file-master-key-bytes");
  await withEnv({ APP_ENV: "production", NGINX_MANAGER_MASTER_KEY_FILE: path }, async () => {
    const key = await loadMasterKey();
    assert.equal(key.toString(), "file-master-key-bytes");
  });
});

test("loadMasterKey rethrows original error outside development", async () => {
  await withEnv({
    APP_ENV: "production",
    NGINX_MANAGER_MASTER_KEY_FILE: join(tmpdir(), "missing-master-key-does-not-exist"),
    NGINX_MANAGER_DEV_MASTER_KEY: undefined,
  }, async () => {
    await assert.rejects(loadMasterKey(), (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, "ENOENT");
      return true;
    });
  });
});

test("loadMasterKey uses development fallback when file is missing", async () => {
  await withEnv({
    APP_ENV: "development",
    NGINX_MANAGER_MASTER_KEY_FILE: join(tmpdir(), "missing-master-key-does-not-exist"),
    NGINX_MANAGER_DEV_MASTER_KEY: "custom-dev-master",
  }, async () => {
    const key = await loadMasterKey();
    assert.equal(key.toString(), "custom-dev-master");
  });
});

test("loadMasterKey uses default development key when env override is absent", async () => {
  await withEnv({
    APP_ENV: "development",
    NGINX_MANAGER_MASTER_KEY_FILE: join(tmpdir(), "missing-master-key-does-not-exist"),
    NGINX_MANAGER_DEV_MASTER_KEY: undefined,
  }, async () => {
    const key = await loadMasterKey();
    assert.equal(key.toString(), "nginx-manager-development-key");
  });
});

test("deriveManagerKey matches hkdf formula and differs by info", () => {
  const master = Buffer.from("fixed-master");
  const expected = Buffer.from(hkdfSync("sha256", master, "nginx-domain-manager", "auth-attempts-v1", 32));
  assert.deepEqual(deriveManagerKey(master, "auth-attempts-v1"), expected);
  assert.notDeepEqual(
    deriveManagerKey(master, "auth-attempts-v1"),
    deriveManagerKey(master, "cloudflare-credentials-v1"),
  );
});
