import { z } from "zod";

export const logTypeSchema = z.enum(["access", "error"]);
export const logTypesSchema = z.array(logTypeSchema).min(1).max(2);

const legacyLogTypeSchema = z.enum(["access", "error", "all"]);

function normalizeTypes(value: string) {
  return [...new Set(value.split(","))].sort();
}

const logQueryFields = {
  domainId: z.string().min(1),
  types: z.string().optional(),
  type: legacyLogTypeSchema.optional(),
  keyword: z.string().trim().max(256).default(""),
  method: z.string().trim().toUpperCase().max(16).default(""),
  status: z.coerce.number().int().min(100).max(599).optional(),
};

function rejectMixedTypes(value: { types?: string; type?: "access" | "error" | "all" }, ctx: z.core.$RefinementCtx) {
  if (value.types && value.type) {
    ctx.addIssue({ code: "custom", path: ["types"], message: "types 与旧 type 参数不能同时使用" });
  }
  if (value.types && !logTypesSchema.safeParse(normalizeTypes(value.types)).success) {
    ctx.addIssue({ code: "custom", path: ["types"], message: "types 只能包含 access,error 且至少选择一项" });
  }
}

function withNormalizedTypes<T extends { types?: string; type?: "access" | "error" | "all" }>(value: T) {
  const rawTypes = value.types
    ? normalizeTypes(value.types)
    : value.type === "all" || !value.type
      ? ["access", "error"]
      : [value.type];
  const types = logTypesSchema.parse(rawTypes);
  const rest = { ...value };
  delete rest.type;
  return { ...rest, types };
}

export const logQuerySchema = z.object({
  ...logQueryFields,
  limit: z.coerce.number().int().min(1).max(2000).default(200),
}).superRefine(rejectMixedTypes).transform(withNormalizedTypes);

export const logStreamQuerySchema = z.object({
  ...logQueryFields,
  follow: z.literal("true").transform(() => true),
}).superRefine(rejectMixedTypes).transform(withNormalizedTypes);

export const logRotationRequestSchema = z.object({
  domainId: z.string().min(1).optional(),
});

export const logColumnIdSchema = z.enum([
  "timestamp",
  "log_type",
  "domain",
  "method",
  "status",
  "path",
  "request_uri",
  "request_time",
  "client_ip",
  "upstream_addr",
  "upstream_status",
  "upstream_time",
  "level",
  "message",
  "raw",
]);

export const logColumnPreferenceSchema = z.object({
  schemaVersion: z.literal(1),
  columns: z.array(z.object({
    id: logColumnIdSchema,
    visible: z.boolean(),
  })).min(1).refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "日志列不能重复",
  ),
});

export type LogQuery = z.infer<typeof logQuerySchema>;
export type LogStreamQuery = z.infer<typeof logStreamQuerySchema>;
export type LogType = z.infer<typeof logTypeSchema>;
export type LogColumnId = z.infer<typeof logColumnIdSchema>;
export type LogColumnPreference = z.infer<typeof logColumnPreferenceSchema>;

export type LogRecord = {
  id: string;
  domainId: string;
  hostname: string;
  type: "access" | "error";
  timestamp: string | null;
  parsed: boolean;
  raw: string;
  fields: Record<string, string | number | null>;
};

export type LogStreamRecord =
  | {
      type: "entry";
      domainId: string;
      hostname: string;
      logType: "access" | "error";
      cursor: string;
      timestamp: string | null;
      parsed: boolean;
      fields: Record<string, string | number | null>;
      raw: string;
      truncated: boolean;
    }
  | { type: "heartbeat"; at: string; cursor?: string }
  | { type: "rotated"; previousFileId: string; nextFileId: string; cursor: string }
  | { type: "dropped"; count: number; reason: "rate_limit" | "client_backpressure" }
  | { type: "end"; reason: "server_shutdown" | "stream_limit"; cursor?: string }
  | { type: "error"; code: "cursor_expired" | "file_unavailable"; recoverable: boolean };
