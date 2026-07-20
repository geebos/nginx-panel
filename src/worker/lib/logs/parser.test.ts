import assert from "node:assert/strict";
import test from "node:test";
import { matchesLogFilters, parseLogLine } from "@/worker/lib/logs/parser";

test("access parser normalizes numeric fields and applies filters", () => {
  const parsed = parseLogLine("access", '{"timestamp":"2026-07-19T10:00:00+08:00","method":"GET","status":"404","request_time":"0.12","path":"/missing"}');
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.fields.status, 404);
  assert.equal(parsed.fields.request_time, 0.12);
  assert.equal(matchesLogFilters(parsed, { keyword: "missing", method: "GET", status: 404 }), true);
  assert.equal(matchesLogFilters(parsed, { keyword: "", method: "POST", status: undefined }), false);
});

test("error parser preserves unparsed raw lines", () => {
  const parsed = parseLogLine("error", "custom error text\0");
  assert.equal(parsed.parsed, false);
  assert.equal(parsed.raw, "custom error text");
  assert.equal(matchesLogFilters(parsed, { keyword: "error", method: "", status: undefined }), true);
});
