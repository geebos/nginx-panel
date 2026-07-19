import assert from "node:assert/strict";
import { mkdir, readlink, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/shared/schemas";
import { assertRuntimeStorageCapacity, cleanupRuntimeStorage, getRuntimeStorageSnapshot, MIB } from "./runtime-storage";
import { setRuntimeState } from "./runtime-state";

async function createArtifact(root: string, collection: "revisions" | "candidates" | "backups", id: string, bytes: number, modifiedAt: number) {
  const directory = join(root, collection, id);
  await mkdir(directory, { recursive: true });
  const file = join(directory, "artifact.bin");
  await writeFile(file, "");
  await truncate(file, bytes);
  await utimes(directory, modifiedAt / 1_000, modifiedAt / 1_000);
}

test("runtime cleanup preserves active and previous successful revisions while removing older artifacts", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "nginx-runtime-storage-"));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));

  const connection = new Database(":memory:");
  t.after(() => connection.close());
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  for (const [index, id] of ["rev-1", "rev-2", "rev-3"].entries()) {
    await createArtifact(runtimeRoot, "revisions", id, 300 * MIB, now - (3 - index) * 1_000);
    db.insert(schema.deployments).values({
      id,
      type: "deploy",
      status: "succeeded",
      idempotencyKey: id,
      createdAt: index + 1,
      finishedAt: index + 1,
    }).run();
  }
  await symlink("revisions/rev-3", join(runtimeRoot, "active"));
  await createArtifact(runtimeRoot, "backups", "failed-old", MIB, now - 8 * 86_400_000);
  await createArtifact(runtimeRoot, "candidates", "running-rev", 500 * MIB, now - 8 * 86_400_000);
  db.insert(schema.deployments).values({
    id: "running-rev",
    type: "deploy",
    status: "running",
    idempotencyKey: "running-rev",
    createdAt: now,
  }).run();

  const result = await cleanupRuntimeStorage(db, { runtimeRoot, maxBytes: 650 * MIB, now });

  assert.deepEqual(result.protectedRevisionIds, ["rev-2", "rev-3"]);
  assert.equal(result.minimumAllowedBytes, 600 * MIB);
  assert.equal(result.usedBytes, 600 * MIB);
  assert.equal(result.locked, true);
  assert.equal(result.removed.some((item) => item.id === "rev-1"), true);
  assert.equal(result.removed.some((item) => item.id === "failed-old"), true);
  assert.equal(result.removed.some((item) => item.id === "running-rev"), false);
  await assert.rejects(stat(join(runtimeRoot, "revisions", "rev-1")), { code: "ENOENT" });
  await assert.rejects(stat(join(runtimeRoot, "backups", "failed-old")), { code: "ENOENT" });
  assert.equal((await stat(join(runtimeRoot, "candidates", "running-rev"))).isDirectory(), true);
  assert.equal(await readlink(join(runtimeRoot, "active")), "revisions/rev-3");
});

test("runtime storage snapshot reads the persisted quota and reports the next revision capacity gate", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "nginx-runtime-storage-"));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));

  const connection = new Database(":memory:");
  t.after(() => connection.close());
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  await createArtifact(runtimeRoot, "revisions", "active-rev", 300 * MIB, now);
  await symlink("revisions/active-rev", join(runtimeRoot, "active"));
  db.insert(schema.deployments).values({ id: "active-rev", type: "deploy", status: "succeeded", idempotencyKey: "active-rev", createdAt: now, finishedAt: now }).run();
  db.insert(schema.settings).values({ key: "runtime_storage", valueJson: JSON.stringify({ revisionMaxBytes: 512 * MIB }), updatedAt: now }).run();

  const result = await getRuntimeStorageSnapshot(db, { runtimeRoot });

  assert.equal(result.maxBytes, 512 * MIB);
  assert.equal(result.usedBytes, 300 * MIB);
  assert.equal(result.projectedBytes, 600 * MIB);
  assert.equal(result.locked, true);
  setRuntimeState({ status: "healthy", checkedAt: now, activeRevision: "active-rev", issues: [] });
  t.after(() => setRuntimeState({ status: "checking", checkedAt: null, activeRevision: null, issues: [] }));
  await assert.rejects(assertRuntimeStorageCapacity(db, { runtimeRoot }), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "REVISION_STORAGE_LIMIT_EXCEEDED";
  });
});
