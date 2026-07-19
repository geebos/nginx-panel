import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { followLogFiles, type LogFollowEvent } from "./follower";

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timed out waiting for log event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("follower buffers half lines and continues after inode rotation", async () => {
  const root = await mkdtemp(join(tmpdir(), "nginx-log-follow-"));
  const path = join(root, "access.log");
  await writeFile(path, "existing\n");
  const controller = new AbortController();
  const events: LogFollowEvent[] = [];
  const following = followLogFiles(
    [{ domainId: "domain-1", hostname: "example.test", logType: "access", path }],
    {
      signal: controller.signal,
      pollIntervalMs: 5,
      heartbeatMs: 60_000,
      emit: async (event) => { events.push(event); },
      heartbeat: async () => undefined,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  await appendFile(path, "partial");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 0);
  await appendFile(path, " line\n");
  await waitFor(() => events.some((event) => event.type === "line"));
  assert.equal(events.find((event) => event.type === "line" && event.line === "partial line")?.type, "line");

  const largeLine = "x".repeat(70_000);
  await appendFile(path, `${largeLine}\n`);
  await rename(path, `${path}.1`);
  await writeFile(path, "new inode\n");
  await waitFor(() => events.some((event) => event.type === "rotated"));
  await waitFor(() => events.some((event) => event.type === "line" && event.line === "new inode"));
  const largeLineIndex = events.findIndex((event) => event.type === "line" && event.truncated);
  const rotationIndex = events.findIndex((event) => event.type === "rotated");
  assert.ok(largeLineIndex >= 0 && largeLineIndex < rotationIndex);
  controller.abort();
  assert.equal(await following, "aborted");
});
