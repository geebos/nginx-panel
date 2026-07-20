import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("docker/nginx/nginx.conf.template rejects requests for unknown hosts", async () => {
  const config = await readFile("docker/nginx/nginx.conf.template", "utf8");
  const defaultServerStart = config.indexOf("  server {\n    listen 8080 default_server;");
  const defaultServerEnd = config.indexOf("\n  server {", defaultServerStart + 1);

  assert.notEqual(defaultServerStart, -1);
  assert.notEqual(defaultServerEnd, -1);
  assert.match(config.slice(defaultServerStart, defaultServerEnd), /server_name _;[\s\S]*return 444;/);
});

test("bootstrap template serves localhost without 308 and forwards $scheme", async () => {
  const config = await readFile("docker/nginx/nginx.conf.template", "utf8");
  assert.match(config, /server_name 127\.0\.0\.1 localhost;/);
  assert.match(config, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.doesNotMatch(config, /X-Forwarded-Proto https;/);
  assert.doesNotMatch(config, /return 308 https:\/\//);
  assert.doesNotMatch(config, /\$\{MANAGER_HOST\}/);
  assert.match(config, /try_files \$uri \$uri\/index\.html \$uri\.html =404;/);
  assert.match(config, /listen 8443 ssl default_server;/);
  assert.match(config, /ssl_certificate \/data\/nginx\/tls\/default\/fullchain\.pem;/);
});
