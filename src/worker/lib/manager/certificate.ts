import { randomUUID } from "node:crypto";
import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  acmeChallenges,
  acmeOrders,
  certificateActivations,
  certificates,
  cloudflareCredentials,
  configVersions,
  deployments,
  managerConfigSchema,
  managerDnsValidationSchema,
  type ManagerConfig,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { findManagerDomain, parseManagerSnapshot } from "@/worker/lib/manager/service";
import { decryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";
import { getCloudflareDnsProvider } from "@/worker/lib/cloudflare/dns";
import { createRenewalOrder } from "@/worker/lib/acme/renewal";
import { cancelAcmeOrder } from "@/worker/lib/acme/cancel-order";
import { recheckAcmeOrder } from "@/worker/lib/acme/recheck-order";
import { retryCloudflareOrderCleanup } from "@/worker/lib/acme/retry-cleanup";
import { terminalOrderStatuses } from "@/worker/lib/acme/order-status";
import { publicCertificate, publicChallenge, publicOrder } from "@/worker/lib/acme/public";
import { retryAcmeOrderActivation } from "@/worker/lib/acme/retry-activation";
import { createSnapshot } from "@/worker/lib/snapshot";
import { saveDraftVersion } from "@/worker/lib/domain/draft-version";
import { z } from "zod";

type AppDb = AppEnv["Variables"]["db"];

export const createManagerCertificateOrderSchema = z.object({
  accountEmail: z.email("errors:validation.sslEmail").transform((value) => value.trim().toLowerCase()),
  environment: z.enum(["staging", "production"]),
  validation: managerDnsValidationSchema,
});

export type CreateManagerCertificateOrderInput = z.infer<typeof createManagerCertificateOrderSchema>;

export async function requireManagerDomain(db: AppDb) {
  const manager = await findManagerDomain(db);
  if (!manager) throw new BusinessError("errors:managerNotConfigured", 404, "MANAGER_NOT_CONFIGURED");
  if (!manager.activeVersionId && !manager.draftVersionId) {
    throw new BusinessError("errors:managerNotBound", 409, "MANAGER_NOT_BOUND");
  }
  return manager;
}

async function loadCurrentManagerConfig(db: AppDb, manager: NonNullable<Awaited<ReturnType<typeof findManagerDomain>>>) {
  const versionId = manager.draftVersionId ?? manager.activeVersionId;
  if (!versionId) throw new BusinessError("errors:versionNotFound", 409, "VERSION_NOT_FOUND");
  const version = await db.query.configVersions.findFirst({
    where: and(eq(configVersions.id, versionId), eq(configVersions.domainId, manager.id)),
  });
  if (!version) throw new BusinessError("errors:versionNotFound", 409, "VERSION_NOT_FOUND");
  return { version, config: parseManagerSnapshot(version.snapshotJson) };
}

/** Ensure draft snapshot has ssl.enabled + email + dns-01 validation before ordering. */
export async function ensureManagerSslDraft(
  db: AppDb,
  userId: string,
  input: {
    email: string;
    environment: "staging" | "production";
    validation: ManagerConfig["ssl"]["validation"];
    autoRenew?: boolean;
    forceHttps?: boolean;
  },
) {
  const manager = await requireManagerDomain(db);
  const { config } = await loadCurrentManagerConfig(db, manager);
  if (!config.bound) throw new BusinessError("errors:managerNotBound", 409, "MANAGER_NOT_BOUND");

  const next = managerConfigSchema.parse({
    ...config,
    ssl: {
      ...config.ssl,
      enabled: true,
      email: input.email,
      environment: input.environment,
      validation: input.validation,
      autoRenew: input.autoRenew ?? config.ssl.autoRenew,
      forceHttps: input.forceHttps ?? config.ssl.forceHttps,
    },
  });
  const snapshot = createSnapshot(next);
  const now = Date.now();
  const saved = db.transaction((tx) =>
    saveDraftVersion(tx, {
      domainId: manager.id,
      config: next,
      snapshot,
      changeSummary: "Enable manager HTTPS (DNS-01)",
      createdBy: userId,
      now,
    }),
  );
  return { manager, ...saved, config: next };
}

export async function listManagerCertificates(db: AppDb) {
  const manager = await requireManagerDomain(db);
  const items = await db.select().from(certificates).where(eq(certificates.domainId, manager.id)).orderBy(desc(certificates.issuedAt));
  return {
    domainId: manager.id,
    items: items.map((item) => publicCertificate(item, manager)),
  };
}

export async function listManagerOrders(db: AppDb) {
  const manager = await requireManagerDomain(db);
  const items = await db.select().from(acmeOrders).where(eq(acmeOrders.domainId, manager.id)).orderBy(desc(acmeOrders.createdAt));
  return { domainId: manager.id, items: items.map(publicOrder) };
}

export async function createManagerCertificateOrder(
  db: AppDb,
  input: CreateManagerCertificateOrderInput,
  idempotencyKey: string,
  userId: string,
) {
  const existing = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.idempotencyKey, idempotencyKey) });
  if (existing) return { order: publicOrder(existing), created: false as const };

  if (input.validation.method !== "dns-01") {
    throw new BusinessError("errors:managerHttp01Forbidden", 400, "MANAGER_HTTP01_FORBIDDEN");
  }

  // Guard active orders before mutating the SSL draft (H4).
  const managerGate = await requireManagerDomain(db);
  const active = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.domainId, managerGate.id), notInArray(acmeOrders.status, terminalOrderStatuses)),
  });
  if (active) throw new BusinessError("errors:domainHasActiveOrder", 409, "DOMAIN_HAS_ACTIVE_ORDER");

  // Persist SSL settings into manager draft so order validation matches snapshot.
  const prepared = await ensureManagerSslDraft(db, userId, {
    email: input.accountEmail,
    environment: input.environment,
    validation: input.validation,
  });
  const manager = prepared.manager;
  const config = prepared.config;

  let credentialName: string | null = null;
  const identifiers = [config.primaryHostname, ...config.aliases].sort();
  if (input.validation.provider === "cloudflare") {
    const credential = await db.query.cloudflareCredentials.findFirst({
      where: and(eq(cloudflareCredentials.id, input.validation.cloudflareCredentialId), eq(cloudflareCredentials.status, "active")),
    });
    if (!credential) throw new BusinessError("errors:cloudflareCredentialInvalid", 409, "CLOUDFLARE_CREDENTIAL_INVALID");
    try {
      const token = await decryptCloudflareToken(credential.id, credential);
      await getCloudflareDnsProvider().preflight(token, identifiers);
      await db.update(cloudflareCredentials).set({ lastVerifiedAt: Date.now(), lastUsedAt: Date.now(), updatedAt: Date.now() }).where(eq(cloudflareCredentials.id, credential.id));
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      throw new BusinessError("errors:cloudflarePreflightFailed", 422, "CLOUDFLARE_PREFLIGHT_FAILED", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    credentialName = credential.name;
  }

  const order = {
    id: randomUUID(),
    domainId: manager.id,
    validationMethod: "dns-01" as const,
    dnsProvider: input.validation.provider,
    cloudflareCredentialId: input.validation.provider === "cloudflare" ? input.validation.cloudflareCredentialId : null,
    cloudflareCredentialName: credentialName,
    accountEmail: input.accountEmail,
    environment: input.environment,
    status: "preparing",
    identifiersJson: JSON.stringify(identifiers),
    // Always point at the version whose hostnames were ordered so activation can
    // recover the matching baseline even when an older active version exists (C6).
    unpublishedBaseVersionId: prepared.versionId,
    cleanupStatus: "pending",
    idempotencyKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as const;
  await db.insert(acmeOrders).values(order);
  return {
    order: publicOrder({
      ...order,
      replacesCertificateId: null,
      orderUrl: null,
      nextPollAt: null,
      lastPolledAt: null,
      expiresAt: null,
      errorCode: null,
      errorMessage: null,
    }),
    created: true as const,
  };
}

export async function renewManagerCertificate(db: AppDb, idempotencyKey: string) {
  const manager = await requireManagerDomain(db);
  const certificate = await db.query.certificates.findFirst({
    where: and(eq(certificates.domainId, manager.id), eq(certificates.status, "active")),
  });
  if (!certificate) throw new BusinessError("errors:activeCertificateNotFound", 409, "ACTIVE_CERTIFICATE_NOT_FOUND");
  const result = await createRenewalOrder(db, { certificateId: certificate.id, idempotencyKey });
  return { order: publicOrder(result.order), created: result.created };
}

export async function getManagerOrder(db: AppDb, orderId: string) {
  const manager = await requireManagerDomain(db);
  const order = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.domainId, manager.id)),
  });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  const [challenges, certificate] = await Promise.all([
    db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id)),
    db.query.certificates.findFirst({ where: eq(certificates.acmeOrderId, order.id) }),
  ]);
  const activation = certificate
    ? await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.certificateId, certificate.id) })
    : null;
  const deployment = activation?.deploymentId
    ? await db.query.deployments.findFirst({ where: eq(deployments.id, activation.deploymentId) })
    : null;
  return {
    order: publicOrder(order),
    challenges: challenges.map(publicChallenge),
    certificate: certificate ? publicCertificate(certificate, manager) : null,
    activation,
    deployment,
  };
}

export async function recheckManagerOrder(db: AppDb, orderId: string) {
  const manager = await requireManagerDomain(db);
  const order = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.domainId, manager.id)),
  });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  return recheckAcmeOrder(db, order);
}

export async function cancelManagerOrder(db: AppDb, orderId: string) {
  const manager = await requireManagerDomain(db);
  const order = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.domainId, manager.id)),
  });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  return cancelAcmeOrder(db, order);
}

export async function retryManagerActivation(db: AppDb, orderId: string) {
  const manager = await requireManagerDomain(db);
  const order = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.domainId, manager.id)),
  });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  return retryAcmeOrderActivation(db, order);
}

export async function retryManagerCleanup(db: AppDb, orderId: string) {
  const manager = await requireManagerDomain(db);
  const order = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.domainId, manager.id)),
  });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  return retryCloudflareOrderCleanup(db, order);
}
