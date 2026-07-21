import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { acmeChallenges, acmeOrders, certificateRenewalWindowMs, certificates, cloudflareCredentials, configVersions, domains } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { AcmeRecoveryError, getAcmeAdapter, type AcmeAdapter, type ExistingAcmeOrderInput } from "@/worker/lib/acme/client";
import { getCertificateStore, type CertificateStore } from "@/worker/lib/acme/certificate-store";
import { getDnsPropagationChecker, type DnsPropagationChecker } from "@/worker/lib/acme/dns";
import { decryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";
import { getCloudflareDnsProvider, type CloudflareDnsProvider } from "@/worker/lib/cloudflare/dns";
import { cleanupCloudflareOrder } from "@/worker/lib/acme/cloudflare-cleanup";
import { recordRenewalOrderFailure } from "@/worker/lib/acme/renewal";
import { safeErrorMessage } from "@/worker/lib/acme/safe-error";
import { parseDomainSnapshot } from "@/worker/lib/domain/snapshot";
import { parseStringArrayJson } from "@/worker/lib/json-array";
import { initialChallengeStatus, postPrepareNextPollAt, postPrepareOrderStatus } from "@/worker/lib/acme/prepare-status";
import { orderCleanupNextPollAt, orderCleanupStatus } from "@/worker/lib/acme/order-cleanup-fields";
import { createSerialQueue } from "@/worker/lib/serial-queue";
import { activeOrderStatuses, downloadableOrderStatuses, terminalOrderStatuses } from "@/worker/lib/acme/order-status";

const running = new Set<string>();
let scheduler: ReturnType<typeof setInterval> | null = null;
const acmeQueue = createSerialQueue("[acme] scheduler failed");

function scheduleAcmeRun(db: AppEnv["Variables"]["db"]) {
  return acmeQueue.enqueue(() => runAcmeSchedulerOnce(db));
}

type SchedulerDependencies = {
  dns: DnsPropagationChecker;
  certificates: CertificateStore;
  cloudflare: CloudflareDnsProvider;
};

function orderInput(order: typeof acmeOrders.$inferSelect): ExistingAcmeOrderInput {
  if (!order.orderUrl) throw new Error("ACME order URL is missing");
  return {
    orderId: order.id,
    orderUrl: order.orderUrl,
    accountEmail: order.accountEmail,
    environment: order.environment as "staging" | "production",
    identifiers: parseStringArrayJson(order.identifiersJson),
    validationMethod: order.validationMethod as "http-01" | "dns-01",
  };
}

function nextPoll(delay: number) {
  return Date.now() + delay;
}

function terminalAuthorization(status: string) {
  return ["invalid", "deactivated", "expired", "revoked"].includes(status);
}

function clearChallenges(db: AppEnv["Variables"]["db"], orderId: string, status: string, now: number) {
  db.update(acmeChallenges).set({
    token: null,
    keyAuthorization: null,
    dnsRecordValue: null,
    status,
    cleanedAt: now,
    updatedAt: now,
  }).where(eq(acmeChallenges.orderId, orderId)).run();
}

async function endOrder(db: AppEnv["Variables"]["db"], orderId: string, status: "failed" | "expired", errorCode: string, errorMessage: string) {
  const now = Date.now();
  const order = db.select().from(acmeOrders).where(eq(acmeOrders.id, orderId)).get();
  const cloudflare = order?.dnsProvider === "cloudflare";
  db.transaction((tx) => {
    if (!cloudflare) clearChallenges(tx as AppEnv["Variables"]["db"], orderId, status, now);
    tx.update(acmeOrders).set({ status, errorCode, errorMessage, cleanupStatus: orderCleanupStatus(order?.dnsProvider), nextPollAt: orderCleanupNextPollAt(order?.dnsProvider, now), lastPolledAt: now, updatedAt: now })
      .where(eq(acmeOrders.id, orderId)).run();
  });
  if (order?.replacesCertificateId) await recordRenewalOrderFailure(db, orderId, errorCode);
}

async function presentCloudflareChallenges(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect, provider: CloudflareDnsProvider) {
  if (!order.cloudflareCredentialId) throw new Error("Cloudflare credential association is missing");
  const credential = await db.query.cloudflareCredentials.findFirst({ where: and(eq(cloudflareCredentials.id, order.cloudflareCredentialId), eq(cloudflareCredentials.status, "active")) });
  if (!credential) throw new Error("Cloudflare credential is invalid or disabled");
  const token = await decryptCloudflareToken(credential.id, credential);
  const challenges = await db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id));
  if (!challenges.length || challenges.some((challenge) => !challenge.dnsRecordName || !challenge.dnsRecordValue)) throw new Error("DNS challenge data is incomplete");
  for (const challenge of challenges) {
    if (challenge.cloudflareZoneId && challenge.cloudflareRecordId) continue;
    const record = await provider.present(token, {
      orderId: order.id,
      challengeId: challenge.id,
      name: challenge.dnsRecordName!,
      value: challenge.dnsRecordValue!,
      hostname: challenge.hostname,
    });
    await db.update(acmeChallenges).set({ cloudflareZoneId: record.zoneId, cloudflareRecordId: record.recordId, status: "propagating", updatedAt: Date.now() })
      .where(eq(acmeChallenges.id, challenge.id));
  }
  const now = Date.now();
  await db.update(cloudflareCredentials).set({ lastUsedAt: now, updatedAt: now }).where(eq(cloudflareCredentials.id, credential.id));
  await db.update(acmeOrders).set({ status: "waiting_dns", nextPollAt: now + 15_000, lastPolledAt: now, errorCode: null, errorMessage: null, updatedAt: now })
    .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "preparing")));
}

