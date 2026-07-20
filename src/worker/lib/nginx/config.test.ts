import assert from "node:assert/strict";
import { mkdtemp, mkdir, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { domainConfigSchema, nginxLogSettingsInputSchema, parseAdvancedSnippet, type DomainConfig } from "@/shared/schemas";
import { injectAccessLogFormat, renderDomainConfig, renderDomainPreview, renderManagerRoot, renderRootConfig } from "@/worker/lib/nginx/config";
import { checksum, createRuntimeManifest } from "@/worker/lib/runtime/manifest";

const execFileAsync = promisify(execFile);

const snapshot: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: ["www.example.com"],
  routes: [
    {
      id: "route-api",
      type: "proxy",
      path: "/api",
      target: "http://127.0.0.1:3000",
      websocket: true,
      preserveHost: true,
      connectTimeoutSeconds: 30,
      readTimeoutSeconds: 60,
      sendTimeoutSeconds: 60,
      enabled: true,
      order: 0,
    },
    {
      id: "route-disabled",
      type: "redirect",
      path: "/old",
      target: "https://example.com/new",
      statusCode: 301,
      enabled: false,
      order: 1,
    },
  ],
  headers: [],
  ssl: {
    enabled: false,
    provider: "letsencrypt",
    environment: "production",
    email: "ops@example.com",
    autoRenew: true,
    forceHttps: true,
    validation: { method: "http-01" },
  },
  advanced: { serverSnippet: "client_max_body_size 16m;" },
};

test("log settings require core fields and safely inject whitelisted variables", () => {
  const input = nginxLogSettingsInputSchema.parse({
    accessFields: ["timestamp", "domain", "method", "path", "request_uri", "status", "client_ip", "upstream_time"],
    errorLevel: "notice",
    maxFileSizeMiB: 10,
    retainedFiles: 3,
  });
  const template = "http {\n  # nginx-manager:log-format:start\n  old format;\n  # nginx-manager:log-format:end\n}\n";
  const rendered = injectAccessLogFormat(template, input);
  assert.match(rendered, /log_format domain_manager escape=json '\{"timestamp".*"upstream_time":"\$upstream_response_time"\}';/);
  assert.match(rendered, /"client_ip":"\$remote_addr"/);
  assert.match(rendered, /"upstream_time":"\$upstream_response_time"/);
  assert.doesNotMatch(rendered, /old format/);
  assert.throws(() => nginxLogSettingsInputSchema.parse({ ...input, accessFields: ["timestamp"] }));
});

