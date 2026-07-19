import { and, eq, inArray } from "drizzle-orm";
import { deploymentSteps, deployments } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";

export function recoverInterruptedDeployments(db: AppEnv["Variables"]["db"]) {
  const now = Date.now();
  db.transaction((tx) => {
    const deploymentIds = tx.select({ id: deployments.id }).from(deployments)
      .where(eq(deployments.status, "running"))
      .all()
      .map((deployment) => deployment.id);
    if (!deploymentIds.length) return;
    tx.update(deployments).set({
      status: "failed",
      errorCode: "WORKER_INTERRUPTED",
      errorMessage: "Worker 重启前任务未完成",
      finishedAt: now,
    }).where(inArray(deployments.id, deploymentIds)).run();
    tx.update(deploymentSteps).set({
      status: "failed",
      message: "Worker 重启前任务未完成",
      finishedAt: now,
    }).where(and(
      inArray(deploymentSteps.deploymentId, deploymentIds),
      inArray(deploymentSteps.status, ["pending", "running"]),
    )).run();
  });
}
