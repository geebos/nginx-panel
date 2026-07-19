import assert from "node:assert/strict";
import test from "node:test";
import { consumeNdjsonStream } from "./log-stream";

test("NDJSON consumer preserves split UTF-8 records and skips malformed lines", async () => {
  const encoder = new TextEncoder();
  const payload = encoder.encode('{"type":"heartbeat","at":"第二行"}\nnot-json\n{"type":"end","reason":"stream_limit"}\n');
  const records: unknown[] = [];
  const malformed: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload.subarray(0, 34));
      controller.enqueue(payload.subarray(34, 39));
      controller.enqueue(payload.subarray(39));
      controller.close();
    },
  });
  await consumeNdjsonStream(body, (record) => records.push(record), (line) => malformed.push(line));
  assert.equal(records.length, 2);
  assert.deepEqual(malformed, ["not-json"]);
});
