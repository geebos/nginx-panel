import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  configVersions,
  createDomainSchema,
  deployments,
  domainAliases,
  domainConfigSchema,
  domainListQuerySchema,
  domains,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { createSnapshot } from "@/worker/lib/snapshot";
import { jsonValidator, validationError } from "@/worker/lib/validator";
import { assertHostnamesAvailable, assertHostnamesMutable } from "@/worker/lib/domain/validation";
import { rethrowWriteConflict } from "@/worker/lib/domain/constraint-conflict";
import { saveDraftVersion } from "@/worker/lib/domain/draft-version";
import { parseDomainSnapshot } from "@/worker/lib/domain/snapshot";

const updateDomainSchema = z.object({
  config: domainConfigSchema,
  expectedVersionId: z.string().min(1),
  expectedSnapshotChecksum: z.string().min(1),
});

export const domainsRoute = new Hono<AppEnv>();

domainsRoute.get("/domains", async (c) => {
  const parsed = domainListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw validationError(parsed.error);
  }

  const query = parsed.data;
  const db = c.get("db");
  const filters = [isNull(domains.deletedAt), eq(domains.type, "domain")];
  const search = query.search.toLowerCase();
  if (search) {
    filters.push(or(
      sql`instr(lower(${domains.primaryHostname}), ${search}) > 0`,
      exists(
        db.select({ id: domainAliases.id })
          .from(domainAliases)
          .where(and(
            eq(domainAliases.domainId, domains.id),
            sql`instr(lower(${domainAliases.hostname}), ${search}) > 0`,
          )),
      ),
    )!);
  }
  if (query.status === "disabled") {
    filters.push(eq(domains.enabled, false));
  } else if (query.status !== "all") {
    filters.push(eq(domains.runtimeStatus, query.status));
  }

  const where = and(...filters);
  const orderBy = query.sort === "hostname_asc"
    ? asc(domains.primaryHostname)
    : query.sort === "created_desc"
      ? desc(domains.createdAt)
      : desc(domains.updatedAt);
  const offset = (query.page - 1) * query.pageSize;
  const [domainRows, totalRows] = await Promise.all([
    db.select().from(domains).where(where).orderBy(orderBy).limit(query.pageSize).offset(offset),
    db.select({ value: count() }).from(domains).where(where),
  ]);
  const aliasRows = domainRows.length
    ? await db
        .select()
        .from(domainAliases)
        .where(inArray(domainAliases.domainId, domainRows.map((domain) => domain.id)))
    : [];

  const aliasesByDomain = new Map<string, string[]>();
  for (const alias of aliasRows) {
    aliasesByDomain.set(alias.domainId, [
      ...(aliasesByDomain.get(alias.domainId) ?? []),
      alias.hostname,
    ]);
  }

  const versionIds = domainRows
    .map((domain) => domain.draftVersionId ?? domain.activeVersionId)
    .filter((id): id is string => Boolean(id));
  const versionRows = versionIds.length
    ? await db
        .select({ id: configVersions.id, snapshotJson: configVersions.snapshotJson })
        .from(configVersions)
        .where(inArray(configVersions.id, versionIds))
    : [];
  const sslStatusByVersion = new Map<string, "active" | "pending" | "disabled">();
  for (const version of versionRows) {
    const config = parseDomainSnapshot(version.snapshotJson);
    sslStatusByVersion.set(
      version.id,
      config.ssl.certificateId ? "active" : config.ssl.enabled ? "pending" : "disabled",
    );
  }

  const items = domainRows.map((domain) => {
    const versionId = domain.draftVersionId ?? domain.activeVersionId;
    return {
      ...domain,
      aliases: aliasesByDomain.get(domain.id) ?? [],
      draftChanged: Boolean(domain.draftVersionId && domain.draftVersionId !== domain.activeVersionId),
      sslStatus: (versionId ? sslStatusByVersion.get(versionId) : undefined) ?? "disabled",
    };
  });

  return c.json({ items, page: query.page, pageSize: query.pageSize, total: totalRows[0]?.value ?? 0 });
});

domainsRoute.post("/domains", jsonValidator(createDomainSchema), async (c) => {
  const { config } = c.req.valid("json");
  const db = c.get("db");
  const hostnames = [config.primaryHostname, ...config.aliases];
  await assertHostnamesAvailable(db, hostnames);

  const domainId = randomUUID();
  const now = Date.now();
  let version!: Pick<ReturnType<typeof saveDraftVersion>, "versionId" | "versionNumber" | "snapshotChecksum">;
  try {
    version = db.transaction((tx) => {
      tx.insert(domains).values({
        id: domainId,
        type: "domain",
        primaryHostname: config.primaryHostname,
        displayHostname: config.primaryHostname,
        enabled: true,
        runtimeStatus: "unknown",
        createdAt: now,
        updatedAt: now,
      }).run();
      const saved = saveDraftVersion(tx, {
        domainId,
        config,
        snapshot: createSnapshot(config),
        changeSummary: "Create domain draft",
        createdBy: c.get("user")?.id,
        now,
      });
      return {
        versionId: saved.versionId,
        versionNumber: saved.versionNumber,
        snapshotChecksum: saved.snapshotChecksum,
      };
    });
  } catch (error) {
    await rethrowWriteConflict(db, error, hostnames);
  }

  return c.json({ domainId, version }, 201);
});

