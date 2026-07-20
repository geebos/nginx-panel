import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { acmeOrders, certificateActivations, certificates, configVersions, deploymentSteps, deployments, domainAliases, domainConfigSchema, domains } from "@/shared/schemas";
import { createCertificateDeployment, enqueuePublish } from "@/worker/lib/deployment/runner";
import { createSnapshot } from "@/worker/lib/snapshot";
import type { AppEnv } from "@/worker/types";

const running = new Set<string>();
let coordinator: ReturnType<typeof setInterval> | null = null;
let coordinatorTail = Promise.resolve();

function scheduleActivationRun(db: AppEnv["Variables"]["db"]) {
  const run = coordinatorTail.then(() => runCertificateActivationOnce(db));
  coordinatorTail = run.catch((error) => console.error("[certificate-activation] coordinator failed", error instanceof Error ? error.name : "unknown"));
  return run;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Certificate activation creation failed";
  return message.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 500);
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase().replace(/\.$/, "")))].sort();
}

function sameHostnames(left: string[], right: string[]) {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

async function ensureActivations(db: AppEnv["Variables"]["db"]) {
  const ready = await db.select({ id: certificates.id }).from(certificates).where(eq(certificates.status, "ready"));
  const now = Date.now();
  for (const certificate of ready) {
    await db.insert(certificateActivations).values({
      id: randomUUID(),
      certificateId: certificate.id,
      status: "pending",
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: certificateActivations.certificateId });
  }
}

export async function processCertificateActivation(db: AppEnv["Variables"]["db"], activationId: string, enqueue: typeof enqueuePublish = enqueuePublish) {
  if (running.has(activationId)) return;
  running.add(activationId);
  try {
    const activation = await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.id, activationId) });
    if (!activation || !["pending", "failed"].includes(activation.status)) return;
    const certificate = await db.query.certificates.findFirst({ where: and(eq(certificates.id, activation.certificateId), eq(certificates.status, "ready")) });
    if (!certificate) throw new Error("Ready certificate does not exist");
    const order = await db.query.acmeOrders.findFirst({ where: eq(acmeOrders.id, certificate.acmeOrderId) });
    const domain = await db.query.domains.findFirst({ where: and(eq(domains.id, certificate.domainId), isNull(domains.deletedAt)) });
    if (!order || !domain) throw new Error("Certificate source order or domain does not exist");
    const aliases = await db.select({ hostname: domainAliases.hostname }).from(domainAliases).where(eq(domainAliases.domainId, domain.id));
    const certificateSans = JSON.parse(certificate.sansJson) as string[];
    if (!sameHostnames([domain.primaryHostname, ...aliases.map((alias) => alias.hostname)], certificateSans)) throw new Error("Current domain hostnames do not match certificate SANs");

    const baseVersionId = domain.activeVersionId ?? order.unpublishedBaseVersionId;
    if (!baseVersionId) throw new Error("Certificate activation baseline version does not exist");
    const baseVersion = await db.query.configVersions.findFirst({ where: and(eq(configVersions.id, baseVersionId), eq(configVersions.domainId, domain.id)) });
    if (!baseVersion) throw new Error("Certificate activation baseline version does not exist");
    const baseConfig = domainConfigSchema.parse(JSON.parse(baseVersion.snapshotJson));
    if (!sameHostnames([baseConfig.primaryHostname, ...baseConfig.aliases], certificateSans)) throw new Error("Baseline version hostnames do not match certificate SANs");

    let version = await db.query.configVersions.findFirst({ where: eq(configVersions.sourceCertificateId, certificate.id) });
    if (!version) {
      const config = domainConfigSchema.parse({ ...baseConfig, ssl: { ...baseConfig.ssl, enabled: true, certificateId: certificate.id } });
      const snapshot = createSnapshot(config);
      const now = Date.now();
      version = db.transaction((tx) => {
        const existing = tx.select().from(configVersions).where(eq(configVersions.sourceCertificateId, certificate.id)).get();
        if (existing) return existing;
        const latest = tx.select({ versionNumber: configVersions.versionNumber }).from(configVersions)
          .where(eq(configVersions.domainId, domain.id)).orderBy(asc(configVersions.versionNumber)).all().at(-1);
        const created = {
          id: randomUUID(),
          domainId: domain.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          status: "pending",
          sourceVersionId: baseVersion.id,
          sourceCertificateId: certificate.id,
          changeSummary: "Activate newly issued certificate",
          snapshotJson: snapshot.json,
          snapshotChecksum: snapshot.checksum,
          createdAt: now,
          updatedAt: now,
        } satisfies typeof configVersions.$inferInsert;
        tx.insert(configVersions).values(created).run();
        return tx.select().from(configVersions).where(eq(configVersions.id, created.id)).get()!;
      });
    }

    const deployment = await createCertificateDeployment(db, { domainId: domain.id, versionId: version.id, certificateId: certificate.id });
    const now = Date.now();
    await db.update(certificateActivations).set({ status: "created", configVersionId: version.id, deploymentId: deployment.id, errorCode: null, errorMessage: null, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(certificateActivations.id, activation.id), inArray(certificateActivations.status, ["pending", "failed"])));
    if (deployment.status === "queued") void enqueue(db, deployment.id);
  } catch (error) {
    await db.update(certificateActivations).set({ status: "failed", errorCode: "CERTIFICATE_ACTIVATION_FAILED", errorMessage: safeError(error), nextAttemptAt: null, updatedAt: Date.now() })
      .where(eq(certificateActivations.id, activationId));
  } finally {
    running.delete(activationId);
  }
}

