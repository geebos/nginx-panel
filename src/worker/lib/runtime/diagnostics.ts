import { access, opendir, readFile, readdir, stat, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, normalize } from "node:path";
import { eq } from "drizzle-orm";
import { configVersions, domains } from "@/shared/schemas";
import { parseDomainSnapshot } from "@/worker/lib/domain/snapshot";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { checksum, runtimeManifestSchema } from "@/worker/lib/runtime/manifest";
import { getRuntimeState } from "@/worker/lib/runtime/state";
import { createSnapshot } from "@/worker/lib/snapshot";
import { certificateDataRoot, nginxRuntimeRoot } from "@/worker/lib/runtime/paths";

export type StorageDiagnostic = {
  key: "sqlite" | "runtime" | "certificates" | "logs" | "revisions";
  label: string;
  path: string;
  status: "available" | "missing" | "unconfigured" | "unreadable";
  itemBytes: number | null;
  filesystem: { totalBytes: number; freeBytes: number; availableBytes: number } | null;
};

type DiagnosticPaths = {
  sqliteDirectory?: string;
  runtimeRoot: string;
  certificateRoot: string;
  logsRoot?: string;
};

function runtimePaths(): DiagnosticPaths {
  return {
    sqliteDirectory: process.env.DB_SQLITE_DIR,
    runtimeRoot: nginxRuntimeRoot(),
    certificateRoot: certificateDataRoot(),
    logsRoot: process.env.NGINX_LOG_DIR,
  };
}

async function directorySize(root: string, remaining = { entries: 100_000 }): Promise<number | null> {
  let total = 0;
  const directory = await opendir(root);
  for await (const entry of directory) {
    remaining.entries -= 1;
    if (remaining.entries < 0) return null;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const child = await directorySize(path, remaining);
      if (child === null) return null;
      total += child;
    } else if (entry.isFile()) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

async function probeStorage(input: {
  key: StorageDiagnostic["key"];
  label: string;
  actualPath?: string;
  displayPath: string;
  measure?: "file" | "directory";
}): Promise<StorageDiagnostic> {
  if (!input.actualPath) {
    return { key: input.key, label: input.label, path: input.displayPath, status: "unconfigured", itemBytes: null, filesystem: null };
  }
  try {
    await access(input.actualPath, constants.R_OK);
    const disk = await statfs(input.actualPath);
    const itemBytes = input.measure === "file"
      ? (await stat(input.actualPath)).size
      : input.measure === "directory"
        ? await directorySize(input.actualPath)
        : null;
    return {
      key: input.key,
      label: input.label,
      path: input.displayPath,
      status: "available",
      itemBytes,
      filesystem: {
        totalBytes: disk.blocks * disk.bsize,
        freeBytes: disk.bfree * disk.bsize,
        availableBytes: disk.bavail * disk.bsize,
      },
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return {
      key: input.key,
      label: input.label,
      path: input.displayPath,
      status: code === "ENOENT" ? "missing" : "unreadable",
      itemBytes: null,
      filesystem: null,
    };
  }
}

async function isReadable(path: string) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function collectRuntimeDiagnostics(paths: DiagnosticPaths = runtimePaths()) {
  const sqliteFile = paths.sqliteDirectory ? join(paths.sqliteDirectory, "app.db") : undefined;
  const revisionsRoot = join(paths.runtimeRoot, "revisions");
  const storage = await Promise.all([
    probeStorage({ key: "sqlite", label: "SQLite", actualPath: sqliteFile, displayPath: "<sqlite>/app.db", measure: "file" }),
    probeStorage({ key: "runtime", label: "Runtime config", actualPath: paths.runtimeRoot, displayPath: "<runtime>" }),
    probeStorage({ key: "certificates", label: "Certificates", actualPath: paths.certificateRoot, displayPath: "<certificates>", measure: "directory" }),
    probeStorage({ key: "logs", label: "Logs", actualPath: paths.logsRoot, displayPath: paths.logsRoot ?? "<logs>" }),
    probeStorage({ key: "revisions", label: "Revisions", actualPath: revisionsRoot, displayPath: "<runtime>/revisions", measure: "directory" }),
  ]);

  const historicalRoots = new Set<string>();
  try {
    for (const entry of await readdir(revisionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(revisionsRoot, entry.name, "manifest.json"), "utf8");
        const parsed = runtimeManifestSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.rootInputs.logsRoot !== paths.logsRoot) historicalRoots.add(parsed.data.rootInputs.logsRoot);
      } catch {
        // Invalid retained revisions are reported by runtime verification when active.
      }
    }
  } catch {
    // A missing revisions directory is already represented in storage diagnostics.
  }

  return {
    storage,
    logRoots: {
      current: paths.logsRoot ? { path: paths.logsRoot, readable: await isReadable(paths.logsRoot) } : null,
      historical: await Promise.all([...historicalRoots].sort().map(async (path) => ({ path, readable: await isReadable(path) }))),
    },
    worker: { status: "running" as const, uptimeSeconds: Math.floor(process.uptime()), pid: process.pid },
  };
}

