import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";

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

// Catch-all HTTPS material for root default_server (see renderManagerRoot /
// nginx.conf.template). Without it, a business domain listening on 8443 ssl
// becomes nginx's implicit default and unmatched Host leaks reverse-proxied content.
{
  const catchallDir = "/data/nginx/tls/default";
  const catchallCert = join(catchallDir, "fullchain.pem");
  const catchallKey = join(catchallDir, "private.key");
  if (!isReadableNonEmpty(catchallCert) || !isReadableNonEmpty(catchallKey)) {
    mkdirSync(catchallDir, { recursive: true, mode: 0o700 });
    const generated = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        catchallKey,
        "-out",
        catchallCert,
        "-days",
        "3650",
        "-subj",
        "/CN=invalid.nginx-manager.local",
      ],
      { stdio: "inherit" },
    );
    if (generated.status !== 0) {
      throw new Error("Failed to generate HTTPS catch-all certificate for default_server");
    }
    console.log("[supervisor] generated HTTPS catch-all certificate for default_server");
  }
}

const runtimeRoot = "/data/nginx";
const revisionsRoot = join(runtimeRoot, "revisions");
const bootstrapRoot = join(revisionsRoot, "bootstrap");
const activePath = join(runtimeRoot, "active");

/** Fixed loopback hosts always present in bootstrap-http server_name. */
const FIXED_BOOTSTRAP_HOSTS = ["127.0.0.1", "localhost"];
const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const BOOTSTRAP_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * BOOTSTRAP_EXTRA_HOSTS: comma/whitespace separated server IPs (or hostnames)
 * so remote access via http://<server-ip> hits bootstrap-http instead of 444.
 */
