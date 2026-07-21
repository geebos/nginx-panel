import assert from "node:assert/strict";
import test from "node:test";
import { certificateDisplayStatus } from "@/lib/certificate-status";
import { certificateRenewalWindowMs } from "@/shared/schemas";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test("certificateDisplayStatus prefers failed over expiry", () => {
  assert.equal(
    certificateDisplayStatus({ status: "failed", notAfter: NOW + 10 * DAY }, NOW),
    "failed",
  );
  assert.equal(
    certificateDisplayStatus({ status: "failed", notAfter: NOW - DAY }, NOW),
    "failed",
  );
  assert.equal(
    certificateDisplayStatus({ status: "failed", notAfter: null }, NOW),
    "failed",
  );
});

test("certificateDisplayStatus returns expired when notAfter is past", () => {
  assert.equal(
    certificateDisplayStatus({ status: "active", notAfter: NOW }, NOW),
    "expired",
  );
  assert.equal(
    certificateDisplayStatus({ status: "active", notAfter: NOW - 1 }, NOW),
    "expired",
  );
  assert.equal(
    certificateDisplayStatus({ status: "ready", notAfter: NOW - DAY }, NOW),
    "expired",
  );
});

test("certificateDisplayStatus returns expiring for active certs inside the window", () => {
  assert.equal(
    certificateDisplayStatus(
      { status: "active", notAfter: NOW + certificateRenewalWindowMs },
      NOW,
    ),
    "expiring",
  );
  assert.equal(
    certificateDisplayStatus({ status: "active", notAfter: NOW + 1 }, NOW),
    "expiring",
  );
});

test("certificateDisplayStatus returns active just outside the expiring window", () => {
  assert.equal(
    certificateDisplayStatus(
      { status: "active", notAfter: NOW + certificateRenewalWindowMs + 1 },
      NOW,
    ),
    "active",
  );
});

test("certificateDisplayStatus passes through non-active statuses when not expired", () => {
  assert.equal(
    certificateDisplayStatus({ status: "ready", notAfter: NOW + 40 * DAY }, NOW),
    "ready",
  );
  assert.equal(
    certificateDisplayStatus({ status: "superseded", notAfter: NOW + 40 * DAY }, NOW),
    "superseded",
  );
});

test("certificateDisplayStatus ignores null notAfter for expiry checks", () => {
  assert.equal(
    certificateDisplayStatus({ status: "active", notAfter: null }, NOW),
    "active",
  );
  assert.equal(
    certificateDisplayStatus({ status: "ready", notAfter: null }, NOW),
    "ready",
  );
});
