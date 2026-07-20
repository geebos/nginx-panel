import assert from "node:assert/strict";
import test from "node:test";
import { drainWorker } from "@/worker/lib/graceful-shutdown";
import { resetServiceLifecycleForTests } from "@/worker/lib/service-lifecycle";

test("worker drain stops producers, ends streams, waits for work, then closes the server", async (t) => {
  resetServiceLifecycleForTests();
  t.after(resetServiceLifecycleForTests);
  const events: string[] = [];
  const server = {
    close(callback: (error?: Error) => void) { events.push("server-close"); callback(); },
  };
  const result = await drainWorker({
    server,
    timeoutMs: 100,
    stopProducers: [() => { events.push("stop-producer"); }],
    persistAcmeState: async () => { events.push("persist-acme"); },
    waitForWork: [async () => { events.push("wait-work"); }],
    markInterrupted: async () => { events.push("mark-interrupted"); },
  });

  assert.equal(result.timedOut, false);
  assert.deepEqual(events, ["stop-producer", "persist-acme", "server-close", "wait-work"]);
});

test("worker drain marks running tasks interrupted when the deadline expires", async () => {
  let interrupted = false;
  const result = await drainWorker({
    server: { close() {}, closeAllConnections() {} },
    timeoutMs: 5,
    stopProducers: [],
    persistAcmeState: async () => undefined,
    waitForWork: [() => new Promise(() => undefined)],
    markInterrupted: async () => { interrupted = true; },
  });
  assert.equal(result.timedOut, true);
  assert.equal(interrupted, true);
});
