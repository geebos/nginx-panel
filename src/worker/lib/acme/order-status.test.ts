import assert from "node:assert/strict";
import test from "node:test";
import {
  recheckableOrderStatuses as sharedRecheckableOrderStatuses,
  terminalOrderStatuses as sharedTerminalOrderStatuses,
} from "@/shared/schemas";
import {
	RECHECK_DEBOUNCE_MS,
	activeOrderStatuses,
	downloadableOrderStatuses,
	recheckableOrderStatuses,
	terminalOrderStatuses,
} from "@/worker/lib/acme/order-status";

test("terminalOrderStatuses matches the known terminal set in order", () => {
	assert.deepEqual(terminalOrderStatuses, [
		"succeeded",
		"failed",
		"expired",
		"cancelled",
	]);
});

test("worker terminalOrderStatuses is the shared schema export", () => {
	assert.equal(terminalOrderStatuses, sharedTerminalOrderStatuses);
});

test("activeOrderStatuses matches the known in-flight set in order", () => {
	assert.deepEqual(activeOrderStatuses, [
		"preparing",
		"waiting_http",
		"waiting_dns",
		"validating",
		"validated",
		"downloading",
	]);
});

test("recheckableOrderStatuses matches the manual recheck set in order", () => {
	assert.deepEqual(recheckableOrderStatuses, [
		"waiting_http",
		"waiting_dns",
		"validating",
	]);
});

test("worker recheckableOrderStatuses is the shared schema export", () => {
  assert.equal(recheckableOrderStatuses, sharedRecheckableOrderStatuses);
});


test("active and terminal order statuses do not overlap", () => {
	for (const status of activeOrderStatuses) {
		assert.equal(terminalOrderStatuses.includes(status), false);
	}
	for (const status of terminalOrderStatuses) {
		assert.equal(activeOrderStatuses.includes(status), false);
	}
});

test("recheckableOrderStatuses is a subset of activeOrderStatuses", () => {
	for (const status of recheckableOrderStatuses) {
		assert.equal(activeOrderStatuses.includes(status), true);
		assert.equal(terminalOrderStatuses.includes(status), false);
	}
});

test("recheckableOrderStatuses excludes preparing validated downloading", () => {
	for (const status of ["preparing", "validated", "downloading"]) {
		assert.equal(recheckableOrderStatuses.includes(status), false);
	}
});

test("progressable ACME statuses are active without preparing", () => {
	const progressable = activeOrderStatuses.filter(
		(status) => status !== "preparing",
	);
	assert.deepEqual(progressable, [
		"waiting_http",
		"waiting_dns",
		"validating",
		"validated",
		"downloading",
	]);
	assert.equal(progressable.includes("preparing"), false);
});

test("RECHECK_DEBOUNCE_MS is a positive policy freeze for manual recheck", () => {
  assert.equal(typeof RECHECK_DEBOUNCE_MS, "number");
  assert.ok(RECHECK_DEBOUNCE_MS > 0);
  assert.equal(RECHECK_DEBOUNCE_MS, 5_000);
});

test("downloadableOrderStatuses matches the post-validation download set in order", () => {
	assert.deepEqual(downloadableOrderStatuses, ["validated", "downloading"]);
});

test("downloadableOrderStatuses is a subset of activeOrderStatuses", () => {
	for (const status of downloadableOrderStatuses) {
		assert.equal(activeOrderStatuses.includes(status), true);
	}
});

test("downloadableOrderStatuses is disjoint from recheckable and terminal", () => {
	for (const status of downloadableOrderStatuses) {
		assert.equal(recheckableOrderStatuses.includes(status), false);
		assert.equal(terminalOrderStatuses.includes(status), false);
	}
});
