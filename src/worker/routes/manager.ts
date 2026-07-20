import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { configVersions, deployments, updateManagerSettingsSchema } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { jsonValidator } from "@/worker/lib/validator";
import {
  createManagerResetDraft,
  findManagerDomain,
  getManagerStatus,
  upsertManagerDraft,
} from "@/worker/lib/manager/service";
import {
  cancelManagerOrder,
  createManagerCertificateOrder,
  createManagerCertificateOrderSchema,
  getManagerOrder,
  listManagerCertificates,
  listManagerOrders,
  recheckManagerOrder,
  renewManagerCertificate,
  retryManagerActivation,
  retryManagerCleanup,
} from "@/worker/lib/manager/certificate";
import { createConfigTestDeployment, runConfigTest } from "@/worker/lib/deployment/config-test";
import {
  createPublishDeployment,
  createRollbackDeployment,
  enqueuePublish,
} from "@/worker/lib/deployment/runner";

export const managerRoute = new Hono<AppEnv>();

managerRoute.get("/settings/manager", async (c) => {
  return c.json(await getManagerStatus(c.get("db")));
});

managerRoute.put("/settings/manager", jsonValidator(updateManagerSettingsSchema), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const result = await upsertManagerDraft(db, input, c.get("user")!.id);
  return c.json({
    domainId: result.domainId,
    versionId: result.versionId,
    versionNumber: result.versionNumber,
    snapshotChecksum: result.snapshotChecksum,
    mode: result.mode,
    config: result.config,
  });
});

managerRoute.post("/settings/manager/publish", async (c) => {
  const db = c.get("db");
  const manager = await findManagerDomain(db);
  if (!manager?.draftVersionId) {
    throw new BusinessError("errors:managerNoDraft", 409, "MANAGER_NO_DRAFT");
  }
  const draft = await db.query.configVersions.findFirst({
    where: eq(configVersions.id, manager.draftVersionId),
  });
  if (!draft || draft.status !== "draft") {
    throw new BusinessError("errors:managerNoDraft", 409, "MANAGER_NO_DRAFT");
  }

  const idempotencyKey = c.req.header("Idempotency-Key") || `manager-publish:${draft.id}:${draft.snapshotChecksum}`;
  const userId = c.get("user")!.id;

  const preflight = await createConfigTestDeployment(db, {
    domainId: manager.id,
    versionId: draft.id,
    requestedBy: userId,
    idempotencyKey: `${idempotencyKey}:test`,
    expectedSnapshotChecksum: draft.snapshotChecksum,
  });
  await runConfigTest(db, preflight.id);
  const preflightAfter = await db.query.deployments.findFirst({ where: eq(deployments.id, preflight.id) });
  if (!preflightAfter || preflightAfter.status !== "succeeded") {
    throw new BusinessError(
      preflightAfter?.errorMessage || "errors:managerPreflightFailed",
      409,
      preflightAfter?.errorCode || "MANAGER_PREFLIGHT_FAILED",
    );
  }

  const deployment = await createPublishDeployment(db, {
    domainId: manager.id,
    versionId: draft.id,
    requestedBy: userId,
    idempotencyKey: `${idempotencyKey}:deploy`,
    expectedSnapshotChecksum: draft.snapshotChecksum,
    preflightDeploymentId: preflight.id,
  });
  void enqueuePublish(db, deployment.id);
  return c.json({
    deploymentId: deployment.id,
    statusUrl: `/api/deployments/${deployment.id}`,
    preflightDeploymentId: preflight.id,
  }, 202);
});

const rollbackBodySchema = z.object({
  sourceVersionId: z.string().min(1),
});

managerRoute.post("/settings/manager/rollback", jsonValidator(rollbackBodySchema), async (c) => {
  const db = c.get("db");
  const manager = await findManagerDomain(db);
  if (!manager) throw new BusinessError("errors:managerNotConfigured", 404, "MANAGER_NOT_CONFIGURED");
  const { sourceVersionId } = c.req.valid("json");
  const idempotencyKey = c.req.header("Idempotency-Key") || `manager-rollback:${sourceVersionId}:${randomUUID()}`;
  const result = await createRollbackDeployment(db, {
    domainId: manager.id,
    sourceVersionId,
    requestedBy: c.get("user")!.id,
    idempotencyKey,
  });
  void enqueuePublish(db, result.deployment.id);
  return c.json({
    deploymentId: result.deployment.id,
    versionId: result.version?.id ?? null,
    versionNumber: result.version?.versionNumber ?? null,
    statusUrl: `/api/deployments/${result.deployment.id}`,
  }, 202);
});

managerRoute.post("/settings/manager/reset", async (c) => {
  const db = c.get("db");
  const result = await createManagerResetDraft(db, c.get("user")!.id);
  return c.json({
    domainId: result.domainId,
    versionId: result.versionId,
    versionNumber: result.versionNumber,
    snapshotChecksum: result.snapshotChecksum,
    config: result.config,
  });
});

// ---- Certificate APIs (DNS-01 only; public surface under /settings/manager/certificate/*) ----

managerRoute.get("/settings/manager/certificate/certificates", async (c) => {
  return c.json(await listManagerCertificates(c.get("db")));
});

managerRoute.get("/settings/manager/certificate/orders", async (c) => {
  return c.json(await listManagerOrders(c.get("db")));
});

managerRoute.post(
  "/settings/manager/certificate/orders",
  jsonValidator(createManagerCertificateOrderSchema),
  async (c) => {
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (!idempotencyKey) throw new BusinessError("errors:idempotencyKeyRequired", 400, "IDEMPOTENCY_KEY_REQUIRED");
    const result = await createManagerCertificateOrder(
      c.get("db"),
      c.req.valid("json"),
      idempotencyKey,
      c.get("user")!.id,
    );
    return c.json({ order: result.order }, result.created ? 201 : 200);
  },
);

managerRoute.post("/settings/manager/certificate/renew", async (c) => {
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey) throw new BusinessError("errors:idempotencyKeyRequired", 400, "IDEMPOTENCY_KEY_REQUIRED");
  const result = await renewManagerCertificate(c.get("db"), idempotencyKey);
  return c.json({ order: result.order }, result.created ? 201 : 200);
});

managerRoute.get("/settings/manager/certificate/orders/:orderId", async (c) => {
  return c.json(await getManagerOrder(c.get("db"), c.req.param("orderId")));
});

managerRoute.post("/settings/manager/certificate/orders/:orderId/recheck", async (c) => {
  return c.json(await recheckManagerOrder(c.get("db"), c.req.param("orderId")));
});

managerRoute.post("/settings/manager/certificate/orders/:orderId/cancel", async (c) => {
  return c.json(await cancelManagerOrder(c.get("db"), c.req.param("orderId")));
});

managerRoute.post("/settings/manager/certificate/orders/:orderId/activation/retry", async (c) => {
  const result = await retryManagerActivation(c.get("db"), c.req.param("orderId"));
  return c.json(result, 202);
});

managerRoute.post("/settings/manager/certificate/orders/:orderId/cleanup/retry", async (c) => {
  return c.json(await retryManagerCleanup(c.get("db"), c.req.param("orderId")));
});
