import assert from "node:assert/strict";
import test from "node:test";
import {
  initialChallengeStatus,
  postPrepareNextPollAt,
  postPrepareOrderStatus,
} from "@/worker/lib/acme/prepare-status";

const NOW = 1_700_000_000_000;

test("prepare presentation policy table", () => {
  // http-01 (dnsProvider ignored for challenge)
  assert.equal(
    initialChallengeStatus({ challengeType: "http-01", dnsProvider: "cloudflare" }),
    "presented",
  );
  assert.equal(
    postPrepareOrderStatus({ dnsProvider: null, validationMethod: "http-01" }),
    "waiting_http",
  );
  assert.equal(
    postPrepareNextPollAt(NOW, { dnsProvider: null, validationMethod: "http-01" }),
    NOW + 5_000,
  );

  // manual dns-01
  assert.equal(
    initialChallengeStatus({ challengeType: "dns-01", dnsProvider: null }),
    "propagating",
  );
  assert.equal(
    postPrepareOrderStatus({ dnsProvider: null, validationMethod: "dns-01" }),
    "waiting_dns",
  );
  assert.equal(
    postPrepareNextPollAt(NOW, { dnsProvider: null, validationMethod: "dns-01" }),
    NOW + 15_000,
  );

  // cloudflare dns-01 (validationMethod ignored for order)
  assert.equal(
    initialChallengeStatus({ challengeType: "dns-01", dnsProvider: "cloudflare" }),
    "pending",
  );
  assert.equal(
    postPrepareOrderStatus({ dnsProvider: "cloudflare", validationMethod: "http-01" }),
    "preparing",
  );
  assert.equal(
    postPrepareNextPollAt(NOW, { dnsProvider: "cloudflare", validationMethod: "dns-01" }),
    NOW,
  );
});
