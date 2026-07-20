import assert from "node:assert/strict";
import test from "node:test";
import type { DomainConfig } from "@/shared/schemas";
import { diffDomainConfigs } from "@/worker/lib/domain/diff";

const base: DomainConfig = {
  schemaVersion: 1,
  primaryHostname: "example.com",
  aliases: [],
  routes: [],
  headers: [],
  ssl: { enabled: false, provider: "letsencrypt", environment: "production", email: "", autoRenew: true, forceHttps: true, validation: { method: "http-01" } },
  advanced: { serverSnippet: "" },
};

test("semantic diff reports route additions and disabled state changes", () => {
  const route = {
    id: "route-1",
    type: "redirect" as const,
    path: "/old",
    target: "https://example.com/new",
    statusCode: 301 as const,
    enabled: true,
    order: 0,
  };
  const added = diffDomainConfigs(base, { ...base, routes: [route] });
  assert.deepEqual(added.map((change) => [change.section, change.kind, change.label]), [["routes", "added", "/old"]]);
  const disabled = diffDomainConfigs({ ...base, routes: [route] }, { ...base, routes: [{ ...route, enabled: false }] });
  assert.equal(disabled[0]?.kind, "changed");
  assert.match(disabled[0]?.after ?? "", /"enabled":false/);
});
