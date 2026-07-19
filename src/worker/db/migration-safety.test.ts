import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { assertNoDuplicateDrafts } from "./migration-safety";

test("migration safety allows a fresh database without config_versions", () => {
  const connection = new Database(":memory:");
  assert.doesNotThrow(() => assertNoDuplicateDrafts(connection));
  connection.close();
});

test("migration safety reports Domain IDs with duplicate Drafts", () => {
  const connection = new Database(":memory:");
  connection.exec(`
    CREATE TABLE config_versions (
      id TEXT PRIMARY KEY NOT NULL,
      domain_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO config_versions (id, domain_id, status) VALUES
      ('version-1', 'domain-b', 'draft'),
      ('version-2', 'domain-b', 'draft'),
      ('version-3', 'domain-a', 'draft'),
      ('version-4', 'domain-a', 'active'),
      ('version-5', 'domain-c', 'draft');
  `);

  assert.throws(
    () => assertNoDuplicateDrafts(connection),
    /domain-b \(2 Drafts\)/,
  );
  connection.close();
});
