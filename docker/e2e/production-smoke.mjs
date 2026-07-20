import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const suffix = `${process.pid}-${Date.now()}`;
const image = `nginx-panel-production-e2e:${suffix}`;
const managerHost = "manager.test";
const containerNames = [];
const volumeKeys = ["db", "nginx", "certificates", "acme", "logs", "secrets", "invalid-secrets"];
const volumes = Object.fromEntries(volumeKeys.map((key) => [key, `nginx-panel-e2e-${key}-${suffix}`]));
const volumeNames = Object.values(volumes);

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function step(message) {
  process.stdout.write(`\n[e2e] ${message}\n`);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function createVolumes() {
  for (const name of volumeNames) docker(["volume", "create", name]);
}

function populateMasterKey(volume) {
  const script = [
    "set -eu",
    "head -c 32 /dev/urandom > /test-secrets/nginx_manager_master_key",
    "chown 10001:10001 /test-secrets/nginx_manager_master_key",
    "chmod 0400 /test-secrets/nginx_manager_master_key",
  ].join("; ");
  docker(["run", "--rm", "--user", "0", "-v", `${volume}:/test-secrets`, "--entrypoint", "sh", image, "-c", script]);
}

function populateIncompleteTls(volume) {
  const script = [
    "set -eu",
    "printf invalid-certificate > /test-secrets/manager.crt",
    "head -c 32 /dev/urandom > /test-secrets/nginx_manager_master_key",
    "chown 10001:10001 /test-secrets/*",
    "chmod 0400 /test-secrets/*",
  ].join("; ");
  docker(["run", "--rm", "--user", "0", "-v", `${volume}:/test-secrets`, "--entrypoint", "sh", image, "-c", script]);
}

function environmentArgs({ withHost = false, withTls = false } = {}) {
  const args = [
    "-e", "APP_ENV=production",
    "-e", "DB_ENGINE=sqlite",
    "-e", "DB_SQLITE_DIR=/data/db",
    "-e", "NGINX_LOG_DIR=/data/logs",
    "-e", "NGINX_RUNTIME_ROOT=/data/nginx",
    "-e", "PORT=8787",
    "-e", "RUNTIME_MODE=nginx-manager",
  ];
  if (withHost) {
    args.push("-e", `MANAGER_HOST=${managerHost}`, "-e", `MANAGER_URL=https://${managerHost}`);
  }
  if (withTls) {
    args.push(
      "-e", "MANAGER_TLS_CERT_FILE=/run/secrets/manager.crt",
      "-e", "MANAGER_TLS_KEY_FILE=/run/secrets/manager.key",
    );
  }
  return args;
}

function hardenedContainerArgs(name, envOptions = {}) {
  return [
    "run", "-d", "--name", name,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256",
    "--memory", "1g",
    "--cpus", "1",
    "--tmpfs", "/run/nginx:uid=10001,gid=10001,mode=0750",
    "--tmpfs", "/tmp:uid=10001,gid=10001,mode=1770",
    "-v", `${volumes.db}:/data/db`,
    "-v", `${volumes.nginx}:/data/nginx`,
    "-v", `${volumes.certificates}:/data/certs`,
    "-v", `${volumes.acme}:/data/acme`,
    "-v", `${volumes.logs}:/data/logs`,
    "-v", `${volumes.secrets}:/run/secrets:ro`,
    "-p", "127.0.0.1::8080",
    "-p", "127.0.0.1::8443",
    ...environmentArgs(envOptions),
    image,
  ];
}

function waitForHealthy(name) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = docker(["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", name], { allowFailure: true });
    const status = result.stdout.trim();
    if (status === "running healthy") return;
    if (status.startsWith("exited") || status.startsWith("dead")) {
      throw new Error(`container exited before becoming healthy\n${docker(["logs", name], { allowFailure: true }).stdout}`);
    }
    sleep(500);
  }
  throw new Error(`container did not become healthy\n${docker(["logs", name], { allowFailure: true }).stdout}`);
}