export async function runCertificateActivationOnce(db: AppEnv["Variables"]["db"], enqueue: typeof enqueuePublish = enqueuePublish) {
  await ensureActivations(db);
  const now = Date.now();
  const activations = await db.select({ id: certificateActivations.id }).from(certificateActivations).where(and(
    eq(certificateActivations.status, "pending"),
    or(isNull(certificateActivations.nextAttemptAt), lte(certificateActivations.nextAttemptAt, now)),
  )).orderBy(asc(certificateActivations.createdAt)).limit(10);
  await Promise.all(activations.map((activation) => processCertificateActivation(db, activation.id, enqueue)));
}

export async function retryCertificateActivation(db: AppEnv["Variables"]["db"], activationId: string, enqueue: typeof enqueuePublish = enqueuePublish) {
  const activation = await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.id, activationId) });
  if (!activation) throw new Error("Certificate activation does not exist");
  if (activation.status === "failed") {
    const now = Date.now();
    await db.update(certificateActivations).set({ status: "pending", errorCode: null, errorMessage: null, nextAttemptAt: now, updatedAt: now }).where(eq(certificateActivations.id, activation.id));
    await processCertificateActivation(db, activation.id, enqueue);
  } else if (activation.status === "created" && activation.deploymentId) {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, activation.deploymentId) });
    if (deployment?.status === "failed") {
      db.transaction((tx) => {
        tx.update(deployments).set({ status: "queued", errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }).where(eq(deployments.id, deployment.id)).run();
        tx.update(deploymentSteps).set({ status: "pending", message: null, logExcerpt: null, startedAt: null, finishedAt: null }).where(eq(deploymentSteps.deploymentId, deployment.id)).run();
      });
      void enqueue(db, deployment.id);
    }
  }
  const refreshed = await db.query.certificateActivations.findFirst({ where: eq(certificateActivations.id, activation.id) });
  const deployment = refreshed?.deploymentId ? await db.query.deployments.findFirst({ where: eq(deployments.id, refreshed.deploymentId) }) : null;
  return { activation: refreshed!, deployment };
}

export function startCertificateActivationCoordinator(db: AppEnv["Variables"]["db"]) {
  if (coordinator) return () => undefined;
  void scheduleActivationRun(db);
  coordinator = setInterval(() => void scheduleActivationRun(db), 5_000);
  coordinator.unref?.();
  return () => {
    if (coordinator) clearInterval(coordinator);
    coordinator = null;
  };
}

export function waitForCertificateActivationCoordinator() {
  return coordinatorTail;
}
