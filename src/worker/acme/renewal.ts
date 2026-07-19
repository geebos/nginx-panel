import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { acmeOrders, certificates, cloudflareCredentials, domainAliases, domains } from "@/shared/schemas";
import { decryptCloudflareToken } from "@/worker/cloudflare/credentials";
import { getCloudflareDnsProvider, type CloudflareDnsProvider } from "@/worker/cloudflare/dns";
import { BusinessError } from "@/worker/lib/errors";
import type { AppEnv } from "@/worker/types";

const renewalWindow = 30 * 24 * 60 * 60 * 1000;
const retryDelays = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const running = new Set<string>();
let scheduler: ReturnType<typeof setInterval> | null = null;
let retryScheduler: ReturnType<typeof setInterval> | null = null;
let schedulerTail = Promise.resolve();

function scheduleRenewalRun(operation: () => Promise<void>) {
  const run = schedulerTail.then(operation);
  schedulerTail = run.catch((error) => console.error("[renewal] scheduler failed", error instanceof Error ? error.name : "unknown"));
  return run;
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase().replace(/\.$/, "")))].sort();
}

function sameHostnames(left: string[], right: string[]) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function errorCode(error: unknown) {
  return error instanceof BusinessError ? error.code : "CERTIFICATE_RENEWAL_FAILED";
}

export async function createRenewalOrder(
  db: AppEnv["Variables"]["db"],
  input: { certificateId: string; idempotencyKey: string; now?: number },
  cloudflare: CloudflareDnsProvider = getCloudflareDnsProvider(),
) {
  const now = input.now ?? Date.now();
  const certificate = await db.query.certificates.findFirst({ where: and(eq(certificates.id, input.certificateId), eq(certificates.status, "active")) });
  if (!certificate) throw new BusinessError("Active Certificate 不存在", 404, "ACTIVE_CERTIFICATE_NOT_FOUND");
  const byKey = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.idempotencyKey, input.idempotencyKey) });
  if (byKey) {
    if (byKey.domainId !== certificate.domainId || !byKey.replacesCertificateId) throw new BusinessError("Idempotency-Key 已用于其他操作", 409, "IDEMPOTENCY_KEY_REUSED");
    return { order: byKey, created: false };
  }
  const [sourceOrder, domain, aliases] = await Promise.all([
    db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, certificate.acmeOrderId) }),
    db.query.domains.findFirst({ where: and(eq(domains.id, certificate.domainId), isNull(domains.deletedAt)) }),
    db.select({ hostname: domainAliases.hostname }).from(domainAliases).where(eq(domainAliases.domainId, certificate.domainId)),
  ]);
  if (!sourceOrder || sourceOrder.status !== "succeeded" || !domain) throw new BusinessError("证书来源订单或 Domain 不可用", 409, "RENEWAL_SOURCE_UNAVAILABLE");
  const identifiers = JSON.parse(certificate.sansJson) as string[];
  if (!sameHostnames([domain.primaryHostname, ...aliases.map((alias) => alias.hostname)], identifiers)) {
    throw new BusinessError("当前 Domain hostname 与 Active Certificate SAN 不一致，请重新申请证书", 409, "CERTIFICATE_SAN_DRIFT");
  }
  const existingOrder = await db.query.acmeOrders.findFirst({ where: and(
    eq(acmeOrders.domainId, certificate.domainId),
    inArray(acmeOrders.status, ["preparing", "waiting_http", "waiting_dns", "validating", "validated", "downloading"]),
  ) });
  if (existingOrder) {
    if (existingOrder.replacesCertificateId === certificate.id) return { order: existingOrder, created: false };
    throw new BusinessError("该域名已有进行中的证书订单", 409, "DOMAIN_HAS_ACTIVE_ORDER");
  }
  const completedOrder = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.replacesCertificateId, certificate.id), eq(acmeOrders.status, "succeeded")) });
  if (completedOrder) return { order: completedOrder, created: false };
  const credentialId = certificate.cloudflareCredentialId ?? sourceOrder.cloudflareCredentialId;
  let credentialName = sourceOrder.cloudflareCredentialName;
  if (sourceOrder.dnsProvider === "cloudflare") {
    if (!credentialId) throw new BusinessError("续期使用的 Cloudflare 凭据关联已丢失", 409, "CLOUDFLARE_CREDENTIAL_INVALID");
    const credential = await db.query.cloudflareCredentials.findFirst({ where: and(eq(cloudflareCredentials.id, credentialId), eq(cloudflareCredentials.status, "active")) });
    if (!credential) throw new BusinessError("续期使用的 Cloudflare 凭据无效", 409, "CLOUDFLARE_CREDENTIAL_INVALID");
    try {
      const token = await decryptCloudflareToken(credential.id, credential);
      await cloudflare.preflight(token, identifiers);
      await db.update(cloudflareCredentials).set({ lastVerifiedAt: now, lastUsedAt: now, updatedAt: now }).where(eq(cloudflareCredentials.id, credential.id));
      credentialName = credential.name;
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      throw new BusinessError("Cloudflare 续期预检失败", 422, "CLOUDFLARE_PREFLIGHT_FAILED", { cause: error instanceof Error ? error : undefined });
    }
  }

  return db.transaction((tx) => {
    const repeated = tx.select().from(acmeOrders).where(eq(acmeOrders.idempotencyKey, input.idempotencyKey)).get();
    if (repeated) return { order: repeated, created: false };
    const active = tx.select().from(acmeOrders).where(and(eq(acmeOrders.domainId, certificate.domainId), inArray(acmeOrders.status, ["preparing", "waiting_http", "waiting_dns", "validating", "validated", "downloading"]))).get();
    if (active) {
      if (active.replacesCertificateId === certificate.id) return { order: active, created: false };
      throw new BusinessError("该域名已有进行中的证书订单", 409, "DOMAIN_HAS_ACTIVE_ORDER");
    }
    const completed = tx.select().from(acmeOrders).where(and(eq(acmeOrders.replacesCertificateId, certificate.id), eq(acmeOrders.status, "succeeded"))).get();
    if (completed) return { order: completed, created: false };
    const order = {
      id: randomUUID(),
      domainId: certificate.domainId,
      replacesCertificateId: certificate.id,
      validationMethod: sourceOrder.validationMethod,
      dnsProvider: sourceOrder.dnsProvider,
      cloudflareCredentialId: sourceOrder.dnsProvider === "cloudflare" ? credentialId : null,
      cloudflareCredentialName: sourceOrder.dnsProvider === "cloudflare" ? credentialName : null,
      accountEmail: sourceOrder.accountEmail,
      environment: sourceOrder.environment,
      status: "preparing",
      identifiersJson: JSON.stringify(normalized(identifiers)),
      cleanupStatus: "pending",
      idempotencyKey: input.idempotencyKey,
      nextPollAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof acmeOrders.$inferInsert;
    tx.insert(acmeOrders).values(order).run();
    return { order: tx.select().from(acmeOrders).where(eq(acmeOrders.id, order.id)).get()!, created: true };
  });
}

