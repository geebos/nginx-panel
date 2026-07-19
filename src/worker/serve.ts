import { serve } from "@hono/node-server";
import { createApp } from "./index";
import { validateRuntimeEnv } from "./lib/runtime-env";
import { getSqliteDb } from "./db/engine";
import { startLogRotationScheduler } from "./logs/rotator";
import { setRuntimeState } from "./lib/runtime-state";
import { verifyRuntime } from "./lib/runtime-verifier";
import { resumeQueuedDeployments } from "./lib/deployment-resume";
import { startAcmeScheduler } from "./acme/scheduler";
import { startCertificateActivationCoordinator } from "./acme/activation";
import { startRenewalScheduler } from "./acme/renewal";

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
  startLogRotationScheduler(db);
  startAcmeScheduler(db);
  startCertificateActivationCoordinator(db);
  startRenewalScheduler(db);
  if (runtimeState.status !== "healthy") console.error(`[worker] runtime verification entered ${runtimeState.status}`);

  serve({ fetch: createApp().fetch, hostname, port }, (info) => {
    console.log(`[worker] listening on http://localhost:${info.port}`);
  });
}

void start().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exitCode = 1;
});
