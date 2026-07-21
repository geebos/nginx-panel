import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { RECHECK_DEBOUNCE_MS } from "@/worker/lib/acme/order-status";
import { recheckAcmeOrder } from "@/worker/lib/acme/recheck-order";

function fixture(status: string, lastPolledAt: number | null = null, nextPollAt: number | null = null) {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.domains).values({
    id: "domain-1",
    type: "domain",
    primaryHostname: "example.com",
    displayHostname: "example.com",
    enabled: true,
    runtimeStatus: "running",
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(schema.acmeOrders).values({
    id: "order-1",
    domainId: "domain-1",
    validationMethod: "dns-01",
    dnsProvider: "manual",
    accountEmail: "admin@example.com",
    environment: "staging",
    status,
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: "pending",
    idempotencyKey: "order-1",
    nextPollAt,
    lastPolledAt,
    createdAt: now,
    updatedAt: now,
  }).run();
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()!;
  return { connection, db, order, now };
}

test("recheckAcmeOrder returns debounced false without writing for non-recheckable statuses", async () => {
  const future = Date.now() + 60_000;
  const { connection, db, order, now } = fixture("succeeded", null, future);
  const result = await recheckAcmeOrder(db, order);
  assert.equal(result.debounced, false);
  assert.equal(result.order.status, "succeeded");
  const row = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(row?.nextPollAt, future);
  assert.equal(row?.updatedAt, now);
  connection.close();
});

test("recheckAcmeOrder schedules nextPollAt when recheckable and not debounced", async () => {
  const { connection, db, order } = fixture("waiting_dns", null, Date.now() + 60_000);
  const before = Date.now();
  const result = await recheckAcmeOrder(db, order);
  assert.equal(result.debounced, false);
  assert.ok((result.order.nextPollAt ?? 0) >= before - 1_000);
  assert.ok((result.order.nextPollAt ?? 0) <= Date.now() + 1_000);
  connection.close();
});

test("recheckAcmeOrder reports debounce within RECHECK_DEBOUNCE_MS of lastPolledAt", async () => {
  const now = Date.now();
  const { connection, db, order } = fixture("waiting_dns", now - 100, now + 60_000);
  const result = await recheckAcmeOrder(db, order);
  assert.equal(result.debounced, true);
  const row = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(row?.nextPollAt, now + 60_000);
  // sanity: debounce window still positive
  assert.ok(RECHECK_DEBOUNCE_MS > 0);
  connection.close();
});
