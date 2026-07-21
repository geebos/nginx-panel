import { and, eq } from "drizzle-orm";
import { deploymentSteps } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";

type AppDb = AppEnv["Variables"]["db"];

const finishedStatuses = ["succeeded", "failed", "skipped"] as const;

/**
 * Shared deployment step status update (runner, config-test, log rotator).
 * - running → startedAt
 * - succeeded | failed | skipped → finishedAt
 * - logExcerpt is only written when explicitly provided (omit preserves existing value)
 */
export async function updateDeploymentStep(
	db: AppDb,
	deploymentId: string,
	sequence: number,
	status: string,
	message?: string,
	logExcerpt?: string,
) {
	await db
		.update(deploymentSteps)
		.set({
			status,
			message,
			...(logExcerpt !== undefined ? { logExcerpt } : {}),
			...(status === "running" ? { startedAt: Date.now() } : {}),
			...(finishedStatuses.includes(status as (typeof finishedStatuses)[number])
				? { finishedAt: Date.now() }
				: {}),
		})
		.where(
			and(
				eq(deploymentSteps.deploymentId, deploymentId),
				eq(deploymentSteps.sequence, sequence),
			),
		);
}
