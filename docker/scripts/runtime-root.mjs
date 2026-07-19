import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, normalize, sep } from "node:path";

const logFormatStart = "# nginx-manager:log-format:start";
const logFormatEnd = "# nginx-manager:log-format:end";

function managedLogFormat(config) {
  const start = config.indexOf(logFormatStart);
  const contentStart = start + logFormatStart.length;
  const end = config.indexOf(logFormatEnd, contentStart);
  if (start < 0 || end < 0) throw new Error("Nginx root config is missing managed log format markers");
  return { contentStart, end };
}

function preserveManagedLogFormat(template, activeConfig) {
  const templateSection = managedLogFormat(template);
  const activeSection = managedLogFormat(activeConfig);
  return `${template.slice(0, templateSection.contentStart)}${activeConfig.slice(activeSection.contentStart, activeSection.end)}${template.slice(templateSection.end)}`;
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function refreshActiveRoot({ runtimeRoot, rootConfig, validate = () => undefined }) {
  const revisionsRoot = normalize(join(runtimeRoot, "revisions"));
  const activePath = join(runtimeRoot, "active");
  const activeTarget = readlinkSync(activePath);
  if (isAbsolute(activeTarget) || activeTarget.split(/[\\/]/).includes("..")) {
    throw new Error("Runtime active symlink target is unsafe");
  }
  const activeRoot = normalize(join(runtimeRoot, activeTarget));
  if (!activeRoot.startsWith(`${revisionsRoot}${sep}`)) throw new Error("Runtime active symlink target is unsafe");

  const activeConfig = readFileSync(join(activeRoot, "nginx.conf"), "utf8");
  const refreshedConfig = preserveManagedLogFormat(rootConfig, activeConfig);
  if (refreshedConfig === activeConfig) return false;

  const manifestPath = join(activeRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.rootConfigChecksum !== checksum(activeConfig)) {
    throw new Error("Runtime active root config checksum is invalid");
  }

  const candidateRoot = mkdtempSync(join(revisionsRoot, ".root-refresh-"));
  let revisionRoot;
  let nextActive;
  try {
    cpSync(activeRoot, candidateRoot, { recursive: true });
    writeFileSync(join(candidateRoot, "nginx.conf"), refreshedConfig, { mode: 0o640 });
    writeFileSync(join(candidateRoot, "manifest.json"), `${JSON.stringify({
      ...manifest,
      rootConfigChecksum: checksum(refreshedConfig),
    }, null, 2)}\n`, { mode: 0o640 });
    validate(candidateRoot);

    const revisionId = `root-refresh-${Date.now()}-${process.pid}`;
    revisionRoot = join(revisionsRoot, revisionId);
    renameSync(candidateRoot, revisionRoot);
    nextActive = join(runtimeRoot, `.active-${revisionId}`);
    symlinkSync(`revisions/${basename(revisionRoot)}`, nextActive);
    renameSync(nextActive, activePath);
    return true;
  } catch (error) {
    if (nextActive) rmSync(nextActive, { force: true });
    rmSync(revisionRoot ?? candidateRoot, { recursive: true, force: true });
    throw error;
  }
}
