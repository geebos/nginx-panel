import { serve } from "@hono/node-server";
import { createApp } from "@/worker/index";
import { validateRuntimeEnv } from "@/worker/lib/runtime/env";
import { getSqliteDb } from "@/worker/lib/db/engine";
import { startLogRotationScheduler } from "@/worker/lib/logs/rotator";
import { setRuntimeState } from "@/worker/lib/runtime/state";
import { verifyRuntime } from "@/worker/lib/runtime/verifier";
import { resumeQueuedDeployments } from "@/worker/lib/deployment/resume";
import { persistAcmeShutdownState, startAcmeScheduler, waitForAcmeScheduler } from "@/worker/lib/acme/scheduler";
import { startCertificateActivationCoordinator, waitForCertificateActivationCoordinator } from "@/worker/lib/acme/activation";
import { startRenewalScheduler, waitForRenewalScheduler } from "@/worker/lib/acme/renewal";
import { cleanupRuntimeStorage, startRuntimeStorageScheduler } from "@/worker/lib/runtime/storage";
import { startJobRunnerHeartbeat } from "@/worker/lib/service-lifecycle";
import { drainWorker, type DrainableServer } from "@/worker/lib/graceful-shutdown";
import { waitForRuntimeOperations } from "@/worker/lib/deployment/runner";
import { waitForConfigTests } from "@/worker/lib/deployment/config-test";
import { interruptRunningDeployments } from "@/worker/lib/deployment/recovery";

// Node 运行时入口（@hono/node-server）。
// better-sqlite3 本地文件库；启动方式：DB_SQLITE_DIR=./.sqlite pnpm dev:worker
// （PORT 可覆盖默认 8787 端口）。
const port = Number(process.env.PORT) || 8787;
const hostname = process.env.APP_ENV === "development" ? undefined : "127.0.0.1";

validateRuntimeEnv();

async function start() {
  const db = await getSqliteDb();
  try {
    const { seedManagerFromEnv } = await import("@/worker/lib/manager/seed");
    const seed = await seedManagerFromEnv(db);
    // Seed always writes a draft; enqueue root deploy so nginx leaves bootstrap-only (C4/R2).
    if (
      seed.seeded
      && seed.draftVersionId
      && seed.snapshotChecksum
      && process.env.RUNTIME_MODE === "nginx-manager"
    ) {
      const { createConfigTestDeployment, runConfigTest } = await import("@/worker/lib/deployment/config-test");
      const { createPublishDeployment, enqueuePublish } = await import("@/worker/lib/deployment/runner");
      try {
        const preflight = await createConfigTestDeployment(db, {
          domainId: seed.domainId,
          versionId: seed.draftVersionId,
          requestedBy: "system:manager-seed",
          idempotencyKey: `manager-seed:${seed.draftVersionId}:test`,
          expectedSnapshotChecksum: seed.snapshotChecksum,
        });
        await runConfigTest(db, preflight.id);
        const { deployments } = await import("@/shared/schemas");
        const { eq } = await import("drizzle-orm");
        const preflightAfter = await db.query.deployments.findFirst({ where: eq(deployments.id, preflight.id) });
        if (preflightAfter?.status === "succeeded") {
          const deployment = await createPublishDeployment(db, {
            domainId: seed.domainId,
            versionId: seed.draftVersionId,
            requestedBy: "system:manager-seed",
            idempotencyKey: `manager-seed:${seed.draftVersionId}:deploy`,
            expectedSnapshotChecksum: seed.snapshotChecksum,
            preflightDeploymentId: preflight.id,
          });
          void enqueuePublish(db, deployment.id);
        } else {
          console.error("[worker] manager seed preflight failed; draft retained for Settings publish");
        }
      } catch (error) {
        console.error("[worker] manager seed deploy enqueue failed; draft retained for Settings publish", error);
      }
    }
  } catch (error) {
    console.error("[worker] manager env seed skipped/failed", error);
  }
  const runtimeState = await verifyRuntime(db);
  setRuntimeState(runtimeState);
  await resumeQueuedDeployments(db, runtimeState);
  const stopHeartbeat = startJobRunnerHeartbeat();
  const stopLogRotation = startLogRotationScheduler(db);
  const stopAcme = startAcmeScheduler(db);
  const stopActivation = startCertificateActivationCoordinator(db);
  const stopRenewal = startRenewalScheduler(db);
  if (runtimeState.status === "healthy") await cleanupRuntimeStorage(db);
  const stopRuntimeStorage = startRuntimeStorageScheduler(db);
  if (runtimeState.status !== "healthy") console.error(`[worker] runtime verification entered ${runtimeState.status}`);

  const server = serve({ fetch: createApp().fetch, hostname, port }, (info) => {
    console.log(`[worker] listening on http://localhost:${info.port}`);
  });
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log("[worker] draining before shutdown");
      const result = await drainWorker({
        server: server as DrainableServer,
        timeoutMs: 18_000,
        stopProducers: [stopHeartbeat, stopLogRotation, stopAcme, stopActivation, stopRenewal, stopRuntimeStorage],
        persistAcmeState: () => persistAcmeShutdownState(db),
        waitForWork: [
          waitForRuntimeOperations,
          waitForConfigTests,
          waitForAcmeScheduler,
          waitForCertificateActivationCoordinator,
          waitForRenewalScheduler,
          stopLogRotation.wait,
          stopRuntimeStorage.wait,
        ],
        markInterrupted: async () => interruptRunningDeployments(db, "Worker stop timed out; jobs safely interrupted"),
      });
      if (result.timedOut) console.error("[worker] shutdown drain timed out");
      else console.log("[worker] shutdown drain complete");
    })()
      .catch((error) => {
        console.error("[worker] graceful shutdown failed", error);
        process.exitCode = 1;
      })
      .finally(() => {
        // Signal handlers keep the event loop alive; exit once drain finishes.
        process.exit(process.exitCode ?? 0);
      });
    return shutdownPromise;
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void start().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exitCode = 1;
});
