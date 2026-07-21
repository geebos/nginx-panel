import { eq } from "drizzle-orm";
import {
	acmeOrders,
	certificateActivations,
	certificates,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { retryCertificateActivation } from "@/worker/lib/acme/activation";
import { BusinessError } from "@/worker/lib/errors";

type AppDb = AppEnv["Variables"]["db"];

/**
 * Shared activation-retry policy for domain + manager certificate orders.
 * Callers load and authorize the order; this function resolves activation and requeues.
 */
export async function retryAcmeOrderActivation(
	db: AppDb,
	order: typeof acmeOrders.$inferSelect,
	enqueue?: Parameters<typeof retryCertificateActivation>[2],
) {
	const certificate = await db.query.certificates.findFirst({
		where: eq(certificates.acmeOrderId, order.id),
	});
	const activation = certificate
		? await db.query.certificateActivations.findFirst({
				where: eq(certificateActivations.certificateId, certificate.id),
			})
		: null;
	if (!activation) {
		throw new BusinessError(
			"errors:certificateActivationNotFound",
			409,
			"CERTIFICATE_ACTIVATION_NOT_FOUND",
		);
	}
	return retryCertificateActivation(db, activation.id, enqueue);
}