function publishedPort(name, containerPort) {
  const output = docker(["port", name, `${containerPort}/tcp`]).stdout.trim();
  const match = output.match(/:(\d+)$/);
  if (!match) throw new Error(`cannot resolve published port from ${output}`);
  return Number(match[1]);
}

function requestOnce({ port, secure = false, host = "127.0.0.1", path, method = "GET", headers = {}, body, allowConnectionReset = false }) {
  return new Promise((resolve, reject) => {
    const transport = secure ? httpsRequest : httpRequest;
    const req = transport({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      servername: secure ? host : undefined,
      rejectUnauthorized: false,
      headers: { host, ...headers },
      timeout: 10_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", (error) => {
      // nginx return 444 closes the connection without an HTTP response.
      if (allowConnectionReset && (error?.code === "ECONNRESET" || error?.message?.includes("socket hang up"))) {
        resolve({ status: 444, headers: {}, body: "" });
        return;
      }
      reject(error);
    });
    if (body) req.write(body);
    req.end();
  });
}

async function request(options) {
  // nginx reload during manager deploy can drop in-flight connections; retry transient resets.
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await requestOnce(options);
    } catch (error) {
      lastError = error;
      const transient = error?.code === "ECONNRESET"
        || error?.code === "ECONNREFUSED"
        || error?.message?.includes("socket hang up")
        || error?.message?.includes("request timed out");
      if (!transient || options.allowConnectionReset) throw error;
      sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

function cookieHeader(setCookie) {
  const first = setCookie?.[0];
  if (!first) return null;
  return first.split(";", 1)[0];
}

function assertCookieInsecure(setCookie) {
  const raw = setCookie?.[0] ?? "";
  assert.match(raw, /nginx_manager_session=/);
  assert.doesNotMatch(raw, /;\s*Secure/i);
}

async function assertBootstrapHttp(name) {
  const httpPort = publishedPort(name, 8080);

  // Bootstrap host never 308s to HTTPS.
  const local = await request({ port: httpPort, secure: false, host: "127.0.0.1", path: "/api/health" });
  assert.equal(local.status, 200, local.body);

  const localhost = await request({ port: httpPort, secure: false, host: "localhost", path: "/api/setup/status" });
  assert.equal(localhost.status, 200, localhost.body);
  assert.deepEqual(JSON.parse(localhost.body), { setupRequired: true });

  // Unknown host still rejected by default_server (444 closes the socket).
  const unknown = await request({
    port: httpPort,
    secure: false,
    host: "evil.example",
    path: "/",
    allowConnectionReset: true,
  });
  assert.equal(unknown.status, 444);

  // Static export lives under [locale] with index.html directories (trailingSlash).
  // There is no /en/index.html root page; locale entry is / then client redirect.
  for (const path of [
    "/",
    "/en/login/",
    "/en/settings/manager/",
    "/en/settings/diagnostics/",
    "/en/domains/",
    "/en/dashboard/",
  ]) {
    const response = await request({ port: httpPort, secure: false, host: "127.0.0.1", path });
    assert.equal(response.status, 200, `${path} should resolve to a static page shell`);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
  }

  return { httpPort };
}

async function setupLoginAndBind(httpPort) {
  const origin = "http://127.0.0.1";
  const setupBody = JSON.stringify({
    username: "admin",
    password: "e2e-password-123",
    managerPrimaryHostname: managerHost,
  });
  const setup = await request({
    port: httpPort,
    host: "127.0.0.1",
    path: "/api/setup/admin",
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(setupBody),
    },
    body: setupBody,
  });
  assert.equal(setup.status, 201, setup.body);
  assertCookieInsecure(setup.headers["set-cookie"]);
  const cookie = cookieHeader(setup.headers["set-cookie"]);
  assert.ok(cookie, "setup should issue a session cookie");

  // Wrong origin rejected.
  const badOriginBody = JSON.stringify({ username: "admin", password: "e2e-password-123", remember: true });
  const badOrigin = await request({
    port: httpPort,
    host: "127.0.0.1",
    path: "/api/auth/login",
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(badOriginBody),
    },
    body: badOriginBody,
  });
  assert.equal(badOrigin.status, 403, badOrigin.body);

  // Bootstrap reserved hostnames cannot be claimed as business domains.
  for (const hostname of ["localhost", "127.0.0.1", managerHost]) {
    if (hostname === "127.0.0.1") continue; // hostnameSchema rejects IP literals
    const domainBody = JSON.stringify({
      config: {
        schemaVersion: 1,
        primaryHostname: hostname === "localhost" ? "localhost.invalid" : hostname,
        aliases: hostname === "localhost" ? [] : [],
        routes: [],
        headers: [],
        ssl: {
          enabled: false,
          provider: "letsencrypt",
          environment: "production",
          email: "",
          autoRenew: true,
          forceHttps: false,
          validation: { method: "http-01" },
        },
        advanced: { serverSnippet: "" },
      },
    });
    // Prefer managerHost conflict (reserved via draft/active manager).
    if (hostname !== managerHost) continue;
    const conflict = await request({
      port: httpPort,
      host: "127.0.0.1",
      path: "/api/domains",
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(domainBody),
      },
      body: domainBody,
    });
    assert.equal(conflict.status, 409, conflict.body);
    assert.equal(JSON.parse(conflict.body).code, "DOMAIN_CONFLICT");
  }

  // Manager is hidden from domain list / GET by id.
  const list = await request({
    port: httpPort,
    host: "127.0.0.1",
    path: "/api/domains",
    headers: { cookie, origin },
  });
  assert.equal(list.status, 200, list.body);
  const items = JSON.parse(list.body).items ?? [];
  assert.equal(items.some((item) => item.primaryHostname === managerHost), false);

  // Setup enqueues a root deploy in RUNTIME_MODE=nginx-manager. Prefer waiting for that
  // path; only call publish if still draft after a grace period (setup deploy failed/skipped).
  const settleDeadline = Date.now() + 90_000;
  const publishAfter = Date.now() + 8_000;
  let manager = null;
  let publishAttempted = false;
  while (Date.now() < settleDeadline) {
    const managerStatus = await request({
      port: httpPort,
      host: "127.0.0.1",
      path: "/api/settings/manager",
      headers: { cookie, origin },
    });
    assert.equal(managerStatus.status, 200, managerStatus.body);
    manager = JSON.parse(managerStatus.body);
    assert.ok(manager.domainId, "setup should create a manager domain");
    if (manager.status === "bound") break;
    if (
      !publishAttempted
      && Date.now() >= publishAfter
      && manager.canPublish
      && manager.status === "draft"
    ) {
      publishAttempted = true;
      const publish = await request({
        port: httpPort,
        host: "127.0.0.1",
        path: "/api/settings/manager/publish",
        method: "POST",
        headers: {
          cookie,
          origin,
          "Idempotency-Key": `e2e-publish-${suffix}`,
        },
      });
      // Setup deploy may already have moved the draft; tolerate conflicts.
      assert.ok([200, 202, 409].includes(publish.status), publish.body);
    }
    sleep(500);
  }
  assert.ok(manager, "manager status missing");
  assert.equal(manager.status, "bound", JSON.stringify(manager));

  const hidden = await request({
    port: httpPort,
    host: "127.0.0.1",
    path: `/api/domains/${manager.domainId}`,
    headers: { cookie, origin },
  });
  assert.equal(hidden.status, 404, hidden.body);

  // Bound host HTTP serves manager (no TLS in greenfield — UI+API, not 308 without cert).
  const boundHealth = await request({
    port: httpPort,
    host: managerHost,
    path: "/api/health",
  });
  assert.equal(boundHealth.status, 200, boundHealth.body);

  // Login again on bootstrap and confirm Secure is still off for HTTP.
  const loginBody = JSON.stringify({ username: "admin", password: "e2e-password-123", remember: false });
  const login = await request({
    port: httpPort,
    host: "127.0.0.1",
    path: "/api/auth/login",
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(loginBody),
    },
    body: loginBody,
  });
  assert.equal(login.status, 200, login.body);
  assertCookieInsecure(login.headers["set-cookie"]);

  return { cookie };
}

