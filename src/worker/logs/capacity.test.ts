import assert from "node:assert/strict";
import test from "node:test";
import { LogStreamCapacity } from "./capacity";

test("log stream capacity enforces instance and session limits and releases once", () => {
  const capacity = new LogStreamCapacity(2, 1);
  const releaseFirst = capacity.acquire("session-a");
  assert.throws(() => capacity.acquire("session-a"), (error: unknown) => (
    typeof error === "object" && error !== null && "code" in error && error.code === "LOG_STREAM_CAPACITY_EXCEEDED"
  ));
  const releaseSecond = capacity.acquire("session-b");
  assert.throws(() => capacity.acquire("session-c"));
  releaseFirst();
  releaseFirst();
  const releaseThird = capacity.acquire("session-c");
  releaseSecond();
  releaseThird();
});
