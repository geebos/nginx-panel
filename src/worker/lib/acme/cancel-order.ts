import { and, eq } from "drizzle-orm";
import { acmeChallenges, acmeOrders, certificates } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { cleanupCloudflareOrder } from "@/worker/lib/acme/cloudflare-cleanup";
import { orderCleanupStatus } from "@/worker/lib/acme/order-cleanup-fields";
import { terminalOrderStatuses } from "@/worker/lib/acme/order-status";
import { publicOrder } from "@/worker/lib/acme/public";

type AppDb = AppEnv["Variables"]["db"];

/** Delay before the next automatic renewal check after an operator cancels a replacement order. */
const RENEWAL_CANCELLED_RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * Shared ACME order cancel policy (domain + manager).
 * Callers load and authorize the order; this function applies the cancel side effects.
 */
export async function cancelAcmeOrder(
  db: AppDb,
  order: typeof acmeOrders.$inferSelect,
) {
  if (terminalOrderStatuses.includes(order.status)) return { order: publicOrder(order) };
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(acmeOrders).set({
      status: "cancelled",
      cleanupStatus: orderCleanupStatus(order.dnsProvider),
      nextPollAt: null,
      updatedAt: now,
    }).where(eq(acmeOrders.id, order.id)).run();
    if (order.replacesCertificateId) {
      tx.update(certificates).set({
        lastErrorCode: "RENEWAL_CANCELLED",
        nextCheckAt: now + RENEWAL_CANCELLED_RECHECK_MS,
      }).where(and(
        eq(certificates.id, order.replacesCertificateId),
        eq(certificates.status, "active"),
      )).run();
    }
    if (order.dnsProvider !== "cloudflare") {
      tx.update(acmeChallenges).set({
        token: null,
        keyAuthorization: null,
        dnsRecordValue: null,
        status: "cleaned",
        cleanedAt: now,
        updatedAt: now,
      }).where(eq(acmeChallenges.orderId, order.id)).run();
    }
  });
  if (order.dnsProvider === "cloudflare") await cleanupCloudflareOrder(db, order.id);
  const cancelled = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return { order: publicOrder(cancelled!) };
}