domainsRoute.get("/domains/:id", async (c) => {
  const db = c.get("db");
  const domain = await db.query.domains.findFirst({
    where: and(eq(domains.id, c.req.param("id")), isNull(domains.deletedAt)),
  });
  // Manager is not served via domain APIs (scheme A → 404, no leak).
  if (!domain || domain.type === "manager") throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");

  const [aliases, draftVersion, activeVersion, recentDeployments] = await Promise.all([
    db.select().from(domainAliases).where(eq(domainAliases.domainId, domain.id)),
    domain.draftVersionId
      ? db.query.configVersions.findFirst({ where: eq(configVersions.id, domain.draftVersionId) })
      : undefined,
    domain.activeVersionId
      ? db.query.configVersions.findFirst({ where: eq(configVersions.id, domain.activeVersionId) })
      : undefined,
    db.query.deployments.findMany({
      where: eq(deployments.domainId, domain.id),
      orderBy: [desc(deployments.createdAt)],
      limit: 5,
    }),
  ]);

  const config = draftVersion
    ? parseDomainSnapshot(draftVersion.snapshotJson)
    : activeVersion
      ? parseDomainSnapshot(activeVersion.snapshotJson)
      : null;

  return c.json({
    domain: { ...domain, aliases: aliases.map((alias) => alias.hostname) },
    config,
    draftVersion,
    activeVersion,
    recentDeployments,
  });
});

domainsRoute.patch("/domains/:id", jsonValidator(updateDomainSchema), async (c) => {
  const db = c.get("db");
  const domainId = c.req.param("id");
  const { config, expectedVersionId, expectedSnapshotChecksum } = c.req.valid("json");
  await assertHostnamesMutable(db, domainId, [config.primaryHostname, ...config.aliases]);
  await assertHostnamesAvailable(
    db,
    [config.primaryHostname, ...config.aliases],
    domainId,
  );

  const snapshot = createSnapshot(config);
  let result!:
    | { changed: false; versionId: string; snapshotChecksum: string }
    | { changed: true; versionId: string; versionNumber: number; snapshotChecksum: string };
  try {
    result = db.transaction((tx) => {
      const currentDomain = tx.select({
        draftVersionId: domains.draftVersionId,
        deletedAt: domains.deletedAt,
      })
        .from(domains)
        .where(eq(domains.id, domainId))
        .get();
      if (!currentDomain || currentDomain.deletedAt !== null) {
        throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
      }
      if (currentDomain.draftVersionId !== expectedVersionId) {
        throw new BusinessError("errors:versionConflict", 409, "VERSION_CONFLICT");
      }
      const current = tx.select({ id: configVersions.id, snapshotChecksum: configVersions.snapshotChecksum })
        .from(configVersions)
        .where(and(eq(configVersions.id, expectedVersionId), eq(configVersions.domainId, domainId)))
        .get();
      if (!current) throw new BusinessError("errors:versionNotFound", 404, "VERSION_NOT_FOUND");
      if (current.snapshotChecksum !== expectedSnapshotChecksum) {
        throw new BusinessError("errors:versionConflict", 409, "VERSION_CONFLICT");
      }
      if (current.snapshotChecksum === snapshot.checksum) {
        return { changed: false as const, versionId: current.id, snapshotChecksum: current.snapshotChecksum };
      }

      const now = Date.now();
      const saved = saveDraftVersion(tx, {
        domainId,
        config,
        snapshot,
        changeSummary: "Update domain config",
        createdBy: c.get("user")!.id,
        now,
        expectedChecksum: expectedSnapshotChecksum,
      });
      return {
        changed: true as const,
        versionId: saved.versionId,
        versionNumber: saved.versionNumber,
        snapshotChecksum: saved.snapshotChecksum,
      };
    });
  } catch (error) {
    await rethrowWriteConflict(db, error, [config.primaryHostname, ...config.aliases], domainId);
  }
  return c.json(result);
});

domainsRoute.delete("/domains/:id", async (c) => {
  const db = c.get("db");
  const domain = await db.query.domains.findFirst({
    where: and(eq(domains.id, c.req.param("id")), isNull(domains.deletedAt)),
  });
  if (!domain || domain.type === "manager") throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
  if (domain.activeVersionId) {
    throw new BusinessError(
      "errors:deploymentRequired",
      409,
      "DEPLOYMENT_REQUIRED",
    );
  }

  const { softDeleteDomainWithTombstone } = await import("@/worker/lib/manager/service");
  await softDeleteDomainWithTombstone(db, domain.id);
  return c.body(null, 204);
});
