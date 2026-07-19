import assert from "node:assert/strict";
import test from "node:test";
import { managerUrl, validateRuntimeEnv } from "./runtime-env";

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

test("production requires a syntactically valid manager URL", () => {
  process.env.APP_ENV = "production";
  delete process.env.MANAGER_URL;
  assert.throws(() => managerUrl(), /MANAGER_URL must be set/);
  process.env.MANAGER_URL = "https://";
  assert.throws(() => managerUrl(), /valid HTTP or HTTPS URL/);
  process.env.MANAGER_URL = "https://manager.example.com";
  const parsed = managerUrl();
  assert.equal(parsed?.origin, "https://manager.example.com");
  assert.equal(managerUrl(), parsed);
  delete process.env.MANAGER_HOST;
  assert.throws(() => validateRuntimeEnv(), /MANAGER_HOST/);
});

test("development may omit the manager URL", () => {
  process.env.APP_ENV = "development";
  delete process.env.MANAGER_URL;
  assert.equal(managerUrl(), undefined);
});
