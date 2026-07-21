import assert from "node:assert/strict";
import test from "node:test";
import { sslConfigStatus } from "@/shared/schemas/domain";

test("sslConfigStatus returns active when certificateId is set", () => {
  assert.equal(sslConfigStatus({ certificateId: "cert-1", enabled: true }), "active");
  assert.equal(sslConfigStatus({ certificateId: "cert-1", enabled: false }), "active");
});

test("sslConfigStatus returns pending when enabled without a certificateId", () => {
  assert.equal(sslConfigStatus({ enabled: true }), "pending");
  assert.equal(sslConfigStatus({ certificateId: undefined, enabled: true }), "pending");
  assert.equal(sslConfigStatus({ certificateId: null, enabled: true }), "pending");
  assert.equal(sslConfigStatus({ certificateId: "", enabled: true }), "pending");
});

test("sslConfigStatus returns disabled when SSL is off and unbound", () => {
  assert.equal(sslConfigStatus({ enabled: false }), "disabled");
  assert.equal(sslConfigStatus({ certificateId: "", enabled: false }), "disabled");
  assert.equal(sslConfigStatus({ certificateId: null, enabled: false }), "disabled");
});
