import { and, asc, eq, inArray } from "drizzle-orm";
import { deploymentSteps, deployments } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { runConfigTest } from "./config-test-runner";
import { enqueueLogSettings, enqueuePublish, enqueueRebuildActive } from "./deployment-runner";
import { enqueueLogRotation } from "@/worker/logs/rotator";
import type { RuntimeState } from "./runtime-state";

async function rejectQueued(db: AppEnv["Variables"]["db"], deploymentId: string, code: string, message: string) {
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(deployments).set({ status: "failed", errorCode: code, errorMessage: message, finishedAt: now }).where(eq(deployments.id, deploymentId)).run();
    tx.update(deploymentSteps).set({ status: "failed", message, finishedAt: now }).where(and(
      eq(deploymentSteps.deploymentId, deploymentId),
      inArray(deploymentSteps.status, ["pending", "running"]),
    )).run();
  });
}

export async function resumeQueuedDeployments(db: AppEnv["Variables"]["db"], runtime: RuntimeState) {
  const queued = await db.query.deployments.findMany({
    where: eq(deployments.status, "queued"),
    orderBy: [asc(deployments.createdAt)],
  });
  for (const deployment of queued) {
    if (deployment.type === "test") {
      queueMicrotask(() => void runConfigTest(db, deployment.id));
    } else if (runtime.status === "healthy" && deployment.type === "deploy") {
      void enqueuePublish(db, deployment.id);
    } else if (runtime.status === "healthy" && deployment.type === "apply_log_settings") {
      void enqueueLogSettings(db, deployment.id);
    } else if (runtime.status === "healthy" && deployment.type === "rotate_logs") {
      void enqueueLogRotation(db, deployment.id);
    } else if (runtime.status === "degraded" && deployment.type === "rebuild_active") {
      void enqueueRebuildActive(db, deployment.id);
    } else {
      const degraded = runtime.status === "degraded";
      await rejectQueued(
        db,
        deployment.id,
        degraded ? "RUNTIME_DEGRADED" : "DEPLOYMENT_STATE_INVALID",
        degraded ? "Worker 重启后检测到运行配置不一致，任务未恢复" : "Worker 重启后任务已不适用于当前运行状态",
      );
    }
  }
}
