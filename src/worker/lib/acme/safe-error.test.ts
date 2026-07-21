import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorMessage } from "@/worker/lib/acme/safe-error";

test("safeErrorMessage returns Error message", () => {
  assert.equal(safeErrorMessage(new Error("plain"), "fallback"), "plain");
});

test("safeErrorMessage uses fallback for non-Error values", () => {
  assert.equal(safeErrorMessage(null, "fallback"), "fallback");
  assert.equal(safeErrorMessage("string", "fallback"), "fallback");
  assert.equal(safeErrorMessage({}, "fallback"), "fallback");
});

test("safeErrorMessage redacts http and https URLs", () => {
  assert.equal(
    safeErrorMessage(new Error("fail http://example.com/x and https://a.test/y"), "fallback"),
    "fail [URL] and [URL]",
  );
});

test("safeErrorMessage supports custom URL placeholder", () => {
  assert.equal(
    safeErrorMessage(new Error("fail https://acme.example/order"), "fallback", "[ACME URL]"),
    "fail [ACME URL]",
  );
});

test("safeErrorMessage truncates to 500 characters after redaction", () => {
  const long = `prefix ${"a".repeat(600)}`;
  assert.equal(safeErrorMessage(new Error(long), "fallback").length, 500);

  const withUrl = `https://example.com/${"b".repeat(600)}`;
  const redacted = safeErrorMessage(new Error(withUrl), "fallback");
  assert.equal(redacted, "[URL]".slice(0, 500));
  assert.ok(redacted.length <= 500);
});