export async function prepareAcmeOrder(db: AppEnv["Variables"]["db"], orderId: string, adapter: AcmeAdapter = getAcmeAdapter(), cloudflare: CloudflareDnsProvider = getCloudflareDnsProvider()) {
  if (running.has(orderId)) return;
  running.add(orderId);
  try {
    const order = await db.query.acmeOrders.findFirst({ where: and(eq(acmeOrders.id, orderId), eq(acmeOrders.status, "preparing")) });
    if (!order) return;
    const identifiers = parseStringArrayJson(order.identifiersJson);
    const existingChallenges = await db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id));
    if (order.orderUrl && existingChallenges.length === identifiers.length) {
      if (order.dnsProvider === "cloudflare") await presentCloudflareChallenges(db, order, cloudflare);
      return;
    }
    const prepared = await adapter.prepareOrder({
      orderId: order.id,
      accountEmail: order.accountEmail,
      environment: order.environment as "staging" | "production",
      identifiers,
      validationMethod: order.validationMethod as "http-01" | "dns-01",
      allowAccountCreate: !order.replacesCertificateId,
    });
    if (prepared.challenges.length !== identifiers.length) throw new Error("ACME did not return a complete set of challenges");
    const expected = [...identifiers].sort();
    const actual = prepared.challenges.map((item) => item.hostname).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("ACME authorization hostnames do not match the order");
    const now = Date.now();
    db.transaction((tx) => {
      const current = tx.select().from(acmeOrders).where(eq(acmeOrders.id, order.id)).get();
      if (!current || current.status !== "preparing") return;
      for (const challenge of prepared.challenges) {
        tx.insert(acmeChallenges).values({
          id: randomUUID(),
          orderId: order.id,
          domainId: order.domainId,
          hostname: challenge.hostname,
          type: challenge.type,
          token: challenge.token,
          keyAuthorization: challenge.keyAuthorization,
          dnsRecordName: challenge.dnsRecordName,
          dnsRecordValue: challenge.dnsRecordValue,
          status: initialChallengeStatus({ challengeType: challenge.type, dnsProvider: order.dnsProvider }),
          expiresAt: challenge.expiresAt,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
      tx.update(acmeOrders).set({
        orderUrl: prepared.orderUrl,
        expiresAt: prepared.expiresAt,
        status: postPrepareOrderStatus({ dnsProvider: order.dnsProvider, validationMethod: order.validationMethod }),
        nextPollAt: postPrepareNextPollAt(now, { dnsProvider: order.dnsProvider, validationMethod: order.validationMethod }),
        lastPolledAt: now,
        updatedAt: now,
      }).where(eq(acmeOrders.id, order.id)).run();
    });
    if (order.dnsProvider === "cloudflare") {
      const persistedOrder = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
      if (persistedOrder) await presentCloudflareChallenges(db, persistedOrder, cloudflare);
    }
  } catch (error) {
    const now = Date.now();
    const current = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, orderId) });
    const recoverablePresentation = Boolean(current?.orderUrl && current.dnsProvider === "cloudflare");
    const prepareCode = error instanceof AcmeRecoveryError ? error.code : recoverablePresentation ? "CLOUDFLARE_PRESENT_FAILED" : "ACME_PREPARE_FAILED";
    await db.update(acmeOrders).set({
      status: recoverablePresentation ? "preparing" : "failed",
      errorCode: prepareCode,
      errorMessage: safeErrorMessage(error, "ACME order processing failed", "[ACME URL]"),
      cleanupStatus: recoverablePresentation ? "pending" : "succeeded",
      nextPollAt: recoverablePresentation ? now + 15_000 : null,
      updatedAt: now,
    }).where(and(eq(acmeOrders.id, orderId), eq(acmeOrders.status, "preparing")));
    if (!recoverablePresentation && current?.replacesCertificateId) await recordRenewalOrderFailure(db, orderId, prepareCode);
  } finally {
    running.delete(orderId);
  }
}

