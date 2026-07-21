import { execFile } from "node:child_process";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { configVersions, domains } from "@/shared/schemas";
import { parseDomainSnapshot } from "@/worker/lib/domain/snapshot";
import type { AppEnv } from "@/worker/types";
import { createSnapshot } from "@/worker/lib/snapshot";
import { getActiveLogSettings, logSettingsChecksum } from "@/worker/lib/log-settings";
import { checksum, runtimeManifestSchema } from "@/worker/lib/runtime/manifest";
import type { RuntimeIssue, RuntimeState } from "@/worker/lib/runtime/state";

const execFileAsync = promisify(execFile);

type VerifyOptions = {
  runtimeRoot?: string;
  logsRoot?: string;
  nginxBin?: string;
  runNginxTest?: (activeRoot: string) => Promise<void>;
};

function degraded(activeRevision: string | null, code: string, message: string): RuntimeState {
  return { status: "degraded", checkedAt: Date.now(), activeRevision, issues: [{ code, message }] };
}

async function assertRegularFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("not_regular_file");
}

async function assertRegularDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory()) throw new Error("not_regular_directory");
}

function safeActiveRevision(target: string, runtimeRoot: string) {
  if (isAbsolute(target) || target.split(/[\\/]/).includes("..")) throw new Error("unsafe_active_target");
  const resolved = normalize(join(runtimeRoot, target));
  const revisions = normalize(join(runtimeRoot, "revisions"));
  if (resolved !== revisions && !resolved.startsWith(`${revisions}${sep}`)) throw new Error("unsafe_active_target");
  return basename(resolved);
}

