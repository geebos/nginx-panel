import { opendir, readdir, readlink, rm, stat, statfs } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { deployments, runtimeStorageSettingsSchema, settings } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { getRuntimeState } from "@/worker/lib/runtime/state";
import { nginxRuntimeRoot } from "@/worker/lib/runtime/paths";

export const MIB = 1024 * 1024;
export const DEFAULT_REVISION_MAX_BYTES = 2 * 1024 * MIB;
export const SUCCESSFUL_REVISION_RETENTION = 20;
export const FAILED_ARTIFACT_RETENTION_MS = 7 * 86_400_000;

type Db = AppEnv["Variables"]["db"];

type RuntimeStorageOptions = {
  runtimeRoot?: string;
  maxBytes?: number;
  now?: number;
};

type Artifact = {
  id: string;
  collection: "revisions" | "candidates" | "backups";
  path: string;
  bytes: number;
  modifiedAt: number;
};

export type RuntimeStorageSnapshot = {
  usedBytes: number;
  maxBytes: number;
  minimumAllowedBytes: number;
  projectedBytes: number;
  candidateRequiredBytes: number;
  filesystemAvailableBytes: number | null;
  locked: boolean;
  retainedRevisionCount: number;
  protectedRevisionIds: string[];
};

export type RuntimeStorageCleanupResult = RuntimeStorageSnapshot & {
  removed: Array<Pick<Artifact, "id" | "collection" | "bytes">>;
};