function parseBootstrapExtraHosts(raw) {
  if (!raw || !String(raw).trim()) return [];
  const parts = String(raw)
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  const hosts = [];
  const seen = new Set();
  for (const host of parts) {
    if (seen.has(host)) continue;
    const looksLikeIpv4 = /^\d+(?:\.\d+)+$/.test(host);
    const ok = looksLikeIpv4
      ? IPV4_PATTERN.test(host)
      : BOOTSTRAP_HOSTNAME_PATTERN.test(host);
    if (!ok) {
      throw new Error(
        `BOOTSTRAP_EXTRA_HOSTS entry is invalid (use IPv4 or DNS hostname): ${host}`,
      );
    }
    if (FIXED_BOOTSTRAP_HOSTS.includes(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

function bootstrapServerNameList() {
  return [...FIXED_BOOTSTRAP_HOSTS, ...parseBootstrapExtraHosts(process.env.BOOTSTRAP_EXTRA_HOSTS)];
}

/** Rewrite bootstrap-http server_name to include BOOTSTRAP_EXTRA_HOSTS. */
function injectBootstrapHosts(conf) {
  const serverNames = bootstrapServerNameList().join(" ");
  const next = conf.replace(
    /server_name 127\.0\.0\.1 localhost(?:\s+[^;]+)?;/,
    `server_name ${serverNames};`,
  );
  if (next === conf && !conf.includes(`server_name ${serverNames};`)) {
    throw new Error("Failed to inject BOOTSTRAP_EXTRA_HOSTS into nginx bootstrap server_name");
  }
  return next;
}

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

/**
 * One-shot migrations for published roots that predate:
 * - try_files $uri/index.html (avoid autoindex-off 403 on bare locale dirs)
 * - always-on HTTPS default_server with catch-all cert (avoid business domain
 *   becoming the implicit 8443 default and leaking reverse-proxied content)
 */
function migrateActiveRootIfNeeded() {
  const activeTarget = readlinkSync(activePath);
  if (isAbsolute(activeTarget) || activeTarget.split(/[\\/]/).includes("..")) {
    throw new Error("Runtime active symlink target is unsafe");
  }
  const activeRoot = join(runtimeRoot, activeTarget);
  const confPath = join(activeRoot, "nginx.conf");
  let conf = readFileSync(confPath, "utf8");
  let changed = false;

  const oldTry = "try_files $uri $uri/ $uri.html =404;";
  const newTry = "try_files $uri $uri/index.html $uri.html =404;";
  if (conf.includes(oldTry)) {
    conf = conf.split(oldTry).join(newTry);
    changed = true;
  }

  if (!/listen\s+\d+\s+ssl\s+default_server/.test(conf)) {
    const block = [
      "  server {",
      "    listen 8443 ssl default_server;",
      "    server_name _;",
      "    ssl_certificate /data/nginx/tls/default/fullchain.pem;",
      "    ssl_certificate_key /data/nginx/tls/default/private.key;",
      "    return 444;",
      "  }",
      "",
      "",
    ].join("\n");
    const includeMarker = "  include domains/*.conf;";
    if (!conf.includes(includeMarker)) {
      throw new Error("Active nginx.conf is missing domains include; cannot migrate HTTPS default_server");
    }
    conf = conf.replace(includeMarker, `${block}${includeMarker}`);
    changed = true;
  }

  // Keep bootstrap-http server_name aligned with BOOTSTRAP_EXTRA_HOSTS on restart.
  const withBootstrapHosts = injectBootstrapHosts(conf);
  if (withBootstrapHosts !== conf) {
    conf = withBootstrapHosts;
    changed = true;
  }

  if (!changed) {
    console.log("[supervisor] active revision present; no root migration needed");
    return;
  }

  const manifestPath = join(activeRoot, "manifest.json");
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    // bootstrap roots may lack a full deploy manifest
  }

  const candidateRoot = mkdtempSync(join(revisionsRoot, ".root-migrate-"));
  let revisionRoot;
  let nextActive;
  try {
    cpSync(activeRoot, candidateRoot, { recursive: true });
    writeFileSync(join(candidateRoot, "nginx.conf"), conf, { mode: 0o640 });
    if (manifest && typeof manifest === "object") {
      writeFileSync(
        join(candidateRoot, "manifest.json"),
        `${JSON.stringify({
          ...manifest,
          rootConfigChecksum: createHash("sha256").update(conf).digest("hex"),
        }, null, 2)}\n`,
        { mode: 0o640 },
      );
    }
    const test = spawnSync(
      "/usr/sbin/nginx",
      ["-p", `${candidateRoot}/`, "-t", "-c", "nginx.conf"],
      { stdio: "inherit" },
    );
    if (test.status !== 0) throw new Error("Migrated nginx root failed config test");

    const revisionId = `root-migrate-${Date.now()}-${process.pid}`;
    revisionRoot = join(revisionsRoot, revisionId);
    renameSync(candidateRoot, revisionRoot);
    nextActive = join(runtimeRoot, `.active-${revisionId}`);
    symlinkSync(`revisions/${basename(revisionRoot)}`, nextActive);
    renameSync(nextActive, activePath);
    console.log("[supervisor] migrated active root (try_files / HTTPS default_server)");
  } catch (error) {
    if (nextActive) rmSync(nextActive, { force: true });
    rmSync(revisionRoot ?? candidateRoot, { recursive: true, force: true });
    throw error;
  }
}

const extraBootstrapHosts = parseBootstrapExtraHosts(process.env.BOOTSTRAP_EXTRA_HOSTS);
if (extraBootstrapHosts.length > 0) {
  console.log(`[supervisor] BOOTSTRAP_EXTRA_HOSTS: ${extraBootstrapHosts.join(", ")}`);
}

if (!activeExists) {
  // Contract A: only write bootstrap root when there is no active revision.
  // Do NOT call refreshActiveRoot when active already exists — that would wipe published manager segments.
  const nginxTemplate = injectBootstrapHosts(
    readFileSync("/etc/nginx/templates/nginx-manager.conf.template", "utf8"),
  );
  mkdirSync(join(bootstrapRoot, "domains"), { recursive: true });
  writeFileSync(join(bootstrapRoot, "nginx.conf"), nginxTemplate, { mode: 0o640 });
  const nextActive = join(runtimeRoot, ".active-bootstrap");
  symlinkSync("revisions/bootstrap", nextActive);
  renameSync(nextActive, activePath);
  console.log("[supervisor] wrote bootstrap root (no prior active revision)");
} else {
  migrateActiveRootIfNeeded();
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
