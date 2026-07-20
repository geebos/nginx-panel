import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { configVersions } from "./config-version";
import { deployments } from "./deployment";
import { domains } from "./domain";

export const cloudflareCredentials = sqliteTable("cloudflare_credentials", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  tokenCiphertext: blob("token_ciphertext").notNull(),
  tokenIv: blob("token_iv").notNull(),
  tokenAuthTag: blob("token_auth_tag").notNull(),
  tokenLast4: text("token_last4").notNull(),
  cloudflareTokenId: text("cloudflare_token_id"),
  status: text("status").notNull(),
  expiresAt: integer("expires_at"),
  visibleZoneCount: integer("visible_zone_count"),
  lastVerifiedAt: integer("last_verified_at"),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const acmeOrders = sqliteTable(
  "acme_orders",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "restrict" }),
    replacesCertificateId: text("replaces_certificate_id"),
    validationMethod: text("validation_method").notNull(),
    dnsProvider: text("dns_provider"),
    cloudflareCredentialId: text("cloudflare_credential_id").references(() => cloudflareCredentials.id, { onDelete: "set null" }),
    cloudflareCredentialName: text("cloudflare_credential_name"),
    accountEmail: text("account_email").notNull(),
    environment: text("environment").notNull(),
    status: text("status").notNull(),
    orderUrl: text("order_url"),
    identifiersJson: text("identifiers_json").notNull(),
    unpublishedBaseVersionId: text("unpublished_base_version_id").references(() => configVersions.id, { onDelete: "restrict" }),
    cleanupStatus: text("cleanup_status").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    nextPollAt: integer("next_poll_at"),
    lastPolledAt: integer("last_polled_at"),
    expiresAt: integer("expires_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("acme_orders_status_poll_idx").on(table.status, table.nextPollAt)],
);

export const certificates = sqliteTable(
  "certificates",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "restrict" }),
    acmeOrderId: text("acme_order_id").notNull().unique().references(() => acmeOrders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    status: text("status").notNull(),
    sansJson: text("sans_json").notNull(),
    certPath: text("cert_path").notNull(),
    keyPath: text("key_path").notNull(),
    certFileChecksum: text("cert_file_checksum").notNull(),
    publicKeySpkiChecksum: text("public_key_spki_checksum").notNull(),
    notBefore: integer("not_before"),
    notAfter: integer("not_after"),
    autoRenew: integer("auto_renew", { mode: "boolean" }).notNull(),
    lastValidationMethod: text("last_validation_method"),
    lastDnsProvider: text("last_dns_provider"),
    cloudflareCredentialId: text("cloudflare_credential_id").references(() => cloudflareCredentials.id, { onDelete: "set null" }),
    lastErrorCode: text("last_error_code"),
    issuedAt: integer("issued_at"),
    activatedAt: integer("activated_at"),
    nextCheckAt: integer("next_check_at"),
  },
  (table) => [
    index("certificates_domain_status_idx").on(table.domainId, table.status),
    index("certificates_status_expiry_idx").on(table.status, table.notAfter),
  ],
);

export const acmeChallenges = sqliteTable(
  "acme_challenges",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => acmeOrders.id, { onDelete: "cascade" }),
    domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "restrict" }),
    hostname: text("hostname").notNull(),
    type: text("type").notNull(),
    token: text("token"),
    keyAuthorization: text("key_authorization"),
    dnsRecordName: text("dns_record_name"),
    dnsRecordValue: text("dns_record_value"),
    cloudflareZoneId: text("cloudflare_zone_id"),
    cloudflareRecordId: text("cloudflare_record_id"),
    status: text("status").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    cleanedAt: integer("cleaned_at"),
  },
  (table) => [
    uniqueIndex("acme_challenges_order_hostname_unique").on(table.orderId, table.hostname),
    index("acme_challenges_http_lookup_idx").on(table.domainId, table.hostname, table.type, table.expiresAt),
  ],
);

export const certificateActivations = sqliteTable("certificate_activations", {
  id: text("id").primaryKey(),
  certificateId: text("certificate_id").notNull().unique().references(() => certificates.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  configVersionId: text("config_version_id").references(() => configVersions.id, { onDelete: "restrict" }),
  deploymentId: text("deployment_id").references(() => deployments.id, { onDelete: "restrict" }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  nextAttemptAt: integer("next_attempt_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const createCertificateOrderSchema = z.object({
  accountEmail: z.email("errors:validation.sslEmail").transform((value) => value.trim().toLowerCase()),
  environment: z.enum(["staging", "production"]),
  validation: z.union([
    z.object({ method: z.literal("http-01") }),
    z.object({ method: z.literal("dns-01"), provider: z.literal("manual") }),
    z.object({ method: z.literal("dns-01"), provider: z.literal("cloudflare"), cloudflareCredentialId: z.string().min(1) }),
  ]),
});

export const cloudflareCredentialInputSchema = z.object({
  name: z.string().trim().min(1, "errors:validation.credentialNameRequired").max(64, "errors:validation.credentialNameMax"),
  token: z.string().trim().min(20, "errors:validation.credentialTokenMin").max(512, "errors:validation.credentialTokenMax"),
});

export const replaceCloudflareCredentialTokenSchema = cloudflareCredentialInputSchema.pick({ token: true });

export type Certificate = typeof certificates.$inferSelect;
export type AcmeOrder = typeof acmeOrders.$inferSelect;
export type AcmeChallenge = typeof acmeChallenges.$inferSelect;
export type CertificateActivation = typeof certificateActivations.$inferSelect;