export async function verifyRuntime(
  db: AppEnv["Variables"]["db"],
  options: VerifyOptions = {},
): Promise<RuntimeState> {
  if (process.env.RUNTIME_MODE !== "nginx-manager") {
    return { status: "healthy", checkedAt: Date.now(), activeRevision: null, issues: [] };
  }

  const runtimeRoot = normalize(options.runtimeRoot ?? process.env.NGINX_RUNTIME_ROOT ?? "/data/nginx");
  const logsRoot = normalize(options.logsRoot ?? process.env.NGINX_LOG_DIR ?? "");
  const activeRoot = join(runtimeRoot, "active");
  let activeRevision: string | null = null;
  try {
    const activeInfo = await lstat(activeRoot);
    if (!activeInfo.isSymbolicLink()) return degraded(null, "ACTIVE_LINK_INVALID", "Active revision link is invalid");
    const activeTarget = await readlink(activeRoot);
    activeRevision = safeActiveRevision(activeTarget, runtimeRoot);
    await assertRegularDirectory(join(runtimeRoot, activeTarget));

    // Manager is root-only; conf expectation is type=domain only.
    const domainRows = await db.select().from(domains).where(and(isNull(domains.deletedAt), eq(domains.type, "domain")));
    const activeDomains = domainRows.filter((domain) => domain.activeVersionId !== null);
    const logSettings = await getActiveLogSettings(db);
    const manifestPath = join(activeRoot, "manifest.json");
    let manifestRaw: string;
    try {
      await assertRegularFile(manifestPath);
      manifestRaw = await readFile(manifestPath, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT" && activeDomains.length === 0 && logSettings.revision === 0) {
        await assertRegularDirectory(join(activeRoot, "domains"));
        if ((await readdir(join(activeRoot, "domains"))).length) {
          return degraded(activeRevision, "DOMAIN_FILE_SET_MISMATCH", "Bootstrap Domain config directory is not empty");
        }
        await (options.runNginxTest
          ? options.runNginxTest(activeRoot)
          : execFileAsync(options.nginxBin ?? process.env.NGINX_BIN ?? "/usr/sbin/nginx", ["-p", `${activeRoot}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000 }).then(() => undefined));
        return { status: "healthy", checkedAt: Date.now(), activeRevision, issues: [] };
      }
      return degraded(activeRevision, "MANIFEST_MISSING", "Active manifest missing");
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestRaw);
    } catch {
      return degraded(activeRevision, "MANIFEST_INVALID", "Active manifest format invalid");
    }
    const parsed = runtimeManifestSchema.safeParse(manifestValue);
    if (!parsed.success) return degraded(activeRevision, "MANIFEST_INVALID", "Active manifest format invalid");
    const manifest = parsed.data;
    if (normalize(manifest.rootInputs.runtimeRoot) !== runtimeRoot || normalize(manifest.rootInputs.logsRoot) !== logsRoot) {
      return degraded(activeRevision, "RUNTIME_INPUT_MISMATCH", "Runtime directory inputs do not match Active revision");
    }
    if (manifest.logSettings.revision !== logSettings.revision || manifest.logSettings.checksum !== logSettingsChecksum(logSettings)) {
      return degraded(activeRevision, "LOG_SETTINGS_MISMATCH", "Log settings do not match Active revision");
    }

    const versionIds = activeDomains.map((domain) => domain.activeVersionId!);
    const versionRows = versionIds.length
      ? await db.select().from(configVersions).where(inArray(configVersions.id, versionIds))
      : [];
    const versionsById = new Map(versionRows.map((version) => [version.id, version]));
    const expectedIds = activeDomains.map((domain) => domain.id).sort();
    const manifestIds = Object.keys(manifest.domains).sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(manifestIds)) {
      return degraded(activeRevision, "DOMAIN_SET_MISMATCH", "Active Domain set does not match manifest");
    }

    for (const domain of activeDomains) {
      const version = versionsById.get(domain.activeVersionId!);
      const entry = manifest.domains[domain.id];
      if (!version) return degraded(activeRevision, "SOURCE_VERSION_MISSING", "Active Version missing");
      let snapshot;
      try {
        const config = parseDomainSnapshot(version.snapshotJson);
        snapshot = { ...createSnapshot(config), certificateId: config.ssl.certificateId ?? null };
      } catch {
        return degraded(activeRevision, "SOURCE_SNAPSHOT_INVALID", "Active Version snapshot verification failed");
      }
      if (snapshot.checksum !== version.snapshotChecksum) {
        return degraded(activeRevision, "SOURCE_SNAPSHOT_INVALID", "Active Version snapshot verification failed");
      }
      if (
        entry.sourceVersionId !== version.id
        || entry.snapshotChecksum !== version.snapshotChecksum
        || entry.enabled !== domain.enabled
        || entry.certificateId !== snapshot.certificateId
      ) {
        return degraded(activeRevision, "SOURCE_PROJECTION_MISMATCH", "Database runtime projection does not match manifest");
      }
    }

    await assertRegularFile(join(activeRoot, "nginx.conf"));
    if (checksum(await readFile(join(activeRoot, "nginx.conf"))) !== manifest.rootConfigChecksum) {
      return degraded(activeRevision, "ROOT_CHECKSUM_MISMATCH", "Root config checksum mismatch");
    }
    await assertRegularDirectory(join(activeRoot, "domains"));
    const entries = await readdir(join(activeRoot, "domains"), { withFileTypes: true });
    const actualFiles = entries.map((entry) => entry.name).sort();
    const expectedFiles = expectedIds.map((id) => `${id}.conf`).sort();
    if (entries.some((entry) => !entry.isFile()) || JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      return degraded(activeRevision, "DOMAIN_FILE_SET_MISMATCH", "Domain config file set mismatch");
    }
    for (const domainId of expectedIds) {
      const file = join(activeRoot, "domains", `${domainId}.conf`);
      await assertRegularFile(file);
      if (checksum(await readFile(file)) !== manifest.domains[domainId].configChecksum) {
        return degraded(activeRevision, "DOMAIN_CHECKSUM_MISMATCH", "Domain config checksum mismatch");
      }
    }

    await (options.runNginxTest
      ? options.runNginxTest(activeRoot)
      : execFileAsync(options.nginxBin ?? process.env.NGINX_BIN ?? "/usr/sbin/nginx", ["-p", `${activeRoot}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000 }).then(() => undefined));
    return { status: "healthy", checkedAt: Date.now(), activeRevision, issues: [] };
  } catch {
    const issue: RuntimeIssue = { code: "RUNTIME_VERIFICATION_FAILED", message: "Active revision verification failed" };
    return { status: "degraded", checkedAt: Date.now(), activeRevision, issues: [issue] };
  }
}
