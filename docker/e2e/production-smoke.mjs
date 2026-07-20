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

function populateSecrets(volume, validCertificate) {
  const script = validCertificate
    ? [
        "set -eu",
        `openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=${managerHost} -addext subjectAltName=DNS:${managerHost} -keyout /test-secrets/manager.key -out /test-secrets/manager.crt >/dev/null 2>&1`,
        "head -c 32 /dev/urandom > /test-secrets/nginx_manager_master_key",
        "chown 10001:10001 /test-secrets/*",
        "chmod 0400 /test-secrets/*",
      ].join("; ")
    : [
        "set -eu",
        "printf invalid-certificate > /test-secrets/manager.crt",
        "printf invalid-private-key > /test-secrets/manager.key",
        "head -c 32 /dev/urandom > /test-secrets/nginx_manager_master_key",
        "chown 10001:10001 /test-secrets/*",
        "chmod 0400 /test-secrets/*",
      ].join("; ");
  docker(["run", "--rm", "--user", "0", "-v", `${volume}:/test-secrets`, "--entrypoint", "sh", image, "-c", script]);
}

function environmentArgs() {
  return [
    "-e", "APP_ENV=production",
    "-e", "DB_ENGINE=sqlite",
    "-e", "DB_SQLITE_DIR=/data/db",
    "-e", `MANAGER_HOST=${managerHost}`,
    "-e", `MANAGER_URL=https://${managerHost}`,
    "-e", "MANAGER_TLS_CERT_FILE=/run/secrets/manager.crt",
    "-e", "MANAGER_TLS_KEY_FILE=/run/secrets/manager.key",
    "-e", "NGINX_LOG_DIR=/data/logs",
    "-e", "NGINX_RUNTIME_ROOT=/data/nginx",
    "-e", "PORT=8787",
    "-e", "RUNTIME_MODE=nginx-manager",
  ];
}

