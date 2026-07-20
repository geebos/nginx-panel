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
import { refreshActiveRoot } from "./runtime-root.mjs";

const DEFAULT_CERT_FILE = "/run/secrets/manager.crt";
const DEFAULT_KEY_FILE = "/run/secrets/manager.key";
const DEFAULT_MASTER_KEY_FILE = "/run/secrets/nginx_manager_master_key";
const GENERATED_SECRETS_DIR = "/data/secrets";

const requiredEnvironment = [
  "MANAGER_HOST",
  "MANAGER_URL",
  "NGINX_LOG_DIR",
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const managerHost = process.env.MANAGER_HOST;
const managerUrl = new URL(process.env.MANAGER_URL);
if (
  managerUrl.protocol !== "https:" ||
  managerUrl.hostname !== managerHost ||
  !/^[a-z0-9.-]+$/.test(managerHost)
) {
  throw new Error("MANAGER_URL must be HTTPS and match the normalized MANAGER_HOST");
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

function generateTlsMaterial() {
  ensureGeneratedSecretsDir();
  const certFile = join(GENERATED_SECRETS_DIR, "manager.crt");
  const keyFile = join(GENERATED_SECRETS_DIR, "manager.key");
  if (isReadableNonEmpty(certFile) && isReadableNonEmpty(keyFile)) {
    return { certFile, keyFile };
  }

  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "825",
      "-subj",
      `/CN=${managerHost}`,
      "-addext",
      `subjectAltName=DNS:${managerHost}`,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to generate manager TLS material\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return { certFile, keyFile };
}

function resolveTlsFiles() {
  const certFile = process.env.MANAGER_TLS_CERT_FILE || DEFAULT_CERT_FILE;
  const keyFile = process.env.MANAGER_TLS_KEY_FILE || DEFAULT_KEY_FILE;
  const certReady = isReadableNonEmpty(certFile);
  const keyReady = isReadableNonEmpty(keyFile);

  if (certReady && keyReady) {
    return { certFile, keyFile };
  }
  if (certReady !== keyReady) {
    throw new Error(
      `Manager TLS secrets are incomplete: cert=${certReady ? "present" : "missing"}, key=${keyReady ? "present" : "missing"}`,
    );
  }

  const usingDefaults =
    certFile === DEFAULT_CERT_FILE && keyFile === DEFAULT_KEY_FILE;
  if (!usingDefaults) {
    throw new Error(`Required secret is missing: ${certReady ? keyFile : certFile}`);
  }

  console.warn(
    `[supervisor] Manager TLS secrets not provided; generating a self-signed certificate for ${managerHost}`,
  );
  const generated = generateTlsMaterial();
  process.env.MANAGER_TLS_CERT_FILE = generated.certFile;
  process.env.MANAGER_TLS_KEY_FILE = generated.keyFile;
  return generated;
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

const tlsFiles = resolveTlsFiles();
resolveMasterKeyFile();

const logDirectory = process.env.NGINX_LOG_DIR;
if (!isAbsolute(logDirectory) || logDirectory === "/") {
  throw new Error("NGINX_LOG_DIR must be an absolute path other than /");
}
accessSync(logDirectory, constants.R_OK | constants.W_OK);

for (const directory of ["client", "fastcgi", "proxy", "scgi", "uwsgi"]) {
  mkdirSync(`/run/nginx/${directory}_temp`, { recursive: true });
}

const nginxTemplate = readFileSync(
  "/etc/nginx/templates/nginx-manager.conf.template",
  "utf8",
);
const nginxConfig = nginxTemplate.replace(
  /\$\{(MANAGER_HOST|MANAGER_TLS_CERT_FILE|MANAGER_TLS_KEY_FILE)\}/g,
  (_, name) => {
    if (name === "MANAGER_TLS_CERT_FILE") return tlsFiles.certFile;
    if (name === "MANAGER_TLS_KEY_FILE") return tlsFiles.keyFile;
    return process.env[name];
  },
);
const runtimeRoot = "/data/nginx";
const revisionsRoot = join(runtimeRoot, "revisions");
const bootstrapRoot = join(revisionsRoot, "bootstrap");
const activePath = join(runtimeRoot, "active");
mkdirSync(join(bootstrapRoot, "domains"), { recursive: true });
writeFileSync(join(bootstrapRoot, "nginx.conf"), nginxConfig, { mode: 0o640 });
try {
  const activeStat = lstatSync(activePath);
  if (!activeStat.isSymbolicLink()) throw new Error("Runtime active path must be a symlink");
  const target = readlinkSync(activePath);
  if (target.includes("..") || isAbsolute(target)) throw new Error("Runtime active symlink target is unsafe");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    const nextActive = join(runtimeRoot, ".active-bootstrap");
    symlinkSync("revisions/bootstrap", nextActive);
    renameSync(nextActive, activePath);
  } else {
    throw error;
  }
}

refreshActiveRoot({
  runtimeRoot,
  rootConfig: nginxConfig,
  validate: (candidateRoot) => {
    const result = spawnSync("/usr/sbin/nginx", ["-p", `${candidateRoot}/`, "-t", "-c", "nginx.conf"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("refreshed nginx configuration test failed");
  },
});

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