async function resolveAutoRenew(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect) {
  const domain = await db.query.domains.findFirst({ where: eq(domains.id, order.domainId) });
  const versionId = domain?.activeVersionId ?? order.unpublishedBaseVersionId ?? domain?.draftVersionId;
  if (!versionId) return true;
  const version = await db.query.configVersions.findFirst({ where: eq(configVersions.id, versionId) });
  if (!version) return true;
  return parseDomainSnapshot(version.snapshotJson).ssl.autoRenew;
}

async function waitForDns(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect, adapter: AcmeAdapter, dns: DnsPropagationChecker) {
  const challenges = await db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id));
  if (challenges.length === 0 || challenges.some((challenge) => !challenge.dnsRecordName || !challenge.dnsRecordValue)) {
    throw new Error("DNS challenge data is incomplete");
  }
  const results = await Promise.all(challenges.map((challenge) => dns.check(challenge.dnsRecordName!, challenge.dnsRecordValue!)));
  const now = Date.now();
  db.transaction((tx) => {
    challenges.forEach((challenge, index) => {
      tx.update(acmeChallenges).set({ status: results[index].authoritative ? "ready" : "propagating", updatedAt: now })
        .where(eq(acmeChallenges.id, challenge.id)).run();
    });
    tx.update(acmeOrders).set({ lastPolledAt: now, nextPollAt: now + 15_000, errorCode: null, errorMessage: null, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "waiting_dns"))).run();
  });
  if (!results.every((result) => result.authoritative)) return;
  await adapter.acknowledgeChallenges(orderInput(order));
  db.transaction((tx) => {
    tx.update(acmeChallenges).set({ status: "validating", updatedAt: now }).where(eq(acmeChallenges.orderId, order.id)).run();
    tx.update(acmeOrders).set({ status: "validating", nextPollAt: now + 5_000, lastPolledAt: now, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "waiting_dns"))).run();
  });
}

async function acknowledgeHttp(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect, adapter: AcmeAdapter) {
  await adapter.acknowledgeChallenges(orderInput(order));
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(acmeChallenges).set({ status: "validating", updatedAt: now }).where(eq(acmeChallenges.orderId, order.id)).run();
    tx.update(acmeOrders).set({ status: "validating", nextPollAt: now + 5_000, lastPolledAt: now, errorCode: null, errorMessage: null, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "waiting_http"))).run();
  });
}