function redactRuntimeConfig(value: string, paths: DiagnosticPaths) {
  const replacements = [
    [paths.runtimeRoot, "<runtime>"],
    [paths.logsRoot, "<logs>"],
    [paths.certificateRoot, "<certificates>"],
    [paths.sqliteDirectory, "<sqlite>"],
    [process.env.MANAGER_TLS_CERT_FILE, "<manager-certificate>"],
    [process.env.MANAGER_TLS_KEY_FILE, "<manager-private-key>"],
  ].filter((item): item is [string, string] => Boolean(item[0])).sort((left, right) => right[0].length - left[0].length);
  let redacted = value;
  for (const [path, placeholder] of replacements) redacted = redacted.split(normalize(path)).join(placeholder);
  return redacted.replace(
    /(\b(?:root|alias|ssl_certificate|ssl_certificate_key|access_log|error_log)\s+)("?)(\/(?!\/)[^;\s"]+)("?)/g,
    "$1$2<absolute-path>$4",
  );
}

export async function getActiveRuntimeConfig(db: AppEnv["Variables"]["db"], domainId: string, paths: DiagnosticPaths = runtimePaths()) {
  const domain = await db.query.domains.findFirst({ where: eq(domains.id, domainId) });
  if (!domain || domain.deletedAt !== null) throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
  if (!domain.activeVersionId) throw new BusinessError("errors:domainNoActiveVersion", 409, "DOMAIN_NO_ACTIVE_VERSION");

  const runtime = getRuntimeState();
  if (!runtime.activeRevision) throw new BusinessError("errors:activeRevisionUnavailable", 409, "ACTIVE_REVISION_UNAVAILABLE");
  const revisionRoot = join(paths.runtimeRoot, "revisions", basename(runtime.activeRevision));
  const manifestPath = join(revisionRoot, "manifest.json");
  const configPath = join(revisionRoot, "domains", `${domain.id}.conf`);
  try {
    const [manifestRaw, config, version] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(configPath, "utf8"),
      db.query.configVersions.findFirst({ where: eq(configVersions.id, domain.activeVersionId) }),
    ]);
    const manifest = runtimeManifestSchema.parse(JSON.parse(manifestRaw));
    const entry = manifest.domains[domain.id];
    if (!entry || !version || version.domainId !== domain.id) throw new Error("active_source_missing");
    const snapshot = parseDomainSnapshot(version.snapshotJson);
    if (
      entry.sourceVersionId !== version.id
      || entry.snapshotChecksum !== version.snapshotChecksum
      || createSnapshot(snapshot).checksum !== version.snapshotChecksum
    ) throw new Error("source_checksum_mismatch");
    const actualChecksum = checksum(config);
    if (actualChecksum !== entry.configChecksum) throw new Error("config_checksum_mismatch");
    return {
      domain: { id: domain.id, hostname: domain.primaryHostname },
      revision: runtime.activeRevision,
      file: `<runtime>/revisions/${runtime.activeRevision}/domains/${domain.id}.conf`,
      config: redactRuntimeConfig(config, paths),
      checksums: { source: entry.snapshotChecksum, config: entry.configChecksum, actualConfig: actualChecksum },
      inputs: {
        sourceVersionId: entry.sourceVersionId,
        enabled: entry.enabled,
        certificateId: entry.certificateId,
        hostname: snapshot.primaryHostname,
        aliases: snapshot.aliases,
        routes: snapshot.routes.length,
        headers: snapshot.headers.length,
        advanced: Boolean(snapshot.advanced.serverSnippet.trim()),
        logSettingsRevision: manifest.logSettings.revision,
        logSettingsChecksum: manifest.logSettings.checksum,
      },
    };
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError("errors:activeRuntimeConfigInvalid", 409, "ACTIVE_RUNTIME_CONFIG_INVALID", { cause: error instanceof Error ? error : undefined });
  }
}
