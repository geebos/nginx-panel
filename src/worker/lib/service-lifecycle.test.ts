import assert from "node:assert/strict";
import test from "node:test";
import { BusinessError } from "./errors";
import {
  assertAcceptingLogStreams,
  assertAcceptingWrites,
  beginServiceShutdown,
  getServiceLifecycle,
  registerLogStream,
  resetServiceLifecycleForTests,
  startJobRunnerHeartbeat,
} from "./service-lifecycle";

test("service shutdown rejects new writes, ends streams, and keeps a fresh runner heartbeat", async (t) => {
  resetServiceLifecycleForTests();
  t.after(resetServiceLifecycleForTests);
  let now = 1_000;
  const stopHeartbeat = startJobRunnerHeartbeat({ intervalMs: 60_000, now: () => now });
  t.after(stopHeartbeat);
  assert.equal(getServiceLifecycle(now).jobRunnerHealthy, true);

  let ended = false;
  const unregister = registerLogStream(async () => { ended = true; });
  await beginServiceShutdown();
  unregister();

  assert.equal(ended, true);
  assert.throws(assertAcceptingWrites, (error: unknown) => error instanceof BusinessError && error.code === "SERVER_SHUTTING_DOWN");
  assert.throws(assertAcceptingLogStreams, (error: unknown) => error instanceof BusinessError && error.code === "SERVER_SHUTTING_DOWN");
  now += 31_000;
  assert.equal(getServiceLifecycle(now).jobRunnerHealthy, false);
});
