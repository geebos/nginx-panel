import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { domains } from "./domain";
import { users } from "./auth";
import { z } from "zod";
import { domainConfigSchema } from "./domain";

export const configVersions = sqliteTable(
  "config_versions",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull(),
    sourceVersionId: text("source_version_id"),
    sourceCertificateId: text("source_certificate_id"),
    changeSummary: text("change_summary").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    snapshotChecksum: text("snapshot_checksum").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("config_versions_domain_version_unique").on(
      table.domainId,
      table.versionNumber,
    ),
    uniqueIndex("config_versions_source_certificate_unique").on(
      table.sourceCertificateId,
    ),
    uniqueIndex("config_versions_one_draft_per_domain")
      .on(table.domainId)
      .where(sql`${table.status} = 'draft'`),
  ],
);

export type ConfigVersion = typeof configVersions.$inferSelect;

export const createConfigVersionSchema = z.object({
  config: domainConfigSchema,
  changeSummary: z.string().trim().min(1).max(240).default("更新域名配置"),
});

export const versionDiffQuerySchema = z.object({
  base: z.string().min(1),
});

export const testVersionInputSchema = z.object({
  expectedSnapshotChecksum: z.string().min(1),
});

export const deployVersionInputSchema = testVersionInputSchema.extend({
  preflightDeploymentId: z.string().min(1),
});
