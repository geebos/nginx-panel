import assert from "node:assert/strict";
import test from "node:test";

import { resolveFilterSubmission } from "./log-viewer";

test("submits changed filters to the live stream while live logging is enabled", () => {
  assert.deepEqual(
    resolveFilterSubmission(true, { keyword: " /api ", method: "GET", statusText: "200" }),
    { target: "live", filters: { keyword: "/api", method: "GET", status: 200 } },
  );
});

test("submits filters to history while live logging is disabled", () => {
  assert.deepEqual(
    resolveFilterSubmission(false, { keyword: "error", method: "", statusText: "" }),
    { target: "history", filters: { keyword: "error", method: "" } },
  );
});
