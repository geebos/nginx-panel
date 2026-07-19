import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const requiredEnvironment = [
  "MANAGER_HOST",
  "MANAGER_URL",
  "MANAGER_TLS_CERT_FILE",
  "MANAGER_TLS_KEY_FILE",
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

const secretFiles = [
  process.env.MANAGER_TLS_CERT_FILE,
  process.env.MANAGER_TLS_KEY_FILE,
  "/run/secrets/nginx_manager_master_key",
];
for (const file of secretFiles) {
  accessSync(file, constants.R_OK);
  if (statSync(file).size === 0) throw new Error(`Required secret is empty: ${file}`);
}
if (statSync("/run/secrets/nginx_manager_master_key").size !== 32) {
  throw new Error("nginx_manager_master_key must contain exactly 32 bytes");
}

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
  (_, name) => process.env[name],
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

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  worker.kill("SIGTERM");
  nginx.kill("SIGQUIT");

  setTimeout(() => {
    worker.kill("SIGKILL");
    nginx.kill("SIGKILL");
  }, 25_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

worker.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[supervisor] worker exited unexpectedly (${code ?? signal})`);
    shutdown(code ?? 1);
  }
});

nginx.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[supervisor] nginx exited unexpectedly (${code ?? signal})`);
    shutdown(code ?? 1);
  }
});
