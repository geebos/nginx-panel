import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  acmeChallenges,
  acmeOrders,
  certificateActivations,
  certificates,
  cloudflareCredentials,
  configVersions,
  createCertificateOrderSchema,
  deployments,
  domainAliases,
  domainConfigSchema,
  domains,
} from "@/shared/schemas";
import { retryCertificateActivation } from "@/worker/lib/acme/activation";
import { cleanupCloudflareOrder } from "@/worker/lib/acme/cloudflare-cleanup";
import { createRenewalOrder } from "@/worker/lib/acme/renewal";
import { decryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";
import { getCloudflareDnsProvider } from "@/worker/lib/cloudflare/dns";
import { BusinessError } from "@/worker/lib/errors";
import { jsonValidator } from "@/worker/lib/validator";
import type { AppEnv } from "@/worker/types";

const terminalOrderStatuses = ["succeeded", "failed", "expired", "cancelled"];
const httpChallengeStatuses = ["pending", "presented", "propagating", "ready"];

async function domainOrThrow(db: AppEnv["Variables"]["db"], id: string) {
  const domain = await db.query.domains.findFirst({ where: and(eq(domains.id, id), isNull(domains.deletedAt)) });
  // Manager is not exposed via domain certificate paths (use /api/settings/manager/certificate/*).
  if (!domain || domain.type === "manager") throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
  return domain;
}

function publicOrder(order: typeof acmeOrders.$inferSelect) {
  const { idempotencyKey: _idempotencyKey, identifiersJson, ...safe } = order;
  void _idempotencyKey;
  return { ...safe, identifiers: JSON.parse(identifiersJson) as string[] };
}

function publicChallenge(challenge: typeof acmeChallenges.$inferSelect) {
  return {
    id: challenge.id,
    hostname: challenge.hostname,
    type: challenge.type,
    status: challenge.status,
    dnsRecordName: challenge.dnsRecordName,
    dnsRecordValue: challenge.type === "dns-01" ? challenge.dnsRecordValue : null,
    expiresAt: challenge.expiresAt,
    cleanedAt: challenge.cleanedAt,
  };
}

function publicCertificate(
  certificate: typeof certificates.$inferSelect,
  domain: Pick<typeof domains.$inferSelect, "primaryHostname" | "enabled" | "activeVersionId">,
) {
  return {
    id: certificate.id,
    domainId: certificate.domainId,
    acmeOrderId: certificate.acmeOrderId,
    provider: certificate.provider,
    environment: certificate.environment,
    status: certificate.status,
    sans: JSON.parse(certificate.sansJson) as string[],
    notBefore: certificate.notBefore,
    notAfter: certificate.notAfter,
    autoRenew: certificate.autoRenew,
    issuedAt: certificate.issuedAt,
    activatedAt: certificate.activatedAt,
    nextCheckAt: certificate.nextCheckAt,
    lastErrorCode: certificate.lastErrorCode,
    primaryHostname: domain.primaryHostname,
    domainEnabled: domain.enabled,
    activeVersionId: domain.activeVersionId,
  };
}

export const certificatesRoute = new Hono<AppEnv>();

certificatesRoute.get("/certificates", async (c) => {
  const items = await c.get("db")
    .select({ certificate: certificates, domain: domains })
    .from(certificates)
    .innerJoin(domains, eq(certificates.domainId, domains.id))
    .where(eq(domains.type, "domain"))
    .orderBy(desc(certificates.issuedAt));
  return c.json({ items: items.map(({ certificate, domain }) => publicCertificate(certificate, domain)) });
});

certificatesRoute.get("/domains/:id/certificates", async (c) => {
  const db = c.get("db");
  const domain = await domainOrThrow(db, c.req.param("id"));
  const items = await db.select().from(certificates).where(eq(certificates.domainId, c.req.param("id"))).orderBy(desc(certificates.issuedAt));
  return c.json({ items: items.map((item) => publicCertificate(item, domain)) });
});

certificatesRoute.get("/domains/:id/certificate/orders", async (c) => {
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  const items = await db.select().from(acmeOrders).where(eq(acmeOrders.domainId, c.req.param("id"))).orderBy(desc(acmeOrders.createdAt));
  return c.json({ items: items.map(publicOrder) });
});

certificatesRoute.post("/domains/:id/certificate/orders", jsonValidator(createCertificateOrderSchema), async (c) => {
  const db = c.get("db");
  const domain = await domainOrThrow(db, c.req.param("id"));
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey) throw new BusinessError("errors:idempotencyKeyRequired", 400, "IDEMPOTENCY_KEY_REQUIRED");
  const existing = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.idempotencyKey, idempotencyKey) });
  if (existing) return c.json({ order: publicOrder(existing) }, 200);

  const currentVersionId = domain.draftVersionId ?? domain.activeVersionId;
  if (!currentVersionId) throw new BusinessError("errors:versionNotFound", 409, "VERSION_NOT_FOUND");
  const version = await db.query.configVersions.findFirst({ where: and(eq(configVersions.id, currentVersionId), eq(configVersions.domainId, domain.id)) });
  if (!version) throw new BusinessError("errors:versionNotFound", 409, "VERSION_NOT_FOUND");
  const config = domainConfigSchema.parse(JSON.parse(version.snapshotJson));
  const input = c.req.valid("json");
  if (!config.ssl.enabled) throw new BusinessError("errors:httpsNotEnabled", 409, "HTTPS_NOT_ENABLED");
  if (config.ssl.email.toLowerCase() !== input.accountEmail || config.ssl.environment !== input.environment || JSON.stringify(config.ssl.validation) !== JSON.stringify(input.validation)) {
    throw new BusinessError("errors:sslConfigChanged", 409, "SSL_CONFIG_CHANGED");
  }
  const active = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.domainId, domain.id), notInArray(acmeOrders.status, terminalOrderStatuses)) });
  if (active) throw new BusinessError("errors:domainHasActiveOrder", 409, "DOMAIN_HAS_ACTIVE_ORDER");

  let credentialName: string | null = null;
  const identifiers = [config.primaryHostname, ...config.aliases].sort();
  if (input.validation.method === "dns-01" && input.validation.provider === "cloudflare") {
    const credential = await db.query.cloudflareCredentials.findFirst({ where: and(eq(cloudflareCredentials.id, input.validation.cloudflareCredentialId), eq(cloudflareCredentials.status, "active")) });
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
    domainId: domain.id,
    validationMethod: input.validation.method,
    dnsProvider: input.validation.method === "dns-01" ? input.validation.provider : null,
    cloudflareCredentialId: input.validation.method === "dns-01" && input.validation.provider === "cloudflare" ? input.validation.cloudflareCredentialId : null,
    cloudflareCredentialName: credentialName,
    accountEmail: input.accountEmail,
    environment: input.environment,
    status: "preparing",
    identifiersJson: JSON.stringify(identifiers),
    unpublishedBaseVersionId: domain.activeVersionId ? null : version.id,
    cleanupStatus: "pending",
    idempotencyKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as const;
  await db.insert(acmeOrders).values(order);
  return c.json({ order: publicOrder({ ...order, replacesCertificateId: null, orderUrl: null, nextPollAt: null, lastPolledAt: null, expiresAt: null, errorCode: null, errorMessage: null }) }, 201);
});

