import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { acmeOrders, certificates, deployments, domains } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { getRuntimeState } from "@/worker/lib/runtime-state";

export const dashboardRoute = new Hono<AppEnv>();

dashboardRoute.get("/dashboard", async (c) => {
  const db = c.get("db");
  const renewalWindowEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const [metricRows, certificateRows, orderRows, renewalAttention, recentDomains, recentDeployments] = await Promise.all([
    db.select({
      total: count(),
      enabled: sql<number>`coalesce(sum(case when ${domains.enabled} = 1 then 1 else 0 end), 0)`.mapWith(Number),
      drafts: sql<number>`coalesce(sum(case when ${domains.draftVersionId} is not null and (${domains.activeVersionId} is null or ${domains.draftVersionId} != ${domains.activeVersionId}) then 1 else 0 end), 0)`.mapWith(Number),
      failed: sql<number>`coalesce(sum(case when ${domains.runtimeStatus} = 'failed' then 1 else 0 end), 0)`.mapWith(Number),
    }).from(domains).where(isNull(domains.deletedAt)),
    db.select({
      active: sql<number>`coalesce(sum(case when ${certificates.status} = 'active' then 1 else 0 end), 0)`.mapWith(Number),
      expiring: sql<number>`coalesce(sum(case when ${certificates.status} = 'active' and ${certificates.notAfter} <= ${renewalWindowEnd} then 1 else 0 end), 0)`.mapWith(Number),
      failed: sql<number>`coalesce(sum(case when ${certificates.status} = 'active' and ${certificates.lastErrorCode} is not null then 1 else 0 end), 0)`.mapWith(Number),
    }).from(certificates),
    db.select({
      renewing: sql<number>`coalesce(sum(case when ${acmeOrders.replacesCertificateId} is not null and ${acmeOrders.status} not in ('succeeded', 'failed', 'expired', 'cancelled') then 1 else 0 end), 0)`.mapWith(Number),
      waitingManual: sql<number>`coalesce(sum(case when ${acmeOrders.replacesCertificateId} is not null and ${acmeOrders.status} = 'waiting_dns' and ${acmeOrders.dnsProvider} = 'manual' then 1 else 0 end), 0)`.mapWith(Number),
    }).from(acmeOrders),
    db.select({ orderId: acmeOrders.id, domainId: domains.id, hostname: domains.primaryHostname, createdAt: acmeOrders.createdAt })
      .from(acmeOrders).innerJoin(domains, eq(acmeOrders.domainId, domains.id)).where(and(
        isNotNull(acmeOrders.replacesCertificateId),
        eq(acmeOrders.status, "waiting_dns"),
        eq(acmeOrders.dnsProvider, "manual"),
        isNull(domains.deletedAt),
      )).orderBy(desc(acmeOrders.createdAt)).limit(5),
    db.select().from(domains).where(isNull(domains.deletedAt)).orderBy(desc(domains.updatedAt)).limit(5),
    db.select().from(deployments).orderBy(desc(deployments.createdAt)).limit(8),
  ]);
  const metrics = metricRows[0] ?? { total: 0, enabled: 0, drafts: 0, failed: 0 };
  const certificateMetrics = certificateRows[0] ?? { active: 0, expiring: 0, failed: 0 };
  const orderMetrics = orderRows[0] ?? { renewing: 0, waitingManual: 0 };
  const runtime = getRuntimeState();

  return c.json({
    refreshedAt: Date.now(),
    domains: metrics,
    certificates: { ...certificateMetrics, ...orderMetrics },
    nginx: { status: runtime.status, version: null, checkedAt: runtime.checkedAt },
    runtime,
    lastDeployment: recentDeployments[0] ?? null,
    recentDeployments,
    recentDomains,
    renewalAttention,
  });
});
