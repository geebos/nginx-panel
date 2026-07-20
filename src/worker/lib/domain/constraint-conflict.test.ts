import assert from "node:assert/strict";
import test from "node:test";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { rethrowWriteConflict } from "@/worker/lib/domain/constraint-conflict";

test("unknown unique constraints return a structured resource conflict", async () => {
  const error = Object.assign(
    new Error("UNIQUE constraint failed: config_versions.source_certificate_id"),
    { code: "SQLITE_CONSTRAINT_UNIQUE" },
  );
  await assert.rejects(
    rethrowWriteConflict({} as AppEnv["Variables"]["db"], error, []),
    (thrown) => thrown instanceof BusinessError
      && thrown.status === 409
      && thrown.code === "RESOURCE_CONFLICT",
  );
});
