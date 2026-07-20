import { eq } from "drizzle-orm";
import { acmeChallenges, acmeOrders, cloudflareCredentials } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { decryptCloudflareToken } from "@/worker/cloudflare/credentials";
import { getCloudflareDnsProvider, type CloudflareDnsProvider } from "@/worker/cloudflare/dns";

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Cloudflare DNS cleanup failed").slice(0, 500);
}

export async function cleanupCloudflareOrder(
  db: AppEnv["Variables"]["db"],
  orderId: string,
  provider: CloudflareDnsProvider = getCloudflareDnsProvider(),
) {
  const order = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, orderId) });
  if (!order || order.dnsProvider !== "cloudflare" || order.cleanupStatus === "succeeded") return;
  try {
    if (!order.cloudflareCredentialId) throw new Error("Cloudflare credential association is missing");
    const credential = await db.query.cloudflareCredentials.findFirst({ where: eq(cloudflareCredentials.id, order.cloudflareCredentialId) });
    if (!credential) throw new Error("Cloudflare credential has been deleted");
    const token = await decryptCloudflareToken(credential.id, credential);
    const challenges = await db.select().from(acmeChallenges).where(eq(acmeChallenges.orderId, order.id));
    for (const challenge of challenges) {
      if (challenge.cloudflareZoneId && challenge.cloudflareRecordId && !challenge.cleanedAt) {
        await provider.cleanup(token, challenge.cloudflareZoneId, challenge.cloudflareRecordId);
      }
      const now = Date.now();
      await db.update(acmeChallenges).set({
        token: null,
        keyAuthorization: null,
        dnsRecordValue: null,
        status: "cleaned",
        cleanedAt: now,
        updatedAt: now,
      }).where(eq(acmeChallenges.id, challenge.id));
    }
    await db.update(acmeOrders).set({ cleanupStatus: "succeeded", nextPollAt: null, updatedAt: Date.now() }).where(eq(acmeOrders.id, order.id));
  } catch (error) {
    await db.update(acmeOrders).set({ cleanupStatus: "failed", errorMessage: safeError(error), nextPollAt: Date.now() + 60_000, updatedAt: Date.now() }).where(eq(acmeOrders.id, order.id));
  }
}
