import { createHash } from "node:crypto";
import { z } from "zod";

export const runtimeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  rootConfigChecksum: z.string().length(64),
  logSettings: z.object({ revision: z.number().int().nonnegative(), checksum: z.string().length(64) }),
  rootInputs: z.object({ logsRoot: z.string(), runtimeRoot: z.string() }),
  domains: z.record(
    z.string(),
    z.object({
      sourceVersionId: z.string(),
      snapshotChecksum: z.string().length(64),
      enabled: z.boolean(),
      certificateId: z.string().nullable(),
      configChecksum: z.string().length(64),
    }),
  ),
});

export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export function checksum(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function createRuntimeManifest(input: Omit<RuntimeManifest, "schemaVersion" | "rootConfigChecksum"> & { rootConfig: string }) {
  const { rootConfig, ...manifest } = input;
  return runtimeManifestSchema.parse({
    schemaVersion: 1,
    rootConfigChecksum: checksum(rootConfig),
    ...manifest,
  });
}
