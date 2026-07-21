import { eq } from "drizzle-orm";
import { acmeOrders } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { RECHECK_DEBOUNCE_MS, recheckableOrderStatuses } from "@/worker/lib/acme/order-status";
import { publicOrder } from "@/worker/lib/acme/public";

type AppDb = AppEnv["Variables"]["db"];

/**
 * Shared ACME order recheck policy (domain + manager).
 * Callers load and authorize the order; this function schedules nextPollAt or reports debounce.
 */
export async function recheckAcmeOrder(
  db: AppDb,
  order: typeof acmeOrders.$inferSelect,
): Promise<{ order: ReturnType<typeof publicOrder>; debounced: boolean }> {
  if (!recheckableOrderStatuses.includes(order.status)) {
    return { order: publicOrder(order), debounced: false };
  }
  const now = Date.now();
  if (order.lastPolledAt && now - order.lastPolledAt < RECHECK_DEBOUNCE_MS) {
    return { order: publicOrder(order), debounced: true };
  }
  await db.update(acmeOrders).set({ nextPollAt: now, updatedAt: now }).where(eq(acmeOrders.id, order.id));
  const scheduled = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, order.id) });
  return { order: publicOrder(scheduled!), debounced: false };
}
