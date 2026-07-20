import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { restoreFile, rotateFile } from "@/worker/lib/logs/rotator";

test("rotation shifts retained files and can restore before reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "nginx-log-rotate-"));
  const path = join(root, "access.log");
  await writeFile(path, "current");
  await writeFile(`${path}.1`, "previous-1");
  await writeFile(`${path}.2`, "previous-2");

  const rotated = await rotateFile(path, 2);
  assert.equal(await readFile(`${path}.1`, "utf8"), "current");
  assert.equal(await readFile(`${path}.2`, "utf8"), "previous-1");
  assert.equal(await readFile(rotated.backupPath, "utf8"), "previous-2");

  assert.equal(await restoreFile(rotated), true);
  assert.equal(await readFile(path, "utf8"), "current");
  assert.equal(await readFile(`${path}.1`, "utf8"), "previous-1");
  assert.equal(await readFile(`${path}.2`, "utf8"), "previous-2");
});
