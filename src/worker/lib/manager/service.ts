import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  BOOTSTRAP_HOSTS,
  MANAGER_PLACEHOLDER_HOSTNAME,
  buildBoundManagerConfig,
  buildUnboundManagerConfig,
  configVersions,
  domainAliases,
  domains,
  managerConfigSchema,
  type ManagerConfig,
  type UpdateManagerSettingsInput,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { createSnapshot } from "@/worker/lib/snapshot";
import { assertHostnamesAvailable, assertHostnamesMutable } from "@/worker/lib/domain/validation";
import { saveDraftVersion } from "@/worker/lib/domain/draft-version";

type AppDb = AppEnv["Variables"]["db"];
type AppTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function findManagerDomain(db: AppDb) {
  return db.query.domains.findFirst({
    where: and(eq(domains.type, "manager"), isNull(domains.deletedAt)),
  });
}

export function parseManagerSnapshot(json: string): ManagerConfig {
  return managerConfigSchema.parse(JSON.parse(json));
}

function sameHostnameSet(left: string[], right: string[]) {
  const normalize = (values: string[]) =>
    [...new Set(values.map((value) => value.toLowerCase().replace(/\.$/, "")))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function loadManagerBaseConfig(
  db: AppDb,
  manager: { draftVersionId: string | null; activeVersionId: string | null },
): Promise<ManagerConfig | undefined> {
  const versionId = manager.draftVersionId ?? manager.activeVersionId;
  if (!versionId) return undefined;
  const version = await db.query.configVersions.findFirst({ where: eq(configVersions.id, versionId) });
  if (!version) return undefined;
  try {
    return parseManagerSnapshot(version.snapshotJson);
  } catch {
    return undefined;
  }
}

function loadManagerBaseConfigInTx(
  tx: AppTransaction,
  manager: { draftVersionId: string | null; activeVersionId: string | null },
): {
  config: ManagerConfig;
  versionId: string;
  snapshotJson: string;
  snapshotChecksum: string;
  versionNumber: number;
} | undefined {
  const versionId = manager.draftVersionId ?? manager.activeVersionId;
  if (!versionId) return undefined;
  const version = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get();
  if (!version) return undefined;
  try {
    return {
      config: parseManagerSnapshot(version.snapshotJson),
      versionId: version.id,
      snapshotJson: version.snapshotJson,
      snapshotChecksum: version.snapshotChecksum,
      versionNumber: version.versionNumber,
    };
  } catch {
    return undefined;
  }
}

export async function getManagerStatus(db: AppDb) {
  const manager = await findManagerDomain(db);
  if (!manager) {
    return {
      status: "unconfigured" as const,
      domainId: null as string | null,
      config: null as ManagerConfig | null,
      draftVersion: null as null,
      activeVersion: null as null,
      versions: [] as Array<{
        id: string;
        versionNumber: number;
        status: string;
        changeSummary: string | null;
        createdAt: number;
        bound: boolean;
        primaryHostname: string;
      }>,
      localEntrypoints: [...BOOTSTRAP_HOSTS],
      canPublish: false,
      canReset: false,
    };
  }

  const [draftVersion, activeVersion, versionRows] = await Promise.all([
    manager.draftVersionId
      ? db.query.configVersions.findFirst({ where: eq(configVersions.id, manager.draftVersionId) })
      : undefined,
    manager.activeVersionId
      ? db.query.configVersions.findFirst({ where: eq(configVersions.id, manager.activeVersionId) })
      : undefined,
    db.select().from(configVersions)
      .where(eq(configVersions.domainId, manager.id))
      .orderBy(desc(configVersions.versionNumber))
      .limit(20),
  ]);

  const preferred = draftVersion ?? activeVersion;
  const config = preferred ? parseManagerSnapshot(preferred.snapshotJson) : null;
  const status = !manager.activeVersionId && manager.draftVersionId
    ? ("draft" as const)
    : config?.bound
      ? ("bound" as const)
      : manager.activeVersionId
        ? ("unbound" as const)
        : ("draft" as const);

  return {
    status,
    domainId: manager.id,
    config,
    draftVersion: draftVersion ?? null,
    activeVersion: activeVersion ?? null,
    versions: versionRows.map((row) => {
      let bound = false;
      let primaryHostname = row.snapshotJson;
      try {
        const snap = parseManagerSnapshot(row.snapshotJson);
        bound = snap.bound;
        primaryHostname = snap.primaryHostname;
      } catch {
        primaryHostname = "?";
      }
      return {
        id: row.id,
        versionNumber: row.versionNumber,
        status: row.status,
        changeSummary: row.changeSummary,
        createdAt: row.createdAt,
        bound,
        primaryHostname,
      };
    }),
    localEntrypoints: [...BOOTSTRAP_HOSTS],
    canPublish: Boolean(manager.draftVersionId),
    canReset: Boolean(manager.activeVersionId && config?.bound),
  };
}

export async function upsertManagerDraft(
  db: AppDb,
  input: UpdateManagerSettingsInput,
  userId: string,
) {
  const hostnames = [input.primaryHostname, ...(input.aliases ?? [])];
  if (hostnames.some((h) => (BOOTSTRAP_HOSTS as readonly string[]).includes(h) || h === MANAGER_PLACEHOLDER_HOSTNAME)) {
    throw new BusinessError("errors:validation.bootstrapHostnameReserved", 400, "HOSTNAME_RESERVED");
  }

  const existing = await findManagerDomain(db);
  await assertHostnamesAvailable(db, hostnames, existing?.id);
  if (existing) {
    // Block rebind while a non-terminal ACME order is in flight (H3).
    await assertHostnamesMutable(db, existing.id, hostnames);
  }

  // Merge SSL from current draft/active so Save never wipes certificateId / enabled (C1).
  // Clear certificateId on hostname rebind unless the client explicitly sets it (R3).
  const baseConfig = existing ? await loadManagerBaseConfig(db, existing) : undefined;
  const baseHostnames = baseConfig
    ? [baseConfig.primaryHostname, ...baseConfig.aliases]
    : [];
  const hostnamesChanged = Boolean(baseConfig) && !sameHostnameSet(hostnames, baseHostnames);
  // UI ssl subset has no certificateId; rebind must drop the previous ACME cert id (R3).
  const sslPatch: Partial<ManagerConfig["ssl"]> | undefined = hostnamesChanged
    ? { ...(input.ssl ?? {}), certificateId: undefined }
    : input.ssl;
  const config = buildBoundManagerConfig({
    primaryHostname: input.primaryHostname,
    aliases: input.aliases ?? [],
    baseSsl: baseConfig?.ssl,
    ssl: sslPatch,
  });
  const snapshot = createSnapshot(config);
  const now = Date.now();

  if (!existing) {
    const domainId = randomUUID();
    const result = db.transaction((tx) => {
      tx.insert(domains).values({
        id: domainId,
        type: "manager",
        primaryHostname: config.primaryHostname,
        displayHostname: config.primaryHostname,
        enabled: true,
        runtimeStatus: "unknown",
        activeVersionId: null,
        draftVersionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }).run();
      return saveDraftVersion(tx, {
        domainId,
        config,
        snapshot,
        changeSummary: "Create manager bind",
        createdBy: userId,
        now,
      });
    });
    return { domainId, ...result, config };
  }

  const result = db.transaction((tx) => {
    return saveDraftVersion(tx, {
      domainId: existing.id,
      config,
      snapshot,
      changeSummary: "Rebind manager hostname",
      createdBy: userId,
      now,
    });
  });
  return { domainId: existing.id, ...result, config };
}

export async function createManagerResetDraft(db: AppDb, userId: string) {
  const existing = await findManagerDomain(db);
  if (!existing) throw new BusinessError("errors:managerNotConfigured", 404, "MANAGER_NOT_CONFIGURED");
  if (!existing.activeVersionId) {
    throw new BusinessError("errors:managerNotBound", 409, "MANAGER_NOT_BOUND");
  }
  const config = buildUnboundManagerConfig();
  const snapshot = createSnapshot(config);
  const now = Date.now();
  const result = db.transaction((tx) => {
    return saveDraftVersion(tx, {
      domainId: existing.id,
      config,
      snapshot,
      changeSummary: "Reset manager to local only",
      createdBy: userId,
      now,
    });
  });
  return { domainId: existing.id, ...result, config };
}

/**
 * Create or update manager draft during Setup.
 * Reuses an existing seed manager row when present (H2).
 * Preserves seed/active SSL via baseSsl so setup does not wipe file/ACME TLS (R1).
 * Prefer calling inside the same transaction as admin creation via `createManagerDraftFromSetupInTx`.
 */
export function createManagerDraftFromSetupInTx(
  tx: AppTransaction,
  input: { primaryHostname: string; aliases?: string[]; userId: string | null; now?: number },
) {
  const now = input.now ?? Date.now();
  const nextHostnames = [input.primaryHostname, ...(input.aliases ?? [])];

  const existing = tx.select().from(domains)
    .where(and(eq(domains.type, "manager"), isNull(domains.deletedAt)))
    .get();

  if (existing) {
    const base = loadManagerBaseConfigInTx(tx, existing);
    if (base?.config.bound) {
      const baseHostnames = [base.config.primaryHostname, ...base.config.aliases];
      if (sameHostnameSet(nextHostnames, baseHostnames)) {
        // Same hostname set: keep seed SSL. Skip draft+publish when already active with no draft.
        if (existing.activeVersionId === base.versionId && !existing.draftVersionId) {
          return {
            domainId: existing.id,
            config: base.config,
            snapshot: { json: base.snapshotJson, checksum: base.snapshotChecksum },
            versionId: null as string | null,
            versionNumber: base.versionNumber,
            snapshotChecksum: null as string | null,
            version: null,
            mode: "noop" as const,
          };
        }
        // Matching draft already present — reuse for post-setup publish without rewriting SSL.
        if (existing.draftVersionId === base.versionId) {
          return {
            domainId: existing.id,
            config: base.config,
            snapshot: { json: base.snapshotJson, checksum: base.snapshotChecksum },
            versionId: base.versionId,
            versionNumber: base.versionNumber,
            snapshotChecksum: base.snapshotChecksum,
            version: null,
            mode: "reused" as const,
          };
        }
      }
    }

    const hostnamesChanged = Boolean(base?.config)
      && !sameHostnameSet(nextHostnames, [base!.config.primaryHostname, ...base!.config.aliases]);
    const config = buildBoundManagerConfig({
      primaryHostname: input.primaryHostname,
      aliases: input.aliases ?? [],
      baseSsl: base?.config.ssl,
      ssl: hostnamesChanged ? { certificateId: undefined } : undefined,
    });
    const snapshot = createSnapshot(config);
    const saved = saveDraftVersion(tx, {
      domainId: existing.id,
      config,
      snapshot,
      changeSummary: "Setup manager bind",
      createdBy: input.userId ?? undefined,
      now,
    });
    return { domainId: existing.id, config, snapshot, ...saved };
  }

  const config = buildBoundManagerConfig({
    primaryHostname: input.primaryHostname,
    aliases: input.aliases ?? [],
  });
  const snapshot = createSnapshot(config);
  const domainId = randomUUID();
  tx.insert(domains).values({
    id: domainId,
    type: "manager",
    primaryHostname: config.primaryHostname,
    displayHostname: config.primaryHostname,
    enabled: true,
    runtimeStatus: "unknown",
    activeVersionId: null,
    draftVersionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).run();
  const saved = saveDraftVersion(tx, {
    domainId,
    config,
    snapshot,
    changeSummary: "Setup manager bind",
    createdBy: input.userId ?? undefined,
    now,
  });
  return { domainId, config, snapshot, ...saved };
}

export async function createManagerDraftFromSetup(
  db: AppDb,
  input: { primaryHostname: string; aliases?: string[] },
  userId: string | null,
) {
  const hostnames = [input.primaryHostname, ...(input.aliases ?? [])];
  const existing = await findManagerDomain(db);
  await assertHostnamesAvailable(db, hostnames, existing?.id);
  return db.transaction((tx) => createManagerDraftFromSetupInTx(tx, {
    primaryHostname: input.primaryHostname,
    aliases: input.aliases,
    userId,
  }));
}

/** Soft-delete tombstone for business domains (v1 strategy). */
export function tombstoneDomainHostname(domainId: string) {
  return `deleted-${domainId}.invalid`;
}

export async function softDeleteDomainWithTombstone(db: AppDb, domainId: string) {
  const now = Date.now();
  const tombstone = tombstoneDomainHostname(domainId);
  db.transaction((tx) => {
    tx.delete(domainAliases).where(eq(domainAliases.domainId, domainId)).run();
    tx.update(domains).set({
      primaryHostname: tombstone,
      displayHostname: tombstone,
      deletedAt: now,
      updatedAt: now,
    }).where(eq(domains.id, domainId)).run();
  });
}
