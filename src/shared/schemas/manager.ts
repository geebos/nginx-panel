import { z } from "zod";
import { hostnameSchema, sslConfigSchema } from "@/shared/schemas/domain";

/** Bootstrap local entry hosts — runtime constants, never stored in version snapshots. */
export const BOOTSTRAP_HOSTS = ["127.0.0.1", "localhost"] as const;

/** Placeholder primary hostname when manager is Reset / unbound. Never enters nginx server_name. */
export const MANAGER_PLACEHOLDER_HOSTNAME = "local.manager.invalid";

export const managerDnsValidationSchema = z.union([
  z.object({ method: z.literal("dns-01"), provider: z.literal("manual") }),
  z.object({
    method: z.literal("dns-01"),
    provider: z.literal("cloudflare"),
    cloudflareCredentialId: z.string().min(1),
  }),
]);

export const managerSslConfigSchema = sslConfigSchema
  .omit({ validation: true })
  .extend({
    validation: managerDnsValidationSchema,
  })
  .superRefine((value, ctx) => {
    if (value.enabled) {
      if (!value.email || !z.email().safeParse(value.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "errors:validation.sslEmail" });
      }
    }
  });

const managerPrimaryHostnameSchema = z.union([
  hostnameSchema,
  z.literal(MANAGER_PLACEHOLDER_HOSTNAME),
]);

export const managerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    bound: z.boolean(),
    primaryHostname: managerPrimaryHostnameSchema,
    aliases: z.array(hostnameSchema).max(100),
    routes: z.array(z.unknown()).max(0).default([]),
    headers: z.array(z.unknown()).max(0).default([]),
    ssl: managerSslConfigSchema,
    advanced: z.object({ serverSnippet: z.string().max(0) }).default({ serverSnippet: "" }),
  })
  .superRefine((value, ctx) => {
    if (value.bound) {
      if (value.primaryHostname === MANAGER_PLACEHOLDER_HOSTNAME) {
        ctx.addIssue({
          code: "custom",
          path: ["primaryHostname"],
          message: "errors:validation.managerPlaceholderForbidden",
        });
      }
      try {
        hostnameSchema.parse(value.primaryHostname);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["primaryHostname"],
          message: "errors:validation.hostnamePattern",
        });
      }
    } else if (value.primaryHostname !== MANAGER_PLACEHOLDER_HOSTNAME) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryHostname"],
        message: "errors:validation.managerUnboundPlaceholder",
      });
    }

    if (value.aliases.includes(MANAGER_PLACEHOLDER_HOSTNAME as never)) {
      ctx.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "errors:validation.managerPlaceholderForbidden",
      });
    }

    const hostnames = [value.primaryHostname, ...value.aliases];
    if (new Set(hostnames).size !== hostnames.length) {
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "errors:validation.aliasesDuplicate" });
    }

    for (const host of BOOTSTRAP_HOSTS) {
      if (hostnames.includes(host)) {
        ctx.addIssue({
          code: "custom",
          path: ["primaryHostname"],
          message: "errors:validation.bootstrapHostnameReserved",
        });
      }
    }
  });

export type ManagerConfig = z.infer<typeof managerConfigSchema>;

export function defaultManagerSsl(): ManagerConfig["ssl"] {
  return {
    enabled: false,
    provider: "letsencrypt",
    environment: "production",
    email: "",
    autoRenew: true,
    forceHttps: true,
    validation: { method: "dns-01", provider: "manual" },
  };
}

/**
 * Build a bound manager config.
 * Pass `baseSsl` (from draft/active snapshot) so partial UI updates keep certificateId / enabled.
 */
export function buildBoundManagerConfig(input: {
  primaryHostname: string;
  aliases?: string[];
  ssl?: Partial<ManagerConfig["ssl"]>;
  baseSsl?: ManagerConfig["ssl"];
}): ManagerConfig {
  const base = input.baseSsl ?? defaultManagerSsl();
  const patch = input.ssl ?? {};
  return managerConfigSchema.parse({
    schemaVersion: 1,
    bound: true,
    primaryHostname: input.primaryHostname,
    aliases: input.aliases ?? [],
    routes: [],
    headers: [],
    ssl: {
      ...base,
      ...patch,
      // Keep nested validation object from base unless explicitly replaced.
      validation: patch.validation ?? base.validation,
      // certificateId is system-managed; never invent, only preserve or clear via explicit patch.
      certificateId: "certificateId" in patch ? patch.certificateId : base.certificateId,
      provider: "letsencrypt" as const,
    },
    advanced: { serverSnippet: "" },
  });
}

export function buildUnboundManagerConfig(): ManagerConfig {
  return managerConfigSchema.parse({
    schemaVersion: 1,
    bound: false,
    primaryHostname: MANAGER_PLACEHOLDER_HOSTNAME,
    aliases: [],
    routes: [],
    headers: [],
    ssl: defaultManagerSsl(),
    advanced: { serverSnippet: "" },
  });
}

export function managerUserHostnames(snapshot: Pick<ManagerConfig, "bound" | "primaryHostname" | "aliases">) {
  if (!snapshot.bound) return [] as string[];
  return [snapshot.primaryHostname, ...snapshot.aliases];
}

export const updateManagerSettingsSchema = z.object({
  primaryHostname: hostnameSchema,
  aliases: z.array(hostnameSchema).max(100).default([]),
  ssl: z
    .object({
      enabled: z.boolean().optional(),
      email: z.string().optional(),
      autoRenew: z.boolean().optional(),
      forceHttps: z.boolean().optional(),
      environment: z.enum(["staging", "production"]).optional(),
      validation: managerDnsValidationSchema.optional(),
    })
    .optional(),
});

export type UpdateManagerSettingsInput = z.infer<typeof updateManagerSettingsSchema>;

export const setupAdminWithManagerSchema = z.object({
  username: z.string(),
  password: z.string(),
  managerPrimaryHostname: hostnameSchema.optional(),
  managerAliases: z.array(hostnameSchema).max(100).optional(),
});