certificatesRoute.post("/domains/:id/certificate/renew", async (c) => {
  const db = c.get("db");
  const domain = await domainOrThrow(db, c.req.param("id"));
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey) throw new BusinessError("errors:idempotencyKeyRequired", 400, "IDEMPOTENCY_KEY_REQUIRED");
  const certificate = await db.query.certificates.findFirst({ where: and(eq(certificates.domainId, domain.id), eq(certificates.status, "active")) });
  if (!certificate) throw new BusinessError("errors:activeCertificateNotFound", 409, "ACTIVE_CERTIFICATE_NOT_FOUND");
  const result = await createRenewalOrder(db, { certificateId: certificate.id, idempotencyKey });
  return c.json({ order: publicOrder(result.order) }, result.created ? 201 : 200);
});

certificatesRoute.get("/domains/:id/certificate/orders/:orderId", async (c) => {
  const db = c.get("db");
  const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, c.req.param("orderId")), eq(acmeOrders.domainId, c.req.param("id"))) });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  const [challenges, certificate] = await Promise.all([
    db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id)),
    db.query.certificates.findFirst({ where: eq(certificates.acmeOrderId, order.id) }),
  ]);
  const activation = certificate ? await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.certificateId, certificate.id) }) : null;
  const deployment = activation?.deploymentId ? await db.query.deployments.findFirst({ where: eq(deployments.id, activation.deploymentId) }) : null;
  const domain = certificate ? await domainOrThrow(db, certificate.domainId) : null;
  return c.json({ order: publicOrder(order), challenges: challenges.map(publicChallenge), certificate: certificate && domain ? publicCertificate(certificate, domain) : null, activation, deployment });
});

certificatesRoute.post("/domains/:id/certificate/orders/:orderId/activation/retry", async (c) => {
  const db = c.get("db");
  const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, c.req.param("orderId")), eq(acmeOrders.domainId, c.req.param("id"))) });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  const certificate = await db.query.certificates.findFirst({ where: eq(certificates.acmeOrderId, order.id) });
  const activation = certificate ? await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.certificateId, certificate.id) }) : null;
  if (!activation) throw new BusinessError("errors:certificateActivationNotFound", 409, "CERTIFICATE_ACTIVATION_NOT_FOUND");
  const result = await retryCertificateActivation(db, activation.id);
  return c.json(result, 202);
});

