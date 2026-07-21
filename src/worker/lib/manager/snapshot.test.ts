import assert from "node:assert/strict";
import test from "node:test";
import { buildUnboundManagerConfig } from "@/shared/schemas";
import { parseManagerSnapshot } from "@/worker/lib/manager/snapshot";

test("parseManagerSnapshot returns a ManagerConfig for valid snapshot JSON", () => {
	const base = buildUnboundManagerConfig();
	const parsed = parseManagerSnapshot(JSON.stringify(base));
	assert.equal(parsed.schemaVersion, base.schemaVersion);
	assert.equal(parsed.bound, base.bound);
});

test("parseManagerSnapshot throws on invalid JSON", () => {
	assert.throws(() => parseManagerSnapshot("{not-json"), SyntaxError);
});

test("parseManagerSnapshot throws on schema-invalid JSON", () => {
	assert.throws(() =>
		parseManagerSnapshot(JSON.stringify({ schemaVersion: 1 })),
	);
});
