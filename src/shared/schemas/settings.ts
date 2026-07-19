import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const accessLogFieldSchema = z.enum([
  "timestamp",
  "domain",
  "method",
  "path",
  "request_uri",
  "status",
  "request_time",
  "client_ip",
  "upstream_addr",
  "upstream_status",
  "upstream_time",
]);

export const requiredAccessLogFields = [
  "timestamp",
  "domain",
  "method",
  "path",
  "request_uri",
  "status",
] as const;

export const nginxLogSettingsInputSchema = z.object({
  accessFields: z.array(accessLogFieldSchema).min(requiredAccessLogFields.length).max(11).superRefine((fields, ctx) => {
    if (new Set(fields).size !== fields.length) ctx.addIssue({ code: "custom", message: "日志字段不能重复" });
    for (const field of requiredAccessLogFields) {
      if (!fields.includes(field)) ctx.addIssue({ code: "custom", message: `日志字段 ${field} 不能移除` });
    }
  }),
  errorLevel: z.enum(["error", "warn", "notice", "info"]),
  maxFileSizeMiB: z.number().int().min(1).max(1024),
  retainedFiles: z.number().int().min(1).max(30),
});

export const nginxLogSettingsSchema = nginxLogSettingsInputSchema.extend({
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const rebuildActiveSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
});

export const sessionPolicySchema = z.object({
  standardDays: z.number().int().min(1).max(7),
  rememberDays: z.number().int().min(7).max(90),
});

export const runtimeStorageSettingsSchema = z.object({
  revisionMaxBytes: z.number().int().min(512 * 1024 * 1024).max(20 * 1024 * 1024 * 1024),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AccessLogField = z.infer<typeof accessLogFieldSchema>;
export type NginxLogSettingsInput = z.infer<typeof nginxLogSettingsInputSchema>;
export type NginxLogSettings = z.infer<typeof nginxLogSettingsSchema>;
export type RebuildActiveInput = z.infer<typeof rebuildActiveSchema>;
export type SessionPolicy = z.infer<typeof sessionPolicySchema>;
export type RuntimeStorageSettings = z.infer<typeof runtimeStorageSettingsSchema>;
