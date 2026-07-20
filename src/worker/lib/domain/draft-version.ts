import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  configVersions,
  deployments,
  domainAliases,
  domains,
  type ConfigVersion,
  type DomainConfig,
  type ManagerConfig,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";

type AppDb = AppEnv["Variables"]["db"];
type AppTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export function saveDraftVersion(
  tx: AppTransaction,
  input: {
    domainId: string;
    config: DomainConfig | ManagerConfig;
    snapshot: { json: string; checksum: string };
    changeSummary: string;
    createdBy?: string;
    now: number;
    expectedChecksum?: string;
  },
) {
  const domain = tx.select({ draftVersionId: domains.draftVersionId })
    .from(domains)
    .where(eq(domains.id, input.domainId))
    .get();
  const draft = domain?.draftVersionId
    ? tx.select().from(configVersions).where(and(
        eq(configVersions.id, domain.draftVersionId),
        eq(configVersions.domainId, input.domainId),
        eq(configVersions.status, "draft"),
      )).get()
    : undefined;

  let version: ConfigVersion;
  let mode: "created" | "updated";
  if (draft) {
    const runningDeploy = tx.select({ id: deployments.id }).from(deployments).where(and(
      eq(deployments.domainId, input.domainId),
      eq(deployments.configVersionId, draft.id),
      eq(deployments.type, "deploy"),
      inArray(deployments.status, ["queued", "running"]),
    )).get();
    if (runningDeploy) {
      throw new BusinessError("errors:draftDeploymentRunning", 409, "DRAFT_DEPLOYMENT_RUNNING");
    }
    const updated = tx.update(configVersions).set({
      snapshotJson: input.snapshot.json,
      snapshotChecksum: input.snapshot.checksum,
      changeSummary: input.changeSummary,
      createdBy: input.createdBy ?? draft.createdBy,
      updatedAt: input.now,
    }).where(and(
      eq(configVersions.id, draft.id),
      eq(configVersions.status, "draft"),
      eq(configVersions.snapshotChecksum, input.expectedChecksum ?? draft.snapshotChecksum),
    )).run();
    if (updated.changes !== 1) throw new BusinessError("errors:versionConflict", 409, "VERSION_CONFLICT");
    version = { ...draft, snapshotJson: input.snapshot.json, snapshotChecksum: input.snapshot.checksum, changeSummary: input.changeSummary, createdBy: input.createdBy ?? draft.createdBy, updatedAt: input.now };
    mode = "updated";
  } else {
  const latest = tx.select({ versionNumber: configVersions.versionNumber })
    .from(configVersions)
    .where(eq(configVersions.domainId, input.domainId))
    .orderBy(desc(configVersions.versionNumber))
    .limit(1)
    .get();
  const versionId = randomUUID();
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  version = {
    id: versionId,
    domainId: input.domainId,
    versionNumber,
    status: "draft",
    sourceVersionId: null,
    sourceCertificateId: null,
    changeSummary: input.changeSummary,
    createdBy: input.createdBy ?? null,
    snapshotJson: input.snapshot.json,
    snapshotChecksum: input.snapshot.checksum,
    createdAt: input.now,
    updatedAt: input.now,
  } satisfies ConfigVersion;
  tx.insert(configVersions).values(version).run();
  mode = "created";
  }
  tx.delete(domainAliases).where(eq(domainAliases.domainId, input.domainId)).run();
  for (const hostname of input.config.aliases) {
    tx.insert(domainAliases).values({
      id: randomUUID(),
      domainId: input.domainId,
      hostname,
      displayHostname: hostname,
    }).run();
  }
  tx.update(domains).set({
    primaryHostname: input.config.primaryHostname,
    displayHostname: input.config.primaryHostname,
    draftVersionId: version.id,
    updatedAt: input.now,
  }).where(eq(domains.id, input.domainId)).run();
  return { versionId: version.id, versionNumber: version.versionNumber, snapshotChecksum: input.snapshot.checksum, version, mode };
}
