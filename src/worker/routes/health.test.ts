import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "@/worker/types";
import { resetServiceLifecycleForTests, startJobRunnerHeartbeat } from "@/worker/lib/service-lifecycle";
import { setRuntimeState } from "@/worker/lib/runtime-state";
import { createHealthRoutes } from "./health";

function requestBindings(remoteAddress: string): AppEnv["Bindings"] {
  return { incoming: { socket: { remoteAddress } } as unknown as IncomingMessage };
}

function healthyDatabase() {
  return {
    all: async () => [{ ok: 1 }],
    query: { deployments: { findFirst: async () => undefined } },
  } as unknown as AppEnv["Variables"]["db"];
}

test("internal health requires loopback socket, fixed Host, and the Nginx marker header", async (t) => {
  resetServiceLifecycleForTests();
  t.after(resetServiceLifecycleForTests);
  const stopHeartbeat = startJobRunnerHeartbeat();
  t.after(stopHeartbeat);
  const db = healthyDatabase();
  setRuntimeState({ status: "healthy", checkedAt: Date.now(), activeRevision: null, issues: [] });
  const routes = createHealthRoutes({ verify: async () => ({ status: "healthy", checkedAt: Date.now(), activeRevision: null, issues: [] }) });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/", routes.internal);
  app.route("/api", routes.public);

  assert.equal((await app.request("/internal/health", { headers: { host: "127.0.0.1", "x-internal-health-check": "1" } }, requestBindings("192.0.2.1"))).status, 404);
  assert.equal((await app.request("/internal/health", { headers: { host: "manager.example.com", "x-internal-health-check": "1" } }, requestBindings("127.0.0.1"))).status, 404);
  assert.equal((await app.request("/internal/health", { headers: { host: "127.0.0.1" } }, requestBindings("127.0.0.1"))).status, 404);

  const internal = await app.request("/internal/health", { headers: { host: "127.0.0.1", "x-internal-health-check": "1" } }, requestBindings("::ffff:127.0.0.1"));
  assert.equal(internal.status, 200);
  assert.equal((await internal.json() as { ok: boolean }).ok, true);
  assert.equal((await app.request("/api/health")).status, 200);
});

test("health returns 503 when the runner heartbeat is stale", async (t) => {
  resetServiceLifecycleForTests();
  t.after(resetServiceLifecycleForTests);
  const db = healthyDatabase();
  const routes = createHealthRoutes({ now: () => 60_000, verify: async () => ({ status: "healthy", checkedAt: 60_000, activeRevision: null, issues: [] }) });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/api", routes.public);

  const response = await app.request("/api/health");
  assert.equal(response.status, 503);
  const body = await response.json() as { ok: boolean; jobRunner: { status: string } };
  assert.equal(body.ok, false);
  assert.equal(body.jobRunner.status, "stale");
});
