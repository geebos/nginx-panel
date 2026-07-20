import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

const DEFAULT_MASTER_KEY_FILE = "/run/secrets/nginx_manager_master_key";
const GENERATED_SECRETS_DIR = "/data/secrets";

const requiredEnvironment = ["NGINX_LOG_DIR"];

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

function isReadableNonEmpty(file) {
  try {
    accessSync(file, constants.R_OK);
    return statSync(file).size > 0;
  } catch {
    return false;
  }
}

function ensureGeneratedSecretsDir() {
  mkdirSync(GENERATED_SECRETS_DIR, { recursive: true, mode: 0o700 });
}

function resolveMasterKeyFile() {
  const masterKeyFile =
    process.env.NGINX_MANAGER_MASTER_KEY_FILE || DEFAULT_MASTER_KEY_FILE;

  if (isReadableNonEmpty(masterKeyFile)) {
    if (statSync(masterKeyFile).size !== 32) {
      throw new Error("nginx_manager_master_key must contain exactly 32 bytes");
    }
    return masterKeyFile;
  }

  if (masterKeyFile !== DEFAULT_MASTER_KEY_FILE) {
    throw new Error(`Required secret is missing: ${masterKeyFile}`);
  }

  ensureGeneratedSecretsDir();
  const generatedFile = join(GENERATED_SECRETS_DIR, "nginx_manager_master_key");
  if (isReadableNonEmpty(generatedFile)) {
    if (statSync(generatedFile).size !== 32) {
      throw new Error("generated nginx_manager_master_key must contain exactly 32 bytes");
    }
    process.env.NGINX_MANAGER_MASTER_KEY_FILE = generatedFile;
    return generatedFile;
  }

  console.warn(
    "[supervisor] Master key not provided; generating a persistent 32-byte key under /data/secrets",
  );
  writeFileSync(generatedFile, randomBytes(32), { mode: 0o400 });
  process.env.NGINX_MANAGER_MASTER_KEY_FILE = generatedFile;
  return generatedFile;
}

// Optional legacy TLS env for emergency override / migration — not required for greenfield.
// Image ENV may default TLS paths to secret mounts that are empty; clear them so bootstrap HTTP can start.
{
  const certFile = process.env.MANAGER_TLS_CERT_FILE;
  const keyFile = process.env.MANAGER_TLS_KEY_FILE;
  if (certFile || keyFile) {
    const certReady = certFile ? isReadableNonEmpty(certFile) : false;
    const keyReady = keyFile ? isReadableNonEmpty(keyFile) : false;
    if (certReady && keyReady) {
      // keep as emergency / migration override
    } else if (!certReady && !keyReady) {
      delete process.env.MANAGER_TLS_CERT_FILE;
      delete process.env.MANAGER_TLS_KEY_FILE;
      console.warn("[supervisor] Manager TLS files not present; continuing with bootstrap HTTP only");
    } else {
      throw new Error(
        `Manager TLS secrets are incomplete: cert=${certReady ? "present" : "missing"}, key=${keyReady ? "present" : "missing"}`,
      );
    }
  }
}

resolveMasterKeyFile();

const logDirectory = process.env.NGINX_LOG_DIR;
if (!isAbsolute(logDirectory) || logDirectory === "/") {
  throw new Error("NGINX_LOG_DIR must be an absolute path other than /");
}
accessSync(logDirectory, constants.R_OK | constants.W_OK);

for (const directory of ["client", "fastcgi", "proxy", "scgi", "uwsgi"]) {
  mkdirSync(`/run/nginx/${directory}_temp`, { recursive: true });
}

const runtimeRoot = "/data/nginx";
const revisionsRoot = join(runtimeRoot, "revisions");
const bootstrapRoot = join(revisionsRoot, "bootstrap");
const activePath = join(runtimeRoot, "active");

function hasActiveSymlink() {
  try {
    const activeStat = lstatSync(activePath);
    if (!activeStat.isSymbolicLink()) throw new Error("Runtime active path must be a symlink");
    const target = readlinkSync(activePath);
    if (target.includes("..") || isAbsolute(target)) throw new Error("Runtime active symlink target is unsafe");
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const activeExists = hasActiveSymlink();

if (!activeExists) {
  // Contract A: only write bootstrap root when there is no active revision.
  // Do NOT call refreshActiveRoot when active already exists — that would wipe published manager segments.
  const nginxTemplate = readFileSync(
    "/etc/nginx/templates/nginx-manager.conf.template",
    "utf8",
  );
  mkdirSync(join(bootstrapRoot, "domains"), { recursive: true });
  writeFileSync(join(bootstrapRoot, "nginx.conf"), nginxTemplate, { mode: 0o640 });
  const nextActive = join(runtimeRoot, ".active-bootstrap");
  symlinkSync("revisions/bootstrap", nextActive);
  renameSync(nextActive, activePath);
  console.log("[supervisor] wrote bootstrap root (no prior active revision)");
} else {
  console.log("[supervisor] active revision present; skipping root rewrite");
}

const configTest = spawnSync(
  "/usr/sbin/nginx",
  ["-p", `${activePath}/`, "-t", "-c", "nginx.conf"],
  { stdio: "inherit" },
);
if (configTest.status !== 0) throw new Error("nginx configuration test failed");

const worker = spawn("node", ["/opt/nginx-manager/worker/serve.mjs"], {
  cwd: "/opt/nginx-manager",
  env: process.env,
  stdio: "inherit",
});
const nginx = spawn(
  "/usr/sbin/nginx",
  ["-p", `${activePath}/`, "-c", "nginx.conf", "-g", "daemon off;"],
  { stdio: "inherit" },
);

let shuttingDown = false;
let workerExited = false;
let nginxExited = false;
let nginxQuitSent = false;

function stopNginx() {
  if (nginxExited || nginxQuitSent) return;
  nginxQuitSent = true;
  nginx.kill("SIGQUIT");
}

// Node keeps the event loop alive while SIGTERM/SIGINT handlers are registered,
// so the supervisor must exit explicitly once both children are gone. Without
// this, compose recreate waits the full stop_grace_period (30s) then SIGKILLs.
function maybeExit() {
  if (workerExited && nginxExited) {
    process.exit(process.exitCode ?? 0);
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  if (workerExited) stopNginx();
  else worker.kill("SIGTERM");

  setTimeout(() => {
    if (!workerExited) worker.kill("SIGKILL");
    stopNginx();
  }, 20_000).unref();
  setTimeout(() => {
    if (!workerExited) worker.kill("SIGKILL");
    if (!nginxExited) nginx.kill("SIGKILL");
    // Exit events may still be pending after SIGKILL; do not wait on them.
    process.exit(process.exitCode ?? 0);
  }, 30_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
// Defensive: nginx base images default to STOPSIGNAL SIGQUIT. Even after the
// Dockerfile override, accept SIGQUIT so stop still drains cleanly.
process.on("SIGQUIT", () => shutdown(0));

worker.on("exit", (code, signal) => {
  workerExited = true;
  if (!shuttingDown) {
    console.error(`[supervisor] worker exited unexpectedly (${code ?? signal})`);
    shutdown(code ?? 1);
  } else {
    stopNginx();
  }
  maybeExit();
});

nginx.on("exit", (code, signal) => {
  nginxExited = true;
  if (!shuttingDown) {
    console.error(`[supervisor] nginx exited unexpectedly (${code ?? signal})`);
    shutdown(code ?? 1);
  }
  maybeExit();
});
