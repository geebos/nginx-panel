import assert from "node:assert/strict";
import test from "node:test";
import { domainDisplayStatus } from "@/lib/domain-status";

test("domainDisplayStatus returns runtimeStatus when enabled", () => {
  assert.equal(domainDisplayStatus({ enabled: true, runtimeStatus: "running" }), "running");
  assert.equal(domainDisplayStatus({ enabled: true, runtimeStatus: "failed" }), "failed");
  assert.equal(domainDisplayStatus({ enabled: true, runtimeStatus: "unknown" }), "unknown");
});

test("domainDisplayStatus returns disabled when domain is off", () => {
  assert.equal(domainDisplayStatus({ enabled: false, runtimeStatus: "running" }), "disabled");
  assert.equal(domainDisplayStatus({ enabled: false, runtimeStatus: "failed" }), "disabled");
  assert.equal(domainDisplayStatus({ enabled: false, runtimeStatus: "unknown" }), "disabled");
});
