import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { acmeOrders, domainAliases, domains } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { managerUrl } from "@/worker/lib/runtime/env";

function assertManagerHostnameAvailable(hostnames: string[]) {
  const configuredUrl = managerUrl();
  if (!configuredUrl) return;
  const managerHostname = configuredUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (hostnames.includes(managerHostname)) {
    throw new BusinessError("errors:domainConflict", 409, "DOMAIN_CONFLICT", {
      fieldErrors: { "config.primaryHostname": ["errors:domainConflict"] },
    });
  }
}

export async function assertHostnamesAvailable(
  db: AppEnv["Variables"]["db"],
  hostnames: string[],
  excludedDomainId?: string,
) {
  assertManagerHostnameAvailable(hostnames);
  const [primaryMatches, aliasMatches] = await Promise.all([
    db.select({ id: domains.id, hostname: domains.primaryHostname }).from(domains).where(and(isNull(domains.deletedAt), inArray(domains.primaryHostname, hostnames))),
    db.select({ domainId: domainAliases.domainId, hostname: domainAliases.hostname }).from(domainAliases).where(inArray(domainAliases.hostname, hostnames)),
  ]);
  const conflict = [
    ...primaryMatches.map((row) => ({ domainId: row.id, hostname: row.hostname })),
    ...aliasMatches,
  ].find((row) => row.domainId !== excludedDomainId);
  if (conflict) {
    throw new BusinessError("errors:domainConflictHost", 409, "DOMAIN_CONFLICT", {
      params: { hostname: conflict.hostname },
      fieldErrors: { "config.primaryHostname": ["errors:domainConflictHost"] },
    });
  }
}

export async function assertHostnamesMutable(
  db: AppEnv["Variables"]["db"],
  domainId: string,
  nextHostnames: string[],
) {
  const domain = await db.query.domains.findFirst({ where: eq(domains.id, domainId) });
  if (!domain) return;
  const aliases = await db.select({ hostname: domainAliases.hostname }).from(domainAliases).where(eq(domainAliases.domainId, domainId));
  const current = [domain.primaryHostname, ...aliases.map((item) => item.hostname)].sort();
  const next = [...nextHostnames].sort();
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  const activeOrder = await db.query.acmeOrders.findFirst({
    where: and(eq(acmeOrders.domainId, domainId), notInArray(acmeOrders.status, ["succeeded", "failed", "expired", "cancelled"])),
  });
  if (activeOrder) throw new BusinessError("errors:domainHasActiveOrder", 409, "DOMAIN_HAS_ACTIVE_ORDER");
}