export async function recordRenewalOrderFailure(db: AppEnv["Variables"]["db"], orderId: string, code: string) {
  const order = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, orderId) });
  if (!order?.replacesCertificateId) return;
  const result = await db.select({ value: count() }).from(acmeOrders).where(and(
    eq(acmeOrders.replacesCertificateId, order.replacesCertificateId),
    inArray(acmeOrders.status, ["failed", "expired"]),
  ));
  const attempts = Math.max(1, result[0]?.value ?? 1);
  const delay = retryDelays[Math.min(attempts - 1, retryDelays.length - 1)];
  await db.update(certificates).set({ lastErrorCode: code, nextCheckAt: Date.now() + delay }).where(and(
    eq(certificates.id, order.replacesCertificateId),
    eq(certificates.status, "active"),
  ));
}

async function processDueRenewals(
  db: AppEnv["Variables"]["db"],
  due: Array<{ id: string; lastErrorCode: string | null }>,
  now: number,
  cloudflare?: CloudflareDnsProvider,
) {
  await Promise.all(due.map(async (certificate) => {
    if (running.has(certificate.id)) return;
    running.add(certificate.id);
    try {
      await createRenewalOrder(db, { certificateId: certificate.id, idempotencyKey: `auto-renew:${certificate.id}:${randomUUID()}`, now }, cloudflare);
    } catch (error) {
      const code = errorCode(error);
      await db.update(certificates).set({
        lastErrorCode: code === "DOMAIN_HAS_ACTIVE_ORDER" ? certificate.lastErrorCode : code,
        nextCheckAt: now + retryDelays[0],
      }).where(and(eq(certificates.id, certificate.id), eq(certificates.status, "active")));
    } finally {
      running.delete(certificate.id);
    }
  }));
}

export async function runRenewalSchedulerOnce(
  db: AppEnv["Variables"]["db"],
  options: { now?: number; cloudflare?: CloudflareDnsProvider } = {},
) {
  const now = options.now ?? Date.now();
  const due = await db.select({ id: certificates.id, lastErrorCode: certificates.lastErrorCode }).from(certificates).where(and(
    eq(certificates.status, "active"),
    eq(certificates.autoRenew, true),
    isNull(certificates.lastErrorCode),
    lte(certificates.notAfter, now + renewalWindow),
    or(isNull(certificates.nextCheckAt), lte(certificates.nextCheckAt, now)),
  )).limit(25);
  await processDueRenewals(db, due, now, options.cloudflare);
}

export async function runRenewalRetryOnce(
  db: AppEnv["Variables"]["db"],
  options: { now?: number; cloudflare?: CloudflareDnsProvider } = {},
) {
  const now = options.now ?? Date.now();
  const due = await db.select({ id: certificates.id, lastErrorCode: certificates.lastErrorCode }).from(certificates).where(and(
    eq(certificates.status, "active"),
    eq(certificates.autoRenew, true),
    isNotNull(certificates.lastErrorCode),
    lte(certificates.notAfter, now + renewalWindow),
    or(isNull(certificates.nextCheckAt), lte(certificates.nextCheckAt, now)),
  )).limit(25);
  await processDueRenewals(db, due, now, options.cloudflare);
}

export function startRenewalScheduler(db: AppEnv["Variables"]["db"]) {
  if (scheduler) return () => undefined;
  void scheduleRenewalRun(() => runRenewalSchedulerOnce(db));
  void scheduleRenewalRun(() => runRenewalRetryOnce(db));
  scheduler = setInterval(() => void scheduleRenewalRun(() => runRenewalSchedulerOnce(db)), 24 * 60 * 60 * 1000);
  retryScheduler = setInterval(() => void scheduleRenewalRun(() => runRenewalRetryOnce(db)), 60 * 60 * 1000);
  scheduler.unref?.();
  retryScheduler.unref?.();
  return () => {
    if (scheduler) clearInterval(scheduler);
    if (retryScheduler) clearInterval(retryScheduler);
    scheduler = null;
    retryScheduler = null;
  };
}

export function waitForRenewalScheduler() {
  return schedulerTail;
}

export const certificateRenewalWindowMs = renewalWindow;