async function pollValidation(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect, adapter: AcmeAdapter) {
  const progress = await adapter.pollOrder(orderInput(order));
  if (progress.orderStatus === "invalid" || progress.authorizations.some((authorization) => terminalAuthorization(authorization.status))) {
    await endOrder(db, order.id, "failed", "ACME_VALIDATION_FAILED", "ACME failed to validate one or more domains");
    return;
  }
  const now = Date.now();
  if (!progress.authorizations.every((authorization) => authorization.status === "valid")) {
    await db.update(acmeOrders).set({ nextPollAt: now + 5_000, lastPolledAt: now, errorCode: null, errorMessage: null, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "validating")));
    return;
  }
  db.transaction((tx) => {
    if (order.dnsProvider !== "cloudflare") clearChallenges(tx as AppEnv["Variables"]["db"], order.id, "valid", now);
    tx.update(acmeOrders).set({ status: "validated", nextPollAt: now, lastPolledAt: now, errorCode: null, errorMessage: null, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "validating"))).run();
  });
}

async function downloadCertificate(db: AppEnv["Variables"]["db"], order: typeof acmeOrders.$inferSelect, adapter: AcmeAdapter, store: CertificateStore) {
  const now = Date.now();
  if (order.status === "validated") {
    await db.update(acmeOrders).set({ status: "downloading", nextPollAt: now, lastPolledAt: now, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), eq(acmeOrders.status, "validated")));
  }
  const finalized = await adapter.finalizeOrder(orderInput(order));
  if (finalized.status === "pending") {
    await db.update(acmeOrders).set({ status: "downloading", nextPollAt: now + 5_000, lastPolledAt: now, updatedAt: now })
      .where(eq(acmeOrders.id, order.id));
    return;
  }
  const certificateId = randomUUID();
  const persisted = await store.persist({
    certificateId,
    domainId: order.domainId,
    orderId: order.id,
    identifiers: parseStringArrayJson(order.identifiersJson),
    certificatePem: finalized.certificatePem,
  });
  const autoRenew = await resolveAutoRenew(db, order);
  db.transaction((tx) => {
    tx.insert(certificates).values({
      id: certificateId,
      domainId: order.domainId,
      acmeOrderId: order.id,
      provider: "letsencrypt",
      environment: order.environment,
      status: "ready",
      sansJson: JSON.stringify(persisted.sans),
      certPath: persisted.certPath,
      keyPath: persisted.keyPath,
      certFileChecksum: persisted.certFileChecksum,
      publicKeySpkiChecksum: persisted.publicKeySpkiChecksum,
      notBefore: persisted.notBefore,
      notAfter: persisted.notAfter,
      autoRenew,
      lastValidationMethod: order.validationMethod,
      lastDnsProvider: order.dnsProvider,
      cloudflareCredentialId: order.cloudflareCredentialId,
      issuedAt: now,
      nextCheckAt: persisted.notAfter - certificateRenewalWindowMs + Math.floor(Math.random() * 2 * 60 * 60 * 1000),
    }).run();
    tx.update(acmeOrders).set({ status: "succeeded", cleanupStatus: orderCleanupStatus(order.dnsProvider), nextPollAt: orderCleanupNextPollAt(order.dnsProvider, now), lastPolledAt: now, errorCode: null, errorMessage: null, updatedAt: now })
      .where(and(eq(acmeOrders.id, order.id), inArray(acmeOrders.status, downloadableOrderStatuses))).run();
    if (order.replacesCertificateId) tx.update(certificates).set({ lastErrorCode: null, nextCheckAt: null }).where(eq(certificates.id, order.replacesCertificateId)).run();
  });
  if (order.dnsProvider === "cloudflare") await cleanupCloudflareOrder(db, order.id);
  try {
    await store.cleanupOrder(order.id);
  } catch (error) {
    await db.update(acmeOrders).set({ cleanupStatus: "failed", errorMessage: safeErrorMessage(error, "ACME order processing failed", "[ACME URL]"), updatedAt: Date.now() }).where(eq(acmeOrders.id, order.id));
  }
}

