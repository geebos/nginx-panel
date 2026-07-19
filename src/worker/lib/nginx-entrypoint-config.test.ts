import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const configPath of [
  "docker/nginx/nginx.development.conf",
  "docker/nginx/nginx.conf.template",
]) {
  test(`${configPath} rejects requests for unknown hosts`, async () => {
    const config = await readFile(configPath, "utf8");
    const defaultServerStart = config.indexOf("  server {\n    listen 8080 default_server;");
    const defaultServerEnd = config.indexOf("\n  server {", defaultServerStart + 1);

    assert.notEqual(defaultServerStart, -1);
    assert.notEqual(defaultServerEnd, -1);
    assert.match(config.slice(defaultServerStart, defaultServerEnd), /server_name _;[\s\S]*return 444;/);
  });
}
