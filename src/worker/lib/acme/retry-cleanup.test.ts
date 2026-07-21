import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { BusinessError } from "@/worker/lib/errors";
import { retryCloudflareOrderCleanup } from "@/worker/lib/acme/retry-cleanup";

function fixture(input: {
  dnsProvider?: string | null;
  status?: string;
  cleanupStatus?: string;
} = {}) {
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
    dnsProvider: input.dnsProvider ?? "cloudflare",
    accountEmail: "admin@example.com",
    environment: "staging",
    status: input.status ?? "succeeded",
    identifiersJson: JSON.stringify(["example.com"]),
    cleanupStatus: input.cleanupStatus ?? "failed",
    idempotencyKey: "order-1",
    createdAt: now,
    updatedAt: now,
  }).run();
  const order = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get()!;
  return { connection, db, order };
}

test("retryCloudflareOrderCleanup rejects non-cloudflare orders", async () => {
  const { connection, db, order } = fixture({ dnsProvider: "manual" });
  await assert.rejects(
    () => retryCloudflareOrderCleanup(db, order),
    (error: unknown) => error instanceof BusinessError && error.code === "CLOUDFLARE_CLEANUP_NOT_AVAILABLE",
  );
  connection.close();
});

test("retryCloudflareOrderCleanup rejects non-terminal cloudflare orders", async () => {
  const { connection, db, order } = fixture({ status: "waiting_dns" });
  await assert.rejects(
    () => retryCloudflareOrderCleanup(db, order),
    (error: unknown) => error instanceof BusinessError && error.code === "CLOUDFLARE_CLEANUP_NOT_AVAILABLE",
  );
  connection.close();
});

test("retryCloudflareOrderCleanup re-queues then runs cleanup for terminal cloudflare orders", async () => {
  const { connection, db, order } = fixture({ status: "succeeded", cleanupStatus: "failed" });
  const before = Date.now();
  // Missing credential → cleanupCloudflareOrder marks cleanup failed with a message after re-queue.
  const result = await retryCloudflareOrderCleanup(db, order);
  assert.equal(result.order.id, "order-1");
  const row = db.select().from(schema.acmeOrders).where(eq(schema.acmeOrders.id, "order-1")).get();
  assert.equal(row?.cleanupStatus, "failed");
  assert.ok(row?.errorMessage);
  assert.ok((row?.nextPollAt ?? 0) >= before + 60_000 - 1_000);
  connection.close();
});
