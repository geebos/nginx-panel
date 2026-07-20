import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLastLines, sanitizeLogLine } from "@/worker/lib/logs/reader";

test("reverse reader returns bounded complete UTF-8 lines", async () => {
  const root = await mkdtemp(join(tmpdir(), "nginx-log-reader-"));
  const path = join(root, "access.log");
  await writeFile(path, "first\n第二行\nthird\nfourth\n");
  const result = await readLastLines(path, 2);
  assert.deepEqual(result.lines, ["third", "fourth"]);
  assert.equal(result.truncated, true);
});

test("reverse reader preserves a UTF-8 character split across chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "nginx-log-reader-"));
  const path = join(root, "access.log");
  const splitLine = `${"x".repeat(65_535)}界`;
  await writeFile(path, `${splitLine}\nlast\n`);
  const result = await readLastLines(path, 2);
  assert.deepEqual(result.lines, [splitLine, "last"]);
});

test("log sanitizer removes terminal controls and bounds raw lines", () => {
  assert.equal(sanitizeLogLine("ok\0\u0007text"), "oktext");
  assert.equal(sanitizeLogLine("x".repeat(70_000)).length, 64 * 1024);
});