certificatesRoute.post("/domains/:id/certificate/orders/:orderId/recheck", async (c) => {
  const db = c.get("db");
  const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, c.req.param("orderId")), eq(acmeOrders.domainId, c.req.param("id"))) });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  if (!["waiting_http", "waiting_dns", "validating"].includes(order.status)) return c.json({ order: publicOrder(order) });
  const now = Date.now();
  if (order.lastPolledAt && now - order.lastPolledAt < 5_000) return c.json({ order: publicOrder(order), debounced: true });
  await db.update(acmeOrders).set({ nextPollAt: now, updatedAt: now }).where(eq(acmeOrders.id, order.id));
  const scheduled = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return c.json({ order: publicOrder(scheduled!), debounced: false });
});

certificatesRoute.post("/domains/:id/certificate/orders/:orderId/cleanup/retry", async (c) => {
  const db = c.get("db");
  const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, c.req.param("orderId")), eq(acmeOrders.domainId, c.req.param("id"))) });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  if (order.dnsProvider !== "cloudflare" || !terminalOrderStatuses.includes(order.status)) {
    throw new BusinessError("errors:cloudflareCleanupNotAvailable", 409, "CLOUDFLARE_CLEANUP_NOT_AVAILABLE");
  }
  await db.update(acmeOrders).set({ cleanupStatus: "pending", nextPollAt: Date.now(), updatedAt: Date.now() }).where(eq(acmeOrders.id, order.id));
  await cleanupCloudflareOrder(db, order.id);
  const updated = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return c.json({ order: publicOrder(updated!) });
});

certificatesRoute.post("/domains/:id/certificate/orders/:orderId/cancel", async (c) => {
  const db = c.get("db");
  const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, c.req.param("orderId")), eq(acmeOrders.domainId, c.req.param("id"))) });
  if (!order) throw new BusinessError("errors:acmeOrderNotFound", 404, "ACME_ORDER_NOT_FOUND");
  if (terminalOrderStatuses.includes(order.status)) return c.json({ order: publicOrder(order) });
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(acmeOrders).set({ status: "cancelled", cleanupStatus: order.dnsProvider === "cloudflare" ? "pending" : "succeeded", nextPollAt: null, updatedAt: now }).where(eq(acmeOrders.id, order.id)).run();
    if (order.replacesCertificateId) {
      tx.update(certificates).set({ lastErrorCode: "RENEWAL_CANCELLED", nextCheckAt: now + 24 * 60 * 60 * 1000 }).where(and(eq(certificates.id, order.replacesCertificateId), eq(certificates.status, "active"))).run();
    }
    if (order.dnsProvider !== "cloudflare") {
      tx.update(acmeChallenges).set({ token: null, keyAuthorization: null, dnsRecordValue: null, status: "cleaned", cleanedAt: now, updatedAt: now }).where(eq(acmeChallenges.orderId, order.id)).run();
    }
  });
  if (order.dnsProvider === "cloudflare") await cleanupCloudflareOrder(db, order.id);
  const cancelled = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return c.json({ order: publicOrder(cancelled!) });
});

export const acmeChallengeRoute = new Hono<AppEnv>();

acmeChallengeRoute.on(["GET", "HEAD"], "/.well-known/acme-challenge/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(token)) return c.notFound();
  const rawHost = c.req.header("host") ?? "";
  const hostname = rawHost.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]{1,253}$/.test(hostname)) return c.notFound();
  const db = c.get("db");
  let domain = await db.query.domains.findFirst({ where: and(eq(domains.primaryHostname, hostname), eq(domains.enabled, true), isNull(domains.deletedAt)) });
  if (!domain) {
    const alias = await db.select({ domain: domains }).from(domainAliases).innerJoin(domains, eq(domainAliases.domainId, domains.id))
      .where(and(eq(domainAliases.hostname, hostname), eq(domains.enabled, true), isNull(domains.deletedAt))).limit(1);
    domain = alias[0]?.domain;
  }
  if (!domain) return c.notFound();
  const rows = await db.select({ challenge: acmeChallenges }).from(acmeChallenges).innerJoin(acmeOrders, eq(acmeChallenges.orderId, acmeOrders.id)).where(and(
    eq(acmeChallenges.domainId, domain.id),
    eq(acmeChallenges.hostname, hostname),
    eq(acmeChallenges.type, "http-01"),
    inArray(acmeChallenges.status, httpChallengeStatuses),
    gt(acmeChallenges.expiresAt, Date.now()),
    notInArray(acmeOrders.status, terminalOrderStatuses),
  ));
  const tokenBytes = Buffer.from(token);
  const match = rows.find(({ challenge }) => {
    if (!challenge.token) return false;
    const candidate = Buffer.from(challenge.token);
    return candidate.length === tokenBytes.length && timingSafeEqual(candidate, tokenBytes);
  });
  if (!match?.challenge.keyAuthorization) return c.notFound();
  const body = match.challenge.keyAuthorization;
  return new Response(c.req.method === "HEAD" ? null : body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": "no-store" } });
});
