import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import {
  configVersions,
  createConfigVersionSchema,
  deployVersionInputSchema,
  domainConfigSchema,
  domains,
  testVersionInputSchema,
  type ConfigVersion,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { createSnapshot } from "@/worker/lib/snapshot";
import { diffDomainConfigs } from "@/worker/lib/domain/diff";
import { renderDomainPreview } from "@/worker/lib/nginx/config";
import { createConfigTestDeployment, runConfigTest } from "@/worker/lib/deployment/config-test";
import { jsonValidator } from "@/worker/lib/validator";
import { assertHostnamesAvailable, assertHostnamesMutable } from "@/worker/lib/domain/validation";
import { rethrowWriteConflict } from "@/worker/lib/domain/constraint-conflict";
import { saveDraftVersion } from "@/worker/lib/domain/draft-version";
import { createPublishDeployment, createRollbackDeployment, enqueuePublish } from "@/worker/lib/deployment/runner";

async function domainOrThrow(db: AppEnv["Variables"]["db"], id: string) {
  const domain = await db.query.domains.findFirst({ where: and(eq(domains.id, id), isNull(domains.deletedAt)) });
  if (!domain) throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
  return domain;
}

async function versionOrThrow(db: AppEnv["Variables"]["db"], domainId: string, versionId: string) {
  const version = await db.query.configVersions.findFirst({ where: and(eq(configVersions.id, versionId), eq(configVersions.domainId, domainId)) });
  if (!version) throw new BusinessError("errors:versionNotFound", 404, "VERSION_NOT_FOUND");
  return version;
}

function configFrom(version: { snapshotJson: string }) {
  return domainConfigSchema.parse(JSON.parse(version.snapshotJson));
}

export const versionsRoute = new Hono<AppEnv>();

versionsRoute.get("/domains/:id/versions", async (c) => {
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  const items = await db.select().from(configVersions).where(eq(configVersions.domainId, c.req.param("id"))).orderBy(desc(configVersions.versionNumber));
  return c.json({ items });
});

versionsRoute.post("/domains/:id/versions", jsonValidator(createConfigVersionSchema), async (c) => {
  const db = c.get("db");
  const domainId = c.req.param("id");
  const expected = c.req.header("If-Match")?.replace(/^W\//, "").replace(/^\"|\"$/g, "");
  if (!expected) {
    throw new BusinessError("errors:versionConflict", 409, "VERSION_CONFLICT");
  }
  const { config, changeSummary } = c.req.valid("json");
  await assertHostnamesMutable(db, domainId, [config.primaryHostname, ...config.aliases]);
  await assertHostnamesAvailable(db, [config.primaryHostname, ...config.aliases], domainId);
  const snapshot = createSnapshot(config);
  let result!: { changed: boolean; mode: "created" | "updated" | "unchanged"; version: ConfigVersion };
  const now = Date.now();
  try {
    result = db.transaction((tx) => {
      const freshDomain = tx.select().from(domains)
        .where(eq(domains.id, domainId))
        .get();
      if (!freshDomain || freshDomain.deletedAt !== null) {
        throw new BusinessError("errors:domainNotFound", 404, "DOMAIN_NOT_FOUND");
      }
      const freshCurrentId = freshDomain?.draftVersionId ?? freshDomain?.activeVersionId;
      const freshCurrent = freshCurrentId
        ? tx.select().from(configVersions)
            .where(and(eq(configVersions.id, freshCurrentId), eq(configVersions.domainId, domainId)))
            .get()
        : undefined;
      if (!freshCurrent || freshCurrent.snapshotChecksum !== expected) {
        throw new BusinessError("errors:versionConflict", 409, "VERSION_CONFLICT");
      }
      if (snapshot.checksum === freshCurrent.snapshotChecksum) {
        return { changed: false, mode: "unchanged" as const, version: freshCurrent };
      }

      const saved = saveDraftVersion(tx, {
        domainId,
        config,
        snapshot,
        changeSummary,
        createdBy: c.get("user")!.id,
        now,
        expectedChecksum: expected,
      });
      return { changed: true, mode: saved.mode, version: saved.version };
    });
  } catch (error) {
    await rethrowWriteConflict(db, error, [config.primaryHostname, ...config.aliases], domainId);
  }
  return result.changed
    ? c.json({ changed: true, mode: result.mode, version: result.version }, result.mode === "created" ? 201 : 200)
    : c.json({ changed: false, mode: result.mode, version: result.version });
});

versionsRoute.get("/domains/:id/versions/:versionId", async (c) => {
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  const version = await versionOrThrow(db, c.req.param("id"), c.req.param("versionId"));
  const config = configFrom(version);
  return c.json({ version, config, nginxPreview: renderDomainPreview(config) });
});

versionsRoute.get("/domains/:id/versions/:versionId/diff", async (c) => {
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  const target = await versionOrThrow(db, c.req.param("id"), c.req.param("versionId"));
  const baseId = c.req.query("base");
  if (!baseId) throw new BusinessError("errors:validationError", 400, "VALIDATION_ERROR");
  const base = await versionOrThrow(db, c.req.param("id"), baseId);
  const baseConfig = configFrom(base);
  const targetConfig = configFrom(target);
  return c.json({
    base,
    target,
    changes: diffDomainConfigs(baseConfig, targetConfig),
    baseJson: JSON.stringify(baseConfig, null, 2),
    targetJson: JSON.stringify(targetConfig, null, 2),
    baseNginx: renderDomainPreview(baseConfig),
    targetNginx: renderDomainPreview(targetConfig),
  });
});

versionsRoute.get("/domains/:id/versions/:versionId/publish-preview", async (c) => {
  const db = c.get("db");
  const domain = await domainOrThrow(db, c.req.param("id"));
  const target = await versionOrThrow(db, domain.id, c.req.param("versionId"));
  if (domain.draftVersionId !== target.id || target.status !== "draft") {
    throw new BusinessError("errors:draftChanged", 409, "DRAFT_CHANGED");
  }
  const targetConfig = configFrom(target);
  const base = domain.activeVersionId
    ? await versionOrThrow(db, domain.id, domain.activeVersionId)
    : null;
  const baseConfig = base ? configFrom(base) : null;
  return c.json({
    domainId: domain.id,
    baseVersion: base,
    targetVersion: target,
    targetSnapshotChecksum: target.snapshotChecksum,
    changes: baseConfig
      ? diffDomainConfigs(baseConfig, targetConfig)
      : [{ section: "domain", kind: "added" as const, label: targetConfig.primaryHostname, after: "Initial publish" }],
    baseJson: baseConfig ? JSON.stringify(baseConfig, null, 2) : null,
    targetJson: JSON.stringify(targetConfig, null, 2),
    baseNginx: baseConfig ? renderDomainPreview(baseConfig) : null,
    targetNginx: renderDomainPreview(targetConfig),
  });
});

versionsRoute.post("/domains/:id/versions/:versionId/test", jsonValidator(testVersionInputSchema), async (c) => {
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  await versionOrThrow(db, c.req.param("id"), c.req.param("versionId"));
  const idempotencyKey = c.req.header("Idempotency-Key") || randomUUID();
  const { expectedSnapshotChecksum } = c.req.valid("json");
  const deployment = await createConfigTestDeployment(db, {
    domainId: c.req.param("id"),
    versionId: c.req.param("versionId"),
    requestedBy: c.get("user")!.id,
    idempotencyKey,
    expectedSnapshotChecksum,
  });
  if (deployment.status === "queued") {
    queueMicrotask(() => {
      void runConfigTest(db, deployment.id).catch((error) => {
        console.error(`[config-test] unhandled failure for ${deployment.id}`, error);
      });
    });
  }
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

versionsRoute.post("/domains/:id/versions/:versionId/deploy", jsonValidator(deployVersionInputSchema), async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new BusinessError("errors:deploymentUnavailable", 409, "DEPLOYMENT_UNAVAILABLE");
  const db = c.get("db");
  await domainOrThrow(db, c.req.param("id"));
  await versionOrThrow(db, c.req.param("id"), c.req.param("versionId"));
  const body = c.req.valid("json");
  const deployment = await createPublishDeployment(db, { domainId: c.req.param("id"), versionId: c.req.param("versionId"), requestedBy: c.get("user")!.id, idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(), expectedSnapshotChecksum: body.expectedSnapshotChecksum, preflightDeploymentId: body.preflightDeploymentId });
  if (deployment.status === "queued") void enqueuePublish(db, deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});

versionsRoute.post("/domains/:id/versions/:versionId/rollback", async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new BusinessError("errors:deploymentUnavailable", 409, "DEPLOYMENT_UNAVAILABLE");
  const db = c.get("db");
  const result = await createRollbackDeployment(db, {
    domainId: c.req.param("id"),
    sourceVersionId: c.req.param("versionId"),
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
  });
  if (result.deployment.status === "queued") void enqueuePublish(db, result.deployment.id);
  return c.json({
    deploymentId: result.deployment.id,
    versionId: result.version?.id ?? result.deployment.configVersionId,
    versionNumber: result.version?.versionNumber ?? null,
    statusUrl: `/api/deployments/${result.deployment.id}`,
  }, 202);
});