function hardenedContainerArgs(name) {
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
    ...environmentArgs(),
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

function request({ port, secure, path, method = "GET", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const transport = secure ? httpsRequest : httpRequest;
    const req = transport({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      servername: secure ? managerHost : undefined,
      rejectUnauthorized: false,
      headers: { host: managerHost, ...headers },
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
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function assertProductionRoutes(name) {
  const httpPort = publishedPort(name, 8080);
  const httpsPort = publishedPort(name, 8443);
  const redirect = await request({ port: httpPort, secure: false, path: "/settings/diagnostics?source=e2e" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, `https://${managerHost}/settings/diagnostics?source=e2e`);

  for (const path of [
    "/",
    "/domains",
    "/domains/create",
    "/domains/overview?id=domain-1",
    "/domains/ssl?id=domain-1&orderId=order-1",
    "/domains/version?id=domain-1&versionId=version-1",
    "/domains/version?id=domain-1&versionId=version-1&base=version-0",
    "/deployments/detail?id=deployment-1",
    "/settings/diagnostics",
    "/settings/nginx",
  ]) {
    const response = await request({ port: httpsPort, secure: true, path });
    assert.equal(response.status, 200, `${path} should resolve to a static page shell`);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
  }

  const settings = await request({ port: httpsPort, secure: true, path: "/settings" });
  assert.equal(settings.status, 200);
  assert.match(settings.headers["content-type"] ?? "", /text\/html/);
  assert.equal((await request({ port: httpsPort, secure: true, path: "/domains/not-a-section" })).status, 404);
  assert.equal((await request({ port: httpsPort, secure: true, path: "/settings/diagnostics/extra" })).status, 404);
  assert.equal((await request({ port: httpsPort, secure: true, path: "/internal/health" })).status, 404);
  assert.equal((await request({ port: httpsPort, secure: true, path: "/api/health" })).status, 200);
  return { httpsPort };
}

async function initializeAndAssertReservedHostname(httpsPort) {
  const setupStatus = await request({ port: httpsPort, secure: true, path: "/api/setup/status" });
  assert.deepEqual(JSON.parse(setupStatus.body), { setupRequired: true });
  const setupBody = JSON.stringify({ username: "admin", password: "e2e-password-123" });
  const setup = await request({
    port: httpsPort,
    secure: true,
    path: "/api/setup/admin",
    method: "POST",
    headers: { origin: `https://${managerHost}`, "content-type": "application/json", "content-length": Buffer.byteLength(setupBody) },
    body: setupBody,
  });
  assert.equal(setup.status, 201, setup.body);
  const cookie = setup.headers["set-cookie"]?.[0]?.split(";", 1)[0];
  assert.ok(cookie, "setup should issue a session cookie");

  const domainBody = JSON.stringify({ config: {
    schemaVersion: 1,
    primaryHostname: managerHost,
    aliases: [],
    routes: [],
    headers: [],
    ssl: {
      enabled: false,
      provider: "letsencrypt",
      environment: "production",
      email: "ops@manager.test",
      autoRenew: true,
      forceHttps: false,
      validation: { method: "http-01" },
    },
    advanced: { serverSnippet: "" },
  } });
  const conflict = await request({
    port: httpsPort,
    secure: true,
    path: "/api/domains",
    method: "POST",
    headers: {
      cookie,
      origin: `https://${managerHost}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(domainBody),
    },
    body: domainBody,
  });
  assert.equal(conflict.status, 409, conflict.body);
  assert.equal(JSON.parse(conflict.body).code, "DOMAIN_CONFLICT");
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

function expectStartupFailure(secretVolume, certPath) {
  const environment = environmentArgs().map((value) => value.startsWith("MANAGER_TLS_CERT_FILE=") && certPath
    ? `MANAGER_TLS_CERT_FILE=${certPath}`
    : value);
  const result = docker([
    "run", "--rm",
    "-v", `${secretVolume}:/run/secrets:ro`,
    ...environment,
    image,
  ], { allowFailure: true });
  assert.notEqual(result.status, 0, "invalid TLS inputs must fail container startup");
}

function cleanup() {
  for (const name of containerNames) docker(["rm", "-f", name], { allowFailure: true });
  for (const name of volumeNames) docker(["volume", "rm", "-f", name], { allowFailure: true });
  docker(["image", "rm", "-f", image], { allowFailure: true });
}

async function main() {
  try {
    step("building the pinned production image");
    docker(["build", "--file", "docker/Dockerfile.production", "--tag", image, "."], { stdio: "inherit" });
    createVolumes();
    populateSecrets(volumes.secrets, true);
    populateSecrets(volumes["invalid-secrets"], false);

    step("checking startup rejection for missing and invalid manager TLS");
    expectStartupFailure(volumes.secrets, "/run/secrets/missing.crt");
    expectStartupFailure(volumes["invalid-secrets"]);

    const first = `nginx-panel-e2e-manager-${suffix}`;
    containerNames.push(first);
    step("starting the hardened production container");
    docker(hardenedContainerArgs(first));
    waitForHealthy(first);
    assertHardenedContainer(first);
    const { httpsPort } = await assertProductionRoutes(first);
    await initializeAndAssertReservedHostname(httpsPort);

    step("restarting with the same persistent volumes");
    docker(["rm", "-f", first]);
    containerNames.splice(containerNames.indexOf(first), 1);
    const restarted = `nginx-panel-e2e-restarted-${suffix}`;
    containerNames.push(restarted);
    docker(hardenedContainerArgs(restarted));
    waitForHealthy(restarted);
    const restartedHttpsPort = publishedPort(restarted, 8443);
    const persisted = await request({ port: restartedHttpsPort, secure: true, path: "/api/setup/status" });
    assert.deepEqual(JSON.parse(persisted.body), { setupRequired: false });

    step("production Docker smoke E2E passed");
  } finally {
    cleanup();
  }
}

await main();
