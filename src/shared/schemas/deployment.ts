import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { configVersions } from "@/shared/schemas/config-version";
import { domains } from "@/shared/schemas/domain";
import { users } from "@/shared/schemas/auth";

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id").references(() => domains.id, { onDelete: "restrict" }),
    configVersionId: text("config_version_id").references(() => configVersions.id, {
      onDelete: "restrict",
    }),
    type: text("type").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    previousVersionId: text("previous_version_id"),
    inputJson: text("input_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("deployments_status_created_idx").on(table.status, table.createdAt),
    index("deployments_domain_created_idx").on(table.domainId, table.createdAt),
  ],
);

export const deploymentSteps = sqliteTable(
  "deployment_steps",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    message: text("message"),
    logExcerpt: text("log_excerpt"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (table) => [index("deployment_steps_deployment_sequence_idx").on(table.deploymentId, table.sequence)],
);

export type Deployment = typeof deployments.$inferSelect;
export type DeploymentStep = typeof deploymentSteps.$inferSelect;
