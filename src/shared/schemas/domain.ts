import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\.$/, ""))
  .pipe(
    z
      .string()
      .max(253, "域名不能超过 253 个字符")
      .regex(hostnamePattern, "请输入标准 ASCII 或 Punycode 域名"),
  );

const routePathSchema = z
  .string()
  .trim()
  .min(1, "请输入路由路径")
  .startsWith("/", "路由路径必须以 / 开头")
  .refine((value) => !value.includes("\n") && !value.includes("\r"), "路由路径不能包含换行");

const httpUrlSchema = z
  .url("请输入完整的 HTTP 或 HTTPS URL")
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "URL 只允许 HTTP/HTTPS，且不能包含凭据");

const routeBaseSchema = z.object({
  id: z.string().min(1),
  path: routePathSchema,
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
});

export const proxyRouteSchema = routeBaseSchema.extend({
  type: z.literal("proxy"),
  target: httpUrlSchema,
  websocket: z.boolean(),
  preserveHost: z.boolean(),
  connectTimeoutSeconds: z.number().int().min(1).max(3600),
  readTimeoutSeconds: z.number().int().min(1).max(3600),
  sendTimeoutSeconds: z.number().int().min(1).max(3600),
});

export const staticRouteSchema = routeBaseSchema.extend({
  type: z.literal("static"),
  root: z
    .string()
    .trim()
    .startsWith("/", "静态目录必须是绝对路径")
    .refine((value) => !value.includes("\0") && !value.includes(".."), "静态目录格式无效"),
  index: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, "首页文件名格式无效")
    .refine((value) => value !== "." && value !== "..", "首页文件名不能是 . 或 .."),
  spaFallback: z.boolean(),
});

export const redirectRouteSchema = routeBaseSchema.extend({
  type: z.literal("redirect"),
  target: httpUrlSchema,
  statusCode: z.union([z.literal(301), z.literal(302)]),
});

export const routeConfigSchema = z.discriminatedUnion("type", [
  proxyRouteSchema,
  staticRouteSchema,
  redirectRouteSchema,
]);

export const headerConfigSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Header 名称格式无效"),
  value: z
    .string()
    .max(4096)
    .refine((value) => !/[\r\n\0]/.test(value), "Header 值不能包含换行或 NUL"),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("server") }),
    z.object({ type: z.literal("route"), routeId: z.string().min(1) }),
  ]),
  always: z.boolean(),
  enabled: z.boolean(),
});

export const advancedDirectiveNames = [
  "client_max_body_size",
  "proxy_buffering",
  "proxy_buffers",
  "keepalive_timeout",
  "gzip",
  "gzip_types",
] as const;

const advancedDirectiveNameSet = new Set<string>(advancedDirectiveNames);

export function parseAdvancedSnippet(snippet: string) {
  const trimmed = snippet.trim();
  if (!trimmed) return [];
  if (/[{}\0]/.test(trimmed)) throw new Error("高级配置不允许 block 或 NUL");

  return trimmed.split(/\r?\n/).flatMap((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return [];
    const match = line.match(/^([a-z_]+)\s+([^;#]+);$/);
    if (!match || !advancedDirectiveNameSet.has(match[1])) {
      throw new Error(`高级配置第 ${index + 1} 行不是允许的指令`);
    }
    return `${match[1]} ${match[2].trim()};`;
  });
}

export const advancedSnippetSchema = z
  .string()
  .max(16_384)
  .superRefine((value, ctx) => {
    try {
      parseAdvancedSnippet(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "高级配置格式无效",
      });
    }
  });

export const sslConfigSchema = z.object({
  enabled: z.boolean(),
  certificateId: z.string().optional(),
  provider: z.literal("letsencrypt"),
  environment: z.enum(["staging", "production"]),
  email: z.email("请输入有效邮箱").or(z.literal("")),
  autoRenew: z.boolean(),
  forceHttps: z.boolean(),
  validation: z.union([
    z.object({ method: z.literal("http-01") }),
    z.object({ method: z.literal("dns-01"), provider: z.literal("manual") }),
    z.object({
      method: z.literal("dns-01"),
      provider: z.literal("cloudflare"),
      cloudflareCredentialId: z.string().min(1),
    }),
  ]),
});

export const domainConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    primaryHostname: hostnameSchema,
    aliases: z.array(hostnameSchema).max(100),
    routes: z.array(routeConfigSchema).max(50),
    headers: z.array(headerConfigSchema).max(100),
    ssl: sslConfigSchema,
    advanced: z.object({ serverSnippet: advancedSnippetSchema }),
  })
  .superRefine((value, ctx) => {
    const hostnames = [value.primaryHostname, ...value.aliases];
    if (new Set(hostnames).size !== hostnames.length) {
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "主域名和别名不能重复" });
    }

    const paths = value.routes.map((route) => route.path);
    if (new Set(paths).size !== paths.length) {
      ctx.addIssue({ code: "custom", path: ["routes"], message: "同一域名中的路由路径不能重复" });
    }

    const routeIds = new Set(value.routes.map((route) => route.id));
    value.headers.forEach((header, index) => {
      if (header.scope.type === "route" && !routeIds.has(header.scope.routeId)) {
        ctx.addIssue({ code: "custom", path: ["headers", index, "scope"], message: "Header 引用的路由不存在" });
      }
      if (header.name.toLowerCase() === "strict-transport-security" && !value.ssl.enabled) {
        ctx.addIssue({ code: "custom", path: ["headers", index, "name"], message: "启用 HTTPS 后才能添加 HSTS" });
      }
    });
  });

export const createDomainSchema = z.object({
  config: domainConfigSchema,
});

export const domainListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(253).default(""),
  status: z.enum(["all", "running", "failed", "disabled", "unknown"]).default("all"),
  sort: z.enum(["updated_desc", "created_desc", "hostname_asc"]).default("updated_desc"),
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  primaryHostname: text("primary_hostname").notNull().unique(),
  displayHostname: text("display_hostname").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  runtimeStatus: text("runtime_status").notNull().default("unknown"),
  activeVersionId: text("active_version_id"),
  draftVersionId: text("draft_version_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const domainAliases = sqliteTable("domain_aliases", {
  id: text("id").primaryKey(),
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  displayHostname: text("display_hostname").notNull(),
});

export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type RouteConfig = z.infer<typeof routeConfigSchema>;
export type HeaderConfig = z.infer<typeof headerConfigSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type DomainListQuery = z.infer<typeof domainListQuerySchema>;
export type Domain = typeof domains.$inferSelect;
export type DomainAlias = typeof domainAliases.$inferSelect;
