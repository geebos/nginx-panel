import assert from "node:assert/strict";
import test from "node:test";
import { safeRedirectPath } from "./safe-redirect";

test("safe redirect accepts local paths and rejects normalized external paths", () => {
  assert.equal(safeRedirectPath("/domains/example.com"), "/domains/example.com");
  for (const unsafe of [
    "//evil.com",
    "/\\\\evil.com",
    "/%5C%5Cevil.com",
    "/%255C%255Cevil.com",
    "/%25255C%25255Cevil.com",
    "/%2F%2Fevil.com",
    "/%252F%252Fevil.com",
    "/%25252F%25252Fevil.com",
  ]) {
    assert.equal(safeRedirectPath(unsafe), "/dashboard");
  }
});
