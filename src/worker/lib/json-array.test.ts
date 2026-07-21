import assert from "node:assert/strict";
import test from "node:test";
import { parseStringArrayJson } from "@/worker/lib/json-array";

test("parseStringArrayJson returns a string array for valid JSON arrays", () => {
  assert.deepEqual(parseStringArrayJson('["a","b"]'), ["a", "b"]);
});

test("parseStringArrayJson throws on invalid JSON", () => {
  assert.throws(() => parseStringArrayJson("{not-json"), SyntaxError);
});

test("parseStringArrayJson keeps prior cast semantics for non-array JSON", () => {
  // Document current cast semantics: no Array.isArray guard (same as before extract).
  assert.equal(parseStringArrayJson("null"), null);
  assert.deepEqual(parseStringArrayJson('{"a":1}'), { a: 1 });
  assert.equal(parseStringArrayJson('"x"'), "x");
});
