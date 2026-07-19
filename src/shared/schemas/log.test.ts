import assert from "node:assert/strict";
import test from "node:test";
import { logColumnPreferenceSchema, logQuerySchema } from "./log";

test("log query normalizes multi-types and preserves legacy type compatibility", () => {
  assert.deepEqual(logQuerySchema.parse({ domainId: "domain-1", types: "error,access,error" }).types, ["access", "error"]);
  assert.deepEqual(logQuerySchema.parse({ domainId: "domain-1", type: "all" }).types, ["access", "error"]);
  assert.deepEqual(logQuerySchema.parse({ domainId: "domain-1", type: "access" }).types, ["access"]);
  assert.equal(logQuerySchema.safeParse({ domainId: "domain-1", types: "access", type: "error" }).success, false);
  assert.equal(logQuerySchema.safeParse({ domainId: "domain-1", types: "unknown" }).success, false);
});

test("log column preferences reject duplicate columns", () => {
  assert.equal(logColumnPreferenceSchema.safeParse({ schemaVersion: 1, columns: [{ id: "timestamp", visible: true }, { id: "timestamp", visible: false }] }).success, false);
  assert.equal(logColumnPreferenceSchema.safeParse({ schemaVersion: 1, columns: [{ id: "raw", visible: true }] }).success, true);
});
