import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapOrigins,
  getBootstrapHosts,
  managerUrl,
  parseBootstrapExtraHosts,
  validateRuntimeEnv,
} from "@/worker/lib/runtime/env";

const originalAppEnv = process.env.APP_ENV;
const originalManagerUrl = process.env.MANAGER_URL;
const originalManagerHost = process.env.MANAGER_HOST;
const originalBootstrapExtra = process.env.BOOTSTRAP_EXTRA_HOSTS;

test.after(() => {
  if (originalAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnv;
  if (originalManagerUrl === undefined) delete process.env.MANAGER_URL;
  else process.env.MANAGER_URL = originalManagerUrl;
  if (originalManagerHost === undefined) delete process.env.MANAGER_HOST;
  else process.env.MANAGER_HOST = originalManagerHost;
  if (originalBootstrapExtra === undefined) delete process.env.BOOTSTRAP_EXTRA_HOSTS;
  else process.env.BOOTSTRAP_EXTRA_HOSTS = originalBootstrapExtra;
});

test("parseBootstrapExtraHosts accepts IPv4 and hostnames", () => {
  assert.deepEqual(parseBootstrapExtraHosts(undefined), []);
  assert.deepEqual(parseBootstrapExtraHosts(""), []);
  assert.deepEqual(parseBootstrapExtraHosts("203.0.113.10"), ["203.0.113.10"]);
  assert.deepEqual(
    parseBootstrapExtraHosts("203.0.113.10, 10.0.0.5 panel.lan"),
    ["203.0.113.10", "10.0.0.5", "panel.lan"],
  );
  assert.deepEqual(parseBootstrapExtraHosts("127.0.0.1, localhost, 203.0.113.10"), ["203.0.113.10"]);
  assert.throws(() => parseBootstrapExtraHosts("not a host!!"), /invalid/);
  assert.throws(() => parseBootstrapExtraHosts("999.1.1.1"), /invalid/);
});

test("getBootstrapHosts merges fixed loopback with BOOTSTRAP_EXTRA_HOSTS", () => {
  delete process.env.BOOTSTRAP_EXTRA_HOSTS;
  assert.deepEqual(getBootstrapHosts(), ["127.0.0.1", "localhost"]);
  process.env.BOOTSTRAP_EXTRA_HOSTS = "203.0.113.10";
  assert.deepEqual(getBootstrapHosts(), ["127.0.0.1", "localhost", "203.0.113.10"]);
  assert.ok(bootstrapOrigins([80, 8080]).includes("http://203.0.113.10"));
  assert.ok(bootstrapOrigins([80, 8080]).includes("http://203.0.113.10:8080"));
});

test("manager URL is optional for greenfield production", () => {
  process.env.APP_ENV = "production";
  delete process.env.MANAGER_URL;
  delete process.env.MANAGER_HOST;
  delete process.env.MANAGER_TLS_CERT_FILE;
  delete process.env.MANAGER_TLS_KEY_FILE;
  assert.equal(managerUrl(), undefined);
  assert.doesNotThrow(() => validateRuntimeEnv());
  process.env.MANAGER_URL = "https://";
  assert.throws(() => managerUrl(), /valid HTTP or HTTPS URL/);
  process.env.MANAGER_URL = "https://manager.example.com";
  const parsed = managerUrl();
  assert.equal(parsed?.origin, "https://manager.example.com");
  assert.equal(managerUrl(), parsed);
});

test("development may omit the manager URL", () => {
  process.env.APP_ENV = "development";
  delete process.env.MANAGER_URL;
  assert.equal(managerUrl(), undefined);
});

test("mismatched MANAGER_URL and MANAGER_HOST are rejected", () => {
  process.env.APP_ENV = "production";
  process.env.MANAGER_URL = "https://manager.example.com";
  process.env.MANAGER_HOST = "other.example.com";
  delete process.env.MANAGER_TLS_CERT_FILE;
  delete process.env.MANAGER_TLS_KEY_FILE;
  assert.throws(() => validateRuntimeEnv(), /match MANAGER_HOST/);
});
