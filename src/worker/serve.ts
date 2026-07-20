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
