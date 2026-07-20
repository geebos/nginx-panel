import assert from "node:assert/strict";
import test from "node:test";
import { managerUrl, validateRuntimeEnv } from "@/worker/lib/runtime/env";

const originalAppEnv = process.env.APP_ENV;
const originalManagerUrl = process.env.MANAGER_URL;
const originalManagerHost = process.env.MANAGER_HOST;

test.after(() => {
  if (originalAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnv;
  if (originalManagerUrl === undefined) delete process.env.MANAGER_URL;
  else process.env.MANAGER_URL = originalManagerUrl;
  if (originalManagerHost === undefined) delete process.env.MANAGER_HOST;
  else process.env.MANAGER_HOST = originalManagerHost;
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