test("preview preserves route semantics and omits disabled routes", () => {
  const preview = renderDomainPreview(snapshot);
  assert.match(preview, /location "\/api"/);
  assert.match(preview, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
  assert.doesNotMatch(preview, /\/old/);
  assert.match(preview, /client_max_body_size 16m/);
  assert.doesNotMatch(preview, /access_log/);
});

test("root config keeps temp paths under the nginx prefix", () => {
  const rootConfig = renderRootConfig({ pidPath: "/tmp/nginx-manager/nginx.pid" });
  assert.match(rootConfig, /client_body_temp_path client_temp;/);
  assert.match(rootConfig, /proxy_temp_path proxy_temp;/);
  assert.match(rootConfig, /fastcgi_temp_path fastcgi_temp;/);
  assert.match(rootConfig, /scgi_temp_path scgi_temp;/);
  assert.match(rootConfig, /uwsgi_temp_path uwsgi_temp;/);
  assert.doesNotMatch(rootConfig, /\/var\/cache\/nginx/);
});

test("manager root splits bootstrap and bound servers and never 308 localhost", () => {
  const bootstrapOnly = renderManagerRoot({ userHostnames: [] });
  assert.match(bootstrapOnly, /server_name 127\.0\.0\.1 localhost;/);
  assert.match(bootstrapOnly, /X-Forwarded-Proto \$scheme;/);
  assert.doesNotMatch(bootstrapOnly, /return 308 https:\/\/\$host\$request_uri;/);
  assert.doesNotMatch(bootstrapOnly, /listen 8443 ssl;/);

  const bound = renderManagerRoot({
    userHostnames: ["panel.example.com"],
    tls: { fullchainPath: "/data/certs/fullchain.pem", privateKeyPath: "/data/certs/key.pem" },
    forceHttpsOnBound: true,
  });
  assert.match(bound, /server_name panel\.example\.com;/);
  assert.match(bound, /return 308 https:\/\/\$host\$request_uri;/);
  assert.match(bound, /listen 8443 ssl;/);
  assert.match(bound, /ssl_certificate "\/data\/certs\/fullchain\.pem";/);
  // bootstrap remains without 308
  const bootstrapBlock = bound.slice(bound.indexOf("server_name 127.0.0.1 localhost;"));
  const nextServer = bootstrapBlock.indexOf("\n  server {", 1);
  const onlyBootstrap = nextServer > 0 ? bootstrapBlock.slice(0, nextServer) : bootstrapBlock;
  assert.doesNotMatch(onlyBootstrap, /return 308/);
});

test("certificate preview uses stable placeholders", () => {
  const preview = renderDomainPreview({
    ...snapshot,
    ssl: { ...snapshot.ssl, enabled: true, certificateId: "certificate-1" },
  });
  assert.match(preview, /<certificate:certificate-1:fullchain>/);
  assert.match(preview, /<certificate:certificate-1:private-key>/);
});

test("disabled runtime keeps challenge and returns 503 without business routes", () => {
  const runtime = renderDomainConfig({
    mode: "runtime",
    domainId: "domain-1",
    snapshot,
    enabled: false,
    logs: { root: "/tmp/nginx-manager-logs", errorLevel: "warn" },
  });
  assert.match(runtime, /\.well-known\/acme-challenge/);
  assert.match(runtime, /return 503/);
  assert.doesNotMatch(runtime, /location "\/api"/);
  assert.match(runtime, /access_log "\/tmp\/nginx-manager-logs\/example.com\/access.log"/);
});

test("runtime listener projection supports the non-root production ports", () => {
  const runtime = renderDomainConfig({
    mode: "runtime",
    domainId: "domain-1",
    snapshot,
    enabled: true,
    logs: { root: "/tmp/nginx-manager-logs", errorLevel: "warn" },
    listeners: { http: 8080, https: 8443 },
  });
  assert.match(runtime, /listen 8080;/);
  assert.throws(
    () => renderDomainConfig({
      mode: "runtime",
      domainId: "domain-1",
      snapshot,
      enabled: true,
      logs: { root: "/tmp/nginx-manager-logs", errorLevel: "warn" },
      listeners: { http: 0, https: 8443 },
    }),
    /Listen port out of range/,
  );
});

test("runtime projections change generated checksum without changing source checksum", () => {
  const sourceChecksum = checksum(JSON.stringify(snapshot));
  const enabledConfig = renderDomainConfig({
    mode: "runtime",
    domainId: "domain-1",
    snapshot,
    enabled: true,
    logs: { root: "/tmp/nginx-manager-logs-a", errorLevel: "warn" },
  });
  const disabledConfig = renderDomainConfig({
    mode: "runtime",
    domainId: "domain-1",
    snapshot,
    enabled: false,
    logs: { root: "/tmp/nginx-manager-logs-b", errorLevel: "error" },
  });
  assert.notEqual(checksum(enabledConfig), checksum(disabledConfig));
  assert.equal(sourceChecksum, checksum(JSON.stringify(snapshot)));
});

test("advanced compiler rejects non-whitelisted directives", () => {
  assert.throws(
    () => renderDomainPreview({ ...snapshot, advanced: { serverSnippet: "include /tmp/unsafe.conf;" } }),
    /errors:validation.advancedLineInvalid/,
  );
});

test("shared configuration validation rejects unsafe headers and accepts formatted advanced lines", () => {
  assert.deepEqual(
    parseAdvancedSnippet("gzip on;\n\n  client_max_body_size   20m;"),
    ["gzip on;", "client_max_body_size 20m;"],
  );
  assert.throws(
    () => domainConfigSchema.parse({
      ...snapshot,
      headers: [{
        id: "hsts",
        name: "Strict-Transport-Security",
        value: "max-age=31536000",
        scope: { type: "server" },
        always: true,
        enabled: true,
      }],
    }),
    /errors:validation.hstsRequiresHttps/,
  );
});

test("static SPA fallback cannot inject nginx directives through index", () => {
  const staticSnapshot: DomainConfig = {
    ...snapshot,
    routes: [{
      id: "static-app",
      type: "static",
      path: "/app",
      root: "/srv/app",
      index: "index.html",
      spaFallback: true,
      enabled: true,
      order: 0,
    }],
  };
  assert.match(renderDomainPreview(staticSnapshot), /try_files \$uri \$uri\/ "\/index\.html";/);
  assert.throws(
    () => domainConfigSchema.parse({
      ...staticSnapshot,
      routes: [{ ...staticSnapshot.routes[0], index: "; return 200 pwned; #" }],
    }),
    /errors:validation.indexFileFormat/,
  );
  for (const index of [".", ".."]) {
    assert.throws(
      () => domainConfigSchema.parse({
        ...staticSnapshot,
        routes: [{ ...staticSnapshot.routes[0], index }],
      }),
      /errors:validation.indexFileDot/,
    );
  }
});

test("candidate passes nginx -t and active symlink switches atomically", async (t) => {
  const nginxBin = process.env.NGINX_BIN || "nginx";
  try {
    await execFileAsync(nginxBin, ["-v"]);
  } catch {
    t.skip("nginx binary is unavailable");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "nginx-manager-spike-"));
  const logsRoot = join(root, "domain-logs");
  const pidPath = join(root, "nginx.pid");
  await mkdir(join(logsRoot, "example.com"), { recursive: true });
  const rootConfig = renderRootConfig({ pidPath });
  const domainConfig = renderDomainConfig({
    mode: "runtime",
    domainId: "domain-1",
    snapshot,
    enabled: true,
    logs: { root: logsRoot, errorLevel: "warn" },
  });

  for (const revision of ["candidate-a", "candidate-b"]) {
    const revisionRoot = join(root, revision);
    await mkdir(join(revisionRoot, "domains"), { recursive: true });
    await writeFile(join(revisionRoot, "nginx.conf"), rootConfig);
    await writeFile(join(revisionRoot, "domains", "domain-1.conf"), domainConfig);
    await execFileAsync(nginxBin, ["-p", `${revisionRoot}/`, "-t", "-c", "nginx.conf"]);
  }

  const manifest = createRuntimeManifest({
    rootConfig,
    logSettings: { revision: 1, checksum: checksum("logs-v1") },
    rootInputs: { logsRoot, runtimeRoot: root },
    domains: {
      "domain-1": {
        sourceVersionId: "version-1",
        snapshotChecksum: checksum(JSON.stringify(snapshot)),
        enabled: true,
        certificateId: null,
        configChecksum: checksum(domainConfig),
      },
    },
  });
  assert.equal(manifest.rootConfigChecksum, checksum(rootConfig));

  const active = join(root, "active");
  const next = join(root, ".active-next");
  await symlink("candidate-a", active);
  await symlink("candidate-b", next);
  await import("node:fs/promises").then(({ rename }) => rename(next, active));
  assert.equal(await readlink(active), "candidate-b");
  await execFileAsync(nginxBin, ["-p", `${active}/`, "-t", "-c", "nginx.conf"]);

  const brokenRoot = join(root, "candidate-broken");
  await mkdir(join(brokenRoot, "domains"), { recursive: true });
  await writeFile(join(brokenRoot, "nginx.conf"), `${rootConfig}\ninvalid_directive on;\n`);
  await writeFile(join(brokenRoot, "domains", "domain-1.conf"), domainConfig);
  await assert.rejects(
    execFileAsync(nginxBin, ["-p", `${brokenRoot}/`, "-t", "-c", "nginx.conf"]),
  );
  assert.equal(await readlink(active), "candidate-b");

  await symlink("candidate-broken", next);
  await import("node:fs/promises").then(({ rename }) => rename(next, active));
  await assert.rejects(
    execFileAsync(nginxBin, ["-p", `${active}/`, "-t", "-c", "nginx.conf"]),
  );
  await symlink("candidate-b", next);
  await import("node:fs/promises").then(({ rename }) => rename(next, active));
  await execFileAsync(nginxBin, ["-p", `${active}/`, "-t", "-c", "nginx.conf"]);
});