function assertHardenedContainer(name) {
  const inspection = JSON.parse(docker(["inspect", name]).stdout)[0];
  assert.equal(inspection.Config.User, "nginx-manager");
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.ok(inspection.HostConfig.CapDrop?.includes("ALL"));
  assert.ok(inspection.HostConfig.SecurityOpt?.includes("no-new-privileges:true"));
  assert.equal(inspection.NetworkSettings.Ports?.["8787/tcp"], undefined);
  assert.equal(docker(["exec", name, "id", "-u"]).stdout.trim(), "10001");
}

function expectIncompleteTlsStartupFailure() {
  const result = docker([
    "run", "--rm",
    "-v", `${volumes["invalid-secrets"]}:/run/secrets:ro`,
    ...environmentArgs({ withTls: true }),
    image,
  ], { allowFailure: true });
  assert.notEqual(result.status, 0, "incomplete manager TLS pair must fail container startup");
}

function cleanup() {
  for (const name of containerNames) docker(["rm", "-f", name], { allowFailure: true });
  for (const name of volumeNames) docker(["volume", "rm", "-f", name], { allowFailure: true });
  docker(["image", "rm", "-f", image], { allowFailure: true });
}

async function main() {
  try {
    step("building the pinned production image");
    docker(["build", "--file", "docker/Dockerfile", "--tag", image, "."], { stdio: "inherit" });
    createVolumes();
    populateMasterKey(volumes.secrets);
    populateIncompleteTls(volumes["invalid-secrets"]);

    step("checking startup rejection for incomplete manager TLS pair");
    expectIncompleteTlsStartupFailure();

    const first = `nginx-panel-e2e-manager-${suffix}`;
    containerNames.push(first);
    step("starting greenfield container (no MANAGER_HOST / TLS)");
    docker(hardenedContainerArgs(first));
    waitForHealthy(first);
    assertHardenedContainer(first);
    const { httpPort } = await assertBootstrapHttp(first);
    await setupLoginAndBind(httpPort);

    step("restarting with the same persistent volumes (root rewrite must not wipe bind)");
    docker(["rm", "-f", first]);
    containerNames.splice(containerNames.indexOf(first), 1);
    const restarted = `nginx-panel-e2e-restarted-${suffix}`;
    containerNames.push(restarted);
    docker(hardenedContainerArgs(restarted));
    waitForHealthy(restarted);
    const restartedHttp = publishedPort(restarted, 8080);

    const persisted = await request({
      port: restartedHttp,
      host: "127.0.0.1",
      path: "/api/setup/status",
    });
    assert.deepEqual(JSON.parse(persisted.body), { setupRequired: false });

    // Bound hostname still answers after restart without MANAGER_HOST env.
    const boundAfterRestart = await request({
      port: restartedHttp,
      host: managerHost,
      path: "/api/health",
    });
    assert.equal(boundAfterRestart.status, 200, boundAfterRestart.body);

    // nginx.conf on disk still contains bound server_name.
    const conf = docker([
      "exec", restarted, "sh", "-c", "cat /data/nginx/active/nginx.conf",
    ]).stdout;
    assert.match(conf, /server_name 127\.0\.0\.1 localhost;/);
    assert.match(conf, new RegExp(`server_name ${managerHost.replace(/\./g, "\\.")}`));
    assert.match(conf, /X-Forwarded-Proto \$scheme;/);
    assert.doesNotMatch(conf, /X-Forwarded-Proto https;/);

    step("production Docker smoke E2E passed");
  } finally {
    cleanup();
  }
}

await main();
