import { eq } from "drizzle-orm";
import { acmeOrders } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { cleanupCloudflareOrder } from "@/worker/lib/acme/cloudflare-cleanup";
import { terminalOrderStatuses } from "@/worker/lib/acme/order-status";
import { publicOrder } from "@/worker/lib/acme/public";
import { BusinessError } from "@/worker/lib/errors";

type AppDb = AppEnv["Variables"]["db"];

/**
 * Shared Cloudflare cleanup retry policy (domain + manager).
 * Callers load and authorize the order; this function re-queues and runs cleanup.
 */
export async function retryCloudflareOrderCleanup(
  db: AppDb,
  order: typeof acmeOrders.$inferSelect,
) {
  if (order.dnsProvider !== "cloudflare" || !terminalOrderStatuses.includes(order.status)) {
    throw new BusinessError("errors:cloudflareCleanupNotAvailable", 409, "CLOUDFLARE_CLEANUP_NOT_AVAILABLE");
  }
  const now = Date.now();
  await db.update(acmeOrders).set({
    cleanupStatus: "pending",
    nextPollAt: now,
    updatedAt: now,
  }).where(eq(acmeOrders.id, order.id));
  await cleanupCloudflareOrder(db, order.id);
  const updated = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return { order: publicOrder(updated!) };
}
