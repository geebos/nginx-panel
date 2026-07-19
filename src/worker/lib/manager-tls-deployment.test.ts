import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/shared/schemas";
import { createReloadManagerTlsDeployment } from "./deployment-runner";

test("manager TLS reload creates one auditable idempotent deployment", async () => {
  const connection = new Database(":memory:");
  connection.pragma("foreign_keys = ON");
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const now = Date.now();
  db.insert(schema.users).values({ id: "user-1", username: "admin", passwordHash: "unused", createdAt: now, updatedAt: now }).run();

  const first = await createReloadManagerTlsDeployment(db, { requestedBy: "user-1", idempotencyKey: "reload-manager-tls-1" });
  const repeated = await createReloadManagerTlsDeployment(db, { requestedBy: "user-1", idempotencyKey: "reload-manager-tls-1" });
  assert.equal(first.id, repeated.id);
  assert.equal(first.type, "reload_manager_tls");
  assert.equal(first.status, "queued");
  assert.equal(db.select().from(schema.deployments).all().length, 1);
  assert.deepEqual(
    db.select().from(schema.deploymentSteps).all().map((step) => step.name),
    ["Validate mounted certificate", "Run active nginx -t", "Reload Nginx", "Verify manager HTTPS", "Finalize"],
  );
  connection.close();
});
