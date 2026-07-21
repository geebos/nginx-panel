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
      .max(253, "errors:validation.hostnameMax")
      .regex(hostnamePattern, "errors:validation.hostnamePattern"),
  );

const routePathSchema = z
  .string()
  .trim()
  .min(1, "errors:validation.routePathRequired")
  .startsWith("/", "errors:validation.routePathStart")
  .refine((value) => !value.includes("\n") && !value.includes("\r"), "errors:validation.routePathNewline");

const httpUrlSchema = z
  .url("errors:validation.urlInvalid")
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "errors:validation.urlScheme");

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
    .startsWith("/", "errors:validation.staticRootAbsolute")
    .refine((value) => !value.includes("\0") && !value.includes(".."), "errors:validation.staticRootInvalid"),
  index: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, "errors:validation.indexFileFormat")
    .refine((value) => value !== "." && value !== "..", "errors:validation.indexFileDot"),
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
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "errors:validation.headerNameFormat"),
  value: z
    .string()
    .max(4096)
    .refine((value) => !/[\r\n\0]/.test(value), "errors:validation.headerValueNewline"),
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
  if (/[{}\0]/.test(trimmed)) throw new Error("errors:validation.advancedBlock");

  return trimmed.split(/\r?\n/).flatMap((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return [];
    const match = line.match(/^([a-z_]+)\s+([^;#]+);$/);
    if (!match || !advancedDirectiveNameSet.has(match[1])) {
      const err = new Error("errors:validation.advancedLineInvalid") as Error & {
        params?: Record<string, string | number>;
      };
      err.params = { n: index + 1 };
      throw err;
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
      const err = error as Error & { params?: Record<string, string | number> };
      ctx.addIssue({
        code: "custom",
        message: err instanceof Error ? err.message : "errors:validation.advancedSnippetInvalid",
        params: err?.params,
      });
    }
  });

export const sslConfigSchema = z.object({
  enabled: z.boolean(),
  certificateId: z.string().optional(),
  provider: z.literal("letsencrypt"),
  environment: z.enum(["staging", "production"]),
  email: z.email("errors:validation.sslEmail").or(z.literal("")),
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

/** Badge / list status for domain SSL config: bound cert → active, enabled without cert → pending. */
export type SslConfigStatus = "active" | "pending" | "disabled";

export function sslConfigStatus(ssl: {
  certificateId?: string | null;
  enabled: boolean;
}): SslConfigStatus {
  return ssl.certificateId ? "active" : ssl.enabled ? "pending" : "disabled";
}

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
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "errors:validation.aliasesDuplicate" });
    }

    const paths = value.routes.map((route) => route.path);
    if (new Set(paths).size !== paths.length) {
      ctx.addIssue({ code: "custom", path: ["routes"], message: "errors:validation.routesDuplicate" });
    }

    const routeIds = new Set(value.routes.map((route) => route.id));
    value.headers.forEach((header, index) => {
      if (header.scope.type === "route" && !routeIds.has(header.scope.routeId)) {
        ctx.addIssue({ code: "custom", path: ["headers", index, "scope"], message: "errors:validation.headerRouteMissing" });
      }
      if (header.name.toLowerCase() === "strict-transport-security" && !value.ssl.enabled) {
        ctx.addIssue({ code: "custom", path: ["headers", index, "name"], message: "errors:validation.hstsRequiresHttps" });
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

export const domainTypeSchema = z.enum(["domain", "manager"]);

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("domain"),
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

export type DomainType = z.infer<typeof domainTypeSchema>;
export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type RouteConfig = z.infer<typeof routeConfigSchema>;
export type HeaderConfig = z.infer<typeof headerConfigSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type DomainListQuery = z.infer<typeof domainListQuerySchema>;
export type Domain = typeof domains.$inferSelect;
export type DomainAlias = typeof domainAliases.$inferSelect;