async function progressAcmeOrder(db: AppEnv["Variables"]["db"], orderId: string, adapter: AcmeAdapter, dependencies: SchedulerDependencies) {
  if (running.has(orderId)) return;
  running.add(orderId);
  try {
    const order = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, orderId) });
    if (!order || order.status === "preparing" || !activeOrderStatuses.includes(order.status)) return;
    const challenges = await db.select({ expiresAt: acmeChallenges.expiresAt }).from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id));
    const expiresAt = Math.min(...[order.expiresAt, ...challenges.map((challenge) => challenge.expiresAt)].filter((value): value is number => value !== null));
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      await endOrder(db, order.id, "expired", "ACME_ORDER_EXPIRED", "ACME order or challenge has expired");
      return;
    }
    if (order.status === "waiting_dns") await waitForDns(db, order, adapter, dependencies.dns);
    if (order.status === "waiting_http") await acknowledgeHttp(db, order, adapter);
    if (order.status === "validating") await pollValidation(db, order, adapter);
    if (downloadableOrderStatuses.includes(order.status)) await downloadCertificate(db, order, adapter, dependencies.certificates);
  } catch (error) {
    if (error instanceof AcmeRecoveryError) {
      await endOrder(db, orderId, "failed", error.code, safeErrorMessage(error, "ACME order processing failed", "[ACME URL]"));
      return;
    }
    const now = Date.now();
    await db.update(acmeOrders).set({ errorCode: "ACME_PROGRESS_FAILED", errorMessage: safeErrorMessage(error, "ACME order processing failed", "[ACME URL]"), nextPollAt: nextPoll(15_000), lastPolledAt: now, updatedAt: now })
      .where(eq(acmeOrders.id, orderId));
  } finally {
    running.delete(orderId);
  }
}

export async function runAcmeSchedulerOnce(
  db: AppEnv["Variables"]["db"],
  adapter: AcmeAdapter = getAcmeAdapter(),
  dependencies: Partial<SchedulerDependencies> = {},
) {
  const now = Date.now();
  const orders = await db.select({ id: acmeOrders.id, status: acmeOrders.status }).from(acmeOrders).where(and(
    inArray(acmeOrders.status, activeOrderStatuses),
    or(isNull(acmeOrders.nextPollAt), lte(acmeOrders.nextPollAt, now)),
  )).orderBy(asc(acmeOrders.createdAt)).limit(10);
  const resolvedDependencies: SchedulerDependencies = {
    dns: dependencies.dns ?? getDnsPropagationChecker(),
    certificates: dependencies.certificates ?? getCertificateStore(),
    cloudflare: dependencies.cloudflare ?? getCloudflareDnsProvider(),
  };
  await Promise.all(orders.map((order) => order.status === "preparing"
    ? prepareAcmeOrder(db, order.id, adapter, resolvedDependencies.cloudflare)
    : progressAcmeOrder(db, order.id, adapter, resolvedDependencies)));
  const cleanupOrders = await db.select({ id: acmeOrders.id }).from(acmeOrders).where(and(
    eq(acmeOrders.dnsProvider, "cloudflare"),
    inArray(acmeOrders.status, terminalOrderStatuses),
    inArray(acmeOrders.cleanupStatus, ["pending", "failed"]),
    or(isNull(acmeOrders.nextPollAt), lte(acmeOrders.nextPollAt, now)),
  )).limit(10);
  await Promise.all(cleanupOrders.map((order) => cleanupCloudflareOrder(db, order.id, resolvedDependencies.cloudflare)));
}

export function startAcmeScheduler(db: AppEnv["Variables"]["db"]) {
  if (scheduler) return () => undefined;
  void scheduleAcmeRun(db);
  scheduler = setInterval(() => void scheduleAcmeRun(db), 5_000);
  scheduler.unref?.();
  return () => {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
  };
}

export function waitForAcmeScheduler() {
  return acmeQueue.wait();
}

export async function persistAcmeShutdownState(db: AppEnv["Variables"]["db"]) {
  const now = Date.now();
  await db.update(acmeOrders).set({ nextPollAt: now, updatedAt: now }).where(inArray(
    acmeOrders.status,
    activeOrderStatuses,
  ));
}
