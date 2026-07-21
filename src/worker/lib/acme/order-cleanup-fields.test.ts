import assert from "node:assert/strict";
import test from "node:test";
import {
  orderCleanupNextPollAt,
  orderCleanupStatus,
} from "@/worker/lib/acme/order-cleanup-fields";

test("orderCleanupStatus is pending only for cloudflare", () => {
  assert.equal(orderCleanupStatus("cloudflare"), "pending");
  assert.equal(orderCleanupStatus(null), "succeeded");
  assert.equal(orderCleanupStatus("manual"), "succeeded");
  assert.equal(orderCleanupStatus(undefined), "succeeded");
});

test("orderCleanupNextPollAt schedules now only for cloudflare", () => {
  const now = 1_700_000_000_000;
  assert.equal(orderCleanupNextPollAt("cloudflare", now), now);
  assert.equal(orderCleanupNextPollAt(null, now), null);
  assert.equal(orderCleanupNextPollAt("manual", now), null);
});
