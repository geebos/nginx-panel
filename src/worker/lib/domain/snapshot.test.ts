import assert from "node:assert/strict";
import test from "node:test";
import type { DomainConfig } from "@/shared/schemas";
import { parseDomainSnapshot } from "@/worker/lib/domain/snapshot";

const base: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: [],
  routes: [],
  headers: [],
  ssl: {
    enabled: false,
    provider: "letsencrypt",
    environment: "production",
    email: "",
    autoRenew: true,
    forceHttps: true,
    validation: { method: "http-01" },
  },
  advanced: { serverSnippet: "" },
};

test("parseDomainSnapshot returns a DomainConfig for valid snapshot JSON", () => {
  const parsed = parseDomainSnapshot(JSON.stringify(base));
  assert.equal(parsed.primaryHostname, "example.com");
  assert.equal(parsed.ssl.autoRenew, true);
  assert.deepEqual(parsed.aliases, []);
});

test("parseDomainSnapshot throws on invalid JSON", () => {
  assert.throws(() => parseDomainSnapshot("{not-json"), SyntaxError);
});

test("parseDomainSnapshot throws on schema-invalid JSON", () => {
  assert.throws(() => parseDomainSnapshot(JSON.stringify({ schemaVersion: 1 })));
});
