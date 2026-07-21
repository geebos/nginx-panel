import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { updateDeploymentStep } from "@/worker/lib/deployment/update-step";

function fixture() {
	const connection = new Database(":memory:");
	connection.pragma("foreign_keys = ON");
	const db = drizzle(connection, { schema });
	migrate(db, { migrationsFolder: "./drizzle" });
	const now = Date.now();
	db.insert(schema.domains)
		.values({
			id: "domain-1",
			type: "domain",
			primaryHostname: "example.com",
			displayHostname: "example.com",
			enabled: true,
			runtimeStatus: "running",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.deployments)
		.values({
			id: "deployment-1",
			domainId: "domain-1",
			type: "deploy",
			status: "running",
			idempotencyKey: "deploy-1",
			createdAt: now,
		})
		.run();
	db.insert(schema.deploymentSteps)
		.values([
			{
				id: "step-0",
				deploymentId: "deployment-1",
				sequence: 0,
				name: "A",
				status: "pending",
			},
			{
				id: "step-1",
				deploymentId: "deployment-1",
				sequence: 1,
				name: "B",
				status: "pending",
				logExcerpt: "keep-me",
			},
		])
		.run();
	return { connection, db };
}

test("updateDeploymentStep sets startedAt for running", async () => {
	const { connection, db } = fixture();
	const before = Date.now();
	await updateDeploymentStep(db, "deployment-1", 0, "running");
	const step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-0"))
		.get();
	assert.equal(step?.status, "running");
	assert.ok((step?.startedAt ?? 0) >= before - 1_000);
	assert.equal(step?.finishedAt, null);
	connection.close();
});

test("updateDeploymentStep sets finishedAt for succeeded failed and skipped", async () => {
	const { connection, db } = fixture();
	await updateDeploymentStep(db, "deployment-1", 0, "succeeded", "ok");
	let step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-0"))
		.get();
	assert.equal(step?.status, "succeeded");
	assert.ok(step?.finishedAt);
	assert.equal(step?.message, "ok");

	await updateDeploymentStep(db, "deployment-1", 1, "failed", "boom");
	step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.get();
	assert.equal(step?.status, "failed");
	assert.ok(step?.finishedAt);
	assert.equal(step?.message, "boom");
	assert.equal(step?.logExcerpt, "keep-me");

	// reset step-1 finished for skipped path check on a fresh status write
	db.update(schema.deploymentSteps)
		.set({ status: "pending", finishedAt: null })
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.run();
	await updateDeploymentStep(db, "deployment-1", 1, "skipped", "nothing to do");
	step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.get();
	assert.equal(step?.status, "skipped");
	assert.ok(step?.finishedAt);
	connection.close();
});

test("updateDeploymentStep only writes logExcerpt when provided", async () => {
	const { connection, db } = fixture();
	await updateDeploymentStep(db, "deployment-1", 1, "running");
	let step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.get();
	assert.equal(step?.logExcerpt, "keep-me");

	await updateDeploymentStep(
		db,
		"deployment-1",
		1,
		"succeeded",
		"done",
		"new-excerpt",
	);
	step = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.get();
	assert.equal(step?.logExcerpt, "new-excerpt");
	connection.close();
});

test("updateDeploymentStep targets only the requested sequence", async () => {
	const { connection, db } = fixture();
	await updateDeploymentStep(db, "deployment-1", 0, "succeeded");
	const other = db
		.select()
		.from(schema.deploymentSteps)
		.where(eq(schema.deploymentSteps.id, "step-1"))
		.get();
	assert.equal(other?.status, "pending");
	assert.equal(other?.finishedAt, null);
	connection.close();
});