function runtimeRoot(options: RuntimeStorageOptions) {
  return options.runtimeRoot ?? nginxRuntimeRoot();
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  let directory;
  try {
    directory = await opendir(root);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  for await (const entry of directory) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

async function listArtifacts(root: string, collection: Artifact["collection"]): Promise<Artifact[]> {
  const collectionRoot = join(root, collection);
  let entries;
  try {
    entries = await readdir(collectionRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const artifacts: Artifact[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(collectionRoot, entry.name);
    const metadata = await stat(path);
    artifacts.push({ id: entry.name, collection, path, bytes: await directorySize(path), modifiedAt: metadata.mtimeMs });
  }
  return artifacts;
}

async function activeRevisionId(root: string) {
  try {
    return basename(await readlink(join(root, "active")));
  } catch {
    return null;
  }
}

async function revisionHistory(db: Db) {
  const runtimeTypes = ["deploy", "rollback", "apply_log_settings", "rebuild_active"];
  const [successfulRows, runningRows] = await Promise.all([
    db.select({ id: deployments.id, configVersionId: deployments.configVersionId }).from(deployments).where(and(
      eq(deployments.status, "succeeded"),
      inArray(deployments.type, runtimeTypes),
    )).orderBy(desc(deployments.finishedAt), desc(deployments.createdAt)),
    db.select({ id: deployments.id, previousVersionId: deployments.previousVersionId }).from(deployments).where(and(
      eq(deployments.status, "running"),
      inArray(deployments.type, runtimeTypes),
    )),
  ]);
  const recoveryVersionIds = new Set(runningRows.map((row) => row.previousVersionId).filter((id): id is string => Boolean(id)));
  return {
    successfulIds: successfulRows.map((row) => row.id),
    runningIds: runningRows.map((row) => row.id),
    recoveryIds: successfulRows.filter((row) => row.configVersionId && recoveryVersionIds.has(row.configVersionId)).map((row) => row.id),
  };
}

export async function getRuntimeStorageSettings(db: Db) {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "runtime_storage") });
  if (!row) return { revisionMaxBytes: DEFAULT_REVISION_MAX_BYTES };
  const parsed = runtimeStorageSettingsSchema.safeParse(JSON.parse(row.valueJson));
  return parsed.success ? parsed.data : { revisionMaxBytes: DEFAULT_REVISION_MAX_BYTES };
}

async function storageContext(db: Db, options: RuntimeStorageOptions) {
  const root = runtimeRoot(options);
  const [revisions, candidates, backups, activeId, history, stored, filesystemAvailableBytes] = await Promise.all([
    listArtifacts(root, "revisions"),
    listArtifacts(root, "candidates"),
    listArtifacts(root, "backups"),
    activeRevisionId(root),
    revisionHistory(db),
    getRuntimeStorageSettings(db),
    statfs(root).then((disk) => disk.bavail * disk.bsize).catch(() => null),
  ]);
  const existingRevisionIds = new Set(revisions.map((item) => item.id));
  const previousSuccessfulId = history.successfulIds.find((id) => id !== activeId && existingRevisionIds.has(id)) ?? null;
  const protectedIds = new Set([
    activeId,
    previousSuccessfulId,
    ...history.runningIds.filter((id) => existingRevisionIds.has(id)),
    ...history.recoveryIds.filter((id) => existingRevisionIds.has(id)),
  ].filter((id): id is string => Boolean(id)));
  return {
    root,
    revisions,
    candidates,
    backups,
    activeId,
    successfulIds: history.successfulIds,
    runningIds: new Set(history.runningIds),
    protectedIds,
    maxBytes: options.maxBytes ?? stored.revisionMaxBytes,
    filesystemAvailableBytes,
  };
}

function snapshotFromContext(context: Awaited<ReturnType<typeof storageContext>>): RuntimeStorageSnapshot {
  const all = [
    ...context.revisions,
    ...context.candidates.filter((item) => !context.runningIds.has(item.id)),
    ...context.backups,
  ];
  const usedBytes = all.reduce((total, item) => total + item.bytes, 0);
  const protectedBytes = context.revisions
    .filter((item) => context.protectedIds.has(item.id))
    .reduce((total, item) => total + item.bytes, 0);
  const activeBytes = context.revisions.find((item) => item.id === context.activeId)?.bytes ?? 0;
  const projectedBytes = usedBytes + activeBytes;
  const candidateRequiredBytes = activeBytes * 2 + 256 * MIB;
  return {
    usedBytes,
    maxBytes: context.maxBytes,
    minimumAllowedBytes: protectedBytes,
    projectedBytes,
    candidateRequiredBytes,
    filesystemAvailableBytes: context.filesystemAvailableBytes,
    locked: projectedBytes > context.maxBytes
      || (context.filesystemAvailableBytes !== null && context.filesystemAvailableBytes < candidateRequiredBytes),
    retainedRevisionCount: context.revisions.length,
    protectedRevisionIds: [...context.protectedIds].sort(),
  };
}

export async function getRuntimeStorageSnapshot(db: Db, options: RuntimeStorageOptions = {}) {
  return snapshotFromContext(await storageContext(db, options));
}

export async function cleanupRuntimeStorage(db: Db, options: RuntimeStorageOptions = {}): Promise<RuntimeStorageCleanupResult> {
  const now = options.now ?? Date.now();
  let context = await storageContext(db, options);
  const removed: RuntimeStorageCleanupResult["removed"] = [];
  const successful = new Set(context.successfulIds);

  const removeArtifact = async (artifact: Artifact) => {
    await rm(artifact.path, { recursive: true, force: true });
    removed.push({ id: artifact.id, collection: artifact.collection, bytes: artifact.bytes });
  };

  const candidateRows = context.candidates.length
    ? await db.select({ id: deployments.id, status: deployments.status }).from(deployments).where(inArray(deployments.id, context.candidates.map((item) => item.id)))
    : [];
  const endedCandidateIds = new Set(candidateRows.filter((row) => !["queued", "running"].includes(row.status)).map((row) => row.id));
  for (const artifact of [...context.candidates, ...context.backups]) {
    if (artifact.collection === "candidates" && context.runningIds.has(artifact.id)) continue;
    if (endedCandidateIds.has(artifact.id) || artifact.modifiedAt < now - FAILED_ARTIFACT_RETENTION_MS) await removeArtifact(artifact);
  }
  for (const artifact of context.revisions) {
    if (context.protectedIds.has(artifact.id)) continue;
    if (!successful.has(artifact.id) && artifact.modifiedAt < now - FAILED_ARTIFACT_RETENTION_MS) await removeArtifact(artifact);
  }

  context = await storageContext(db, options);
  let usedBytes = snapshotFromContext(context).usedBytes;
  const failedArtifacts = [
    ...context.candidates.filter((artifact) => !context.runningIds.has(artifact.id)),
    ...context.backups,
    ...context.revisions.filter((artifact) => !successful.has(artifact.id)),
  ].filter((artifact) => !context.protectedIds.has(artifact.id)).sort((left, right) => left.modifiedAt - right.modifiedAt);
  for (const artifact of failedArtifacts) {
    if (usedBytes <= context.maxBytes) break;
    await removeArtifact(artifact);
    usedBytes -= artifact.bytes;
  }

  context = await storageContext(db, options);
  usedBytes = snapshotFromContext(context).usedBytes;
  const oldestSuccessful = [...context.successfulIds].reverse();
  for (const id of oldestSuccessful) {
    if (usedBytes <= context.maxBytes) break;
    if (context.protectedIds.has(id)) continue;
    const artifact = context.revisions.find((item) => item.id === id);
    if (!artifact) continue;
    await removeArtifact(artifact);
    usedBytes -= artifact.bytes;
  }

  context = await storageContext(db, options);
  const excessSuccessfulIds = context.successfulIds
    .filter((id) => context.revisions.some((item) => item.id === id))
    .slice(SUCCESSFUL_REVISION_RETENTION)
    .reverse();
  for (const id of excessSuccessfulIds) {
    if (context.protectedIds.has(id)) continue;
    const artifact = context.revisions.find((item) => item.id === id);
    if (artifact) await removeArtifact(artifact);
  }

  context = await storageContext(db, options);
  return { ...snapshotFromContext(context), removed };
}

export async function assertRuntimeStorageCapacity(db: Db, options: RuntimeStorageOptions = {}) {
  const storage = getRuntimeState().status === "healthy"
    ? await cleanupRuntimeStorage(db, options)
    : await getRuntimeStorageSnapshot(db, options);
  if (storage.locked) {
    throw new BusinessError("errors:revisionStorageLimitExceeded", 409, "REVISION_STORAGE_LIMIT_EXCEEDED", {
      context: {
        usedBytes: storage.usedBytes,
        projectedBytes: storage.projectedBytes,
        revisionMaxBytes: storage.maxBytes,
      },
    });
  }
  return storage;
}

export function startRuntimeStorageScheduler(db: Db) {
  let stopped = false;
  let schedulerTail = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped || getRuntimeState().status !== "healthy") return;
    schedulerTail = cleanupRuntimeStorage(db).then(() => undefined).catch((error) => console.error("[runtime-storage] retention cleanup failed", error));
  }, 24 * 60 * 60 * 1_000);
  timer.unref();
  const stop = () => { stopped = true; clearInterval(timer); };
  Object.assign(stop, { wait: () => schedulerTail });
  return stop as typeof stop & { wait: () => Promise<void> };
}
