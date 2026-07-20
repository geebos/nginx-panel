import { and, eq, inArray } from "drizzle-orm";
import { deploymentSteps, deployments } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";

export function interruptRunningDeployments(db: AppEnv["Variables"]["db"], message: string) {
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
      errorMessage: message,
      finishedAt: now,
    }).where(inArray(deployments.id, deploymentIds)).run();
    tx.update(deploymentSteps).set({
      status: "failed",
      message,
      finishedAt: now,
    }).where(and(
      inArray(deploymentSteps.deploymentId, deploymentIds),
      inArray(deploymentSteps.status, ["pending", "running"]),
    )).run();
  });
}

export function recoverInterruptedDeployments(db: AppEnv["Variables"]["db"]) {
  interruptRunningDeployments(db, "Job incomplete before worker restart");
}
