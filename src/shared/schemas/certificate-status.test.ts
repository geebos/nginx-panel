import assert from "node:assert/strict";
import test from "node:test";
import { usableCertificateStatuses } from "@/shared/schemas/certificate";

test("usableCertificateStatuses matches the known runtime-bindable set in order", () => {
	assert.deepEqual(usableCertificateStatuses, ["ready", "active"]);
});
