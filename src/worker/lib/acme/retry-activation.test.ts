import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/shared/schemas";
import { BusinessError } from "@/worker/lib/errors";
import { retryAcmeOrderActivation } from "@/worker/lib/acme/retry-activation";

function fixture(withActivation: boolean) {
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
	db.insert(schema.acmeOrders)
		.values({
			id: "order-1",
			domainId: "domain-1",
			validationMethod: "http-01",
			accountEmail: "admin@example.com",
			environment: "staging",
			status: "succeeded",
			identifiersJson: JSON.stringify(["example.com"]),
			cleanupStatus: "succeeded",
			idempotencyKey: "order-1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.certificates)
		.values({
			id: "certificate-1",
			domainId: "domain-1",
			acmeOrderId: "order-1",
			provider: "letsencrypt",
			environment: "staging",
			status: "ready",
			sansJson: JSON.stringify(["example.com"]),
			certPath: "/cert.pem",
			keyPath: "/key.pem",
			certFileChecksum: "cert",
			publicKeySpkiChecksum: "key",
			autoRenew: true,
			issuedAt: now,
		})
		.run();
	if (withActivation) {
		db.insert(schema.deployments)
			.values({
				id: "deployment-1",
				domainId: "domain-1",
				type: "deploy",
				status: "failed",
				idempotencyKey: "deploy-1",
				createdAt: now,
			})
			.run();
		db.insert(schema.deploymentSteps)
			.values({
				id: "step-1",
				deploymentId: "deployment-1",
				sequence: 0,
				name: "Generate candidate config",
				status: "failed",
			})
			.run();
		db.insert(schema.certificateActivations)
			.values({
				id: "activation-1",
				certificateId: "certificate-1",
				status: "created",
				deploymentId: "deployment-1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	}
	const order = db
		.select()
		.from(schema.acmeOrders)
		.where(eq(schema.acmeOrders.id, "order-1"))
		.get()!;
	return { connection, db, order };
}

test("retryAcmeOrderActivation throws when activation is missing", async () => {
	const { connection, db, order } = fixture(false);
	await assert.rejects(
		() => retryAcmeOrderActivation(db, order),
		(error: unknown) =>
			error instanceof BusinessError &&
			error.code === "CERTIFICATE_ACTIVATION_NOT_FOUND",
	);
	connection.close();
});

test("retryAcmeOrderActivation requeues the failed activation deployment", async () => {
	const { connection, db, order } = fixture(true);
	const enqueued: string[] = [];
	const result = await retryAcmeOrderActivation(
		db,
		order,
		async (_db, deploymentId) => {
			enqueued.push(deploymentId);
		},
	);
	assert.equal(result.deployment?.id, "deployment-1");
	assert.equal(result.deployment?.status, "queued");
	assert.deepEqual(enqueued, ["deployment-1"]);
	connection.close();
});
