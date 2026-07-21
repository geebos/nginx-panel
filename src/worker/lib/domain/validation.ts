import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import {
  MANAGER_PLACEHOLDER_HOSTNAME,
  acmeOrders,
  configVersions,
  domainAliases,
  domains,
  managerConfigSchema,
  managerUserHostnames,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { getBootstrapHosts } from "@/worker/lib/runtime/env";

export async function collectReservedHostnames(
  db: AppEnv["Variables"]["db"],
  excludedDomainId?: string,
) {
  const reserved = new Set<string>([...getBootstrapHosts(), MANAGER_PLACEHOLDER_HOSTNAME]);

  const domainRows = await db
    .select({
      id: domains.id,
      type: domains.type,
      primaryHostname: domains.primaryHostname,
      activeVersionId: domains.activeVersionId,
      draftVersionId: domains.draftVersionId,
    })
    .from(domains)
    .where(isNull(domains.deletedAt));

  for (const row of domainRows) {
    if (row.id === excludedDomainId) continue;
    if (row.type === "manager") {
      // Union draft + active hosts so rebind drafts never free the live manager name (C5).
      const versionIds = [...new Set([row.draftVersionId, row.activeVersionId].filter((id): id is string => Boolean(id)))];
      if (!versionIds.length) {
        if (row.primaryHostname !== MANAGER_PLACEHOLDER_HOSTNAME) reserved.add(row.primaryHostname);
        continue;
      }
      for (const versionId of versionIds) {
        const version = await db.query.configVersions.findFirst({ where: eq(configVersions.id, versionId) });
        if (!version) continue;
        try {
          const snap = managerConfigSchema.parse(JSON.parse(version.snapshotJson));
          for (const host of managerUserHostnames(snap)) reserved.add(host);
          if (snap.bound) {
            reserved.add(snap.primaryHostname);
            for (const a of snap.aliases) reserved.add(a);
          }
        } catch {
          if (row.primaryHostname !== MANAGER_PLACEHOLDER_HOSTNAME) reserved.add(row.primaryHostname);
        }
      }
    } else {
      reserved.add(row.primaryHostname);
    }
  }

  const aliasRows = await db.select({
    domainId: domainAliases.domainId,
    hostname: domainAliases.hostname,
  }).from(domainAliases);
  const managerIds = new Set(domainRows.filter((r) => r.type === "manager").map((r) => r.id));
  for (const alias of aliasRows) {
    if (alias.domainId === excludedDomainId) continue;
    if (managerIds.has(alias.domainId)) continue;
    reserved.add(alias.hostname);
  }

  return reserved;
}

export async function assertHostnamesAvailable(
  db: AppEnv["Variables"]["db"],
  hostnames: string[],
  excludedDomainId?: string,
) {
  const reserved = await collectReservedHostnames(db, excludedDomainId);
  const conflict = hostnames.find((host) => reserved.has(host));
  if (conflict) {
    throw new BusinessError("errors:domainConflictHost", 409, "DOMAIN_CONFLICT", {
      params: { hostname: conflict },
      fieldErrors: { "config.primaryHostname": ["errors:domainConflictHost"] },
    });
  }

  const [primaryMatches, aliasMatches] = await Promise.all([
    db.select({ id: domains.id, hostname: domains.primaryHostname }).from(domains).where(and(isNull(domains.deletedAt), inArray(domains.primaryHostname, hostnames))),
    db.select({ domainId: domainAliases.domainId, hostname: domainAliases.hostname }).from(domainAliases).where(inArray(domainAliases.hostname, hostnames)),
  ]);
  const columnConflict = [
    ...primaryMatches.map((row) => ({ domainId: row.id, hostname: row.hostname })),
    ...aliasMatches,
  ].find((row) => row.domainId !== excludedDomainId);
  if (columnConflict) {
    throw new BusinessError("errors:domainConflictHost", 409, "DOMAIN_CONFLICT", {
      params: { hostname: columnConflict.hostname },
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
