import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  certificates,
  configVersions,
  deploymentSteps,
  deployments,
  domainConfigSchema,
  domains,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { renderDomainConfig, renderRootConfig } from "@/worker/lib/nginx/config";

const execFileAsync = promisify(execFile);
const activeConfigTests = new Set<Promise<void>>();

const stepNames = ["Generate candidate config", "Validate files and targets", "Run nginx -t"];

class DraftChangedError extends Error {}

async function retry<T>(operation: () => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function redactRuntimePath(value: string, candidateRoot: string) {
  return value.split(candidateRoot).join("<candidate>");
}

async function updateStep(
  db: AppEnv["Variables"]["db"],
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
      logExcerpt,
      ...(status === "running" ? { startedAt: Date.now() } : {}),
      ...(["succeeded", "failed"].includes(status) ? { finishedAt: Date.now() } : {}),
    })
    .where(and(eq(deploymentSteps.deploymentId, deploymentId), eq(deploymentSteps.sequence, sequence)));
}

export async function createConfigTestDeployment(
  db: AppEnv["Variables"]["db"],
  input: { domainId: string; versionId: string; requestedBy: string; idempotencyKey: string; expectedSnapshotChecksum: string },
) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  const id = randomUUID();
  const now = Date.now();
  await db.transaction((tx) => {
    const domain = tx.select().from(domains).where(and(eq(domains.id, input.domainId), isNull(domains.deletedAt))).get();
    const version = tx.select().from(configVersions).where(and(eq(configVersions.id, input.versionId), eq(configVersions.domainId, input.domainId))).get();
    if (!domain || !version) throw new BusinessError("errors:versionNotFound", 404, "VERSION_NOT_FOUND");
    if (domain.draftVersionId !== version.id || version.status !== "draft" || version.snapshotChecksum !== input.expectedSnapshotChecksum) {
      throw new BusinessError("errors:draftChanged", 409, "DRAFT_CHANGED");
    }
    tx.insert(deployments).values({
      id,
      domainId: input.domainId,
      configVersionId: input.versionId,
      type: "test",
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      inputJson: JSON.stringify({ expectedSnapshotChecksum: input.expectedSnapshotChecksum }),
      requestedBy: input.requestedBy,
      createdAt: now,
    }).run();
    for (const [sequence, name] of stepNames.entries()) {
      tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
    }
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

async function executeConfigTest(db: AppEnv["Variables"]["db"], deploymentId: string) {
  let candidateRoot: string | undefined;
  try {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
    if (!deployment || deployment.status !== "queued") return;
    if (!deployment.domainId || !deployment.configVersionId) {
      throw new Error("Test job is missing domain or config version");
    }
    const targetDomain = await db.query.domains.findFirst({ where: and(eq(domains.id, deployment.domainId), isNull(domains.deletedAt)) });
    const targetVersion = await db.query.configVersions.findFirst({ where: eq(configVersions.id, deployment.configVersionId) });
    const input = JSON.parse(deployment.inputJson ?? "null") as { expectedSnapshotChecksum?: string } | null;
    if (!targetDomain) throw new Error("Test target domain does not exist or was deleted");
    if (!targetVersion || targetVersion.domainId !== targetDomain.id) {
      throw new Error("Test target config version does not exist");
    }
    if (targetDomain.draftVersionId !== targetVersion.id || targetVersion.status !== "draft" || targetVersion.snapshotChecksum !== input?.expectedSnapshotChecksum) {
      throw new DraftChangedError("Draft content has changed; review Diff again");
    }

    candidateRoot = await mkdtemp(join(tmpdir(), `nginx-manager-test-${deploymentId}-`));
    await db.update(deployments).set({ status: "running", startedAt: Date.now() }).where(eq(deployments.id, deploymentId));
    await updateStep(db, deploymentId, 0, "running");
    const domainRows = await db.select().from(domains).where(and(
      isNull(domains.deletedAt),
      or(isNotNull(domains.activeVersionId), eq(domains.id, targetDomain.id)),
    ));
    const selected = domainRows
      .map((domain) => ({ ...domain, sourceVersionId: domain.id === targetDomain.id ? targetVersion.id : domain.activeVersionId! }));
    const versionRows = await db.select().from(configVersions).where(inArray(
      configVersions.id,
      selected.map((domain) => domain.sourceVersionId),
    ));
    const versionsById = new Map(versionRows.map((version) => [version.id, version]));
    const snapshotsByVersionId = new Map(versionRows.map((version) => [
      version.id,
      domainConfigSchema.parse(JSON.parse(version.snapshotJson)),
    ]));
    const certificateIds = [...new Set([...snapshotsByVersionId.values()]
      .filter((snapshot) => snapshot.ssl.enabled)
      .map((snapshot) => snapshot.ssl.certificateId)
      .filter((value): value is string => Boolean(value)))];
    const certificateRows = certificateIds.length
      ? await db.select().from(certificates).where(inArray(certificates.id, certificateIds))
      : [];
    const certificatesById = new Map(certificateRows.map((certificate) => [certificate.id, certificate]));
    const logsRoot = join(candidateRoot, "logs");
    await mkdir(join(candidateRoot, "domains"), { recursive: true });
    await mkdir(logsRoot, { recursive: true });
    const rootConfig = renderRootConfig({ pidPath: join(candidateRoot, "nginx.pid") });
    await writeFile(join(candidateRoot, "nginx.conf"), rootConfig);
    for (const domain of selected) {
      const version = versionsById.get(domain.sourceVersionId);
      if (!version) throw new Error("Candidate version does not exist");
      const snapshot = snapshotsByVersionId.get(version.id)!;
      const certificate = snapshot.ssl.enabled && snapshot.ssl.certificateId
        ? certificatesById.get(snapshot.ssl.certificateId)
        : undefined;
      if (snapshot.ssl.enabled && snapshot.ssl.certificateId && (!certificate || certificate.domainId !== domain.id || !["ready", "active"].includes(certificate.status))) {
        throw new Error("Referenced certificate asset is unavailable");
      }
      await mkdir(join(logsRoot, snapshot.primaryHostname), { recursive: true });
      const rendered = renderDomainConfig({
        mode: "runtime",
        domainId: domain.id,
        snapshot,
        enabled: domain.id === targetDomain.id ? true : domain.enabled,
        logs: { root: logsRoot, errorLevel: "warn" },
        certificate: certificate ? { fullchainPath: certificate.certPath, privateKeyPath: certificate.keyPath } : undefined,
      });
      await writeFile(join(candidateRoot, "domains", `${domain.id}.conf`), rendered);
    }
    await updateStep(db, deploymentId, 0, "succeeded", `Generated ${selected.length} Domain configs`);
    await updateStep(db, deploymentId, 1, "running");
    await updateStep(db, deploymentId, 1, "succeeded", "Schema, path, and candidate file validation passed");
    await updateStep(db, deploymentId, 2, "running");
    const result = await execFileAsync(process.env.NGINX_BIN || "nginx", ["-p", `${candidateRoot}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    const output = redactRuntimePath(`${result.stdout}\n${result.stderr}`.trim(), candidateRoot).slice(0, 8_000);
    await updateStep(db, deploymentId, 2, "succeeded", "nginx -t passed", output);
    await db.update(deployments).set({ status: "succeeded", finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Config test failed";
    const message = candidateRoot ? redactRuntimePath(rawMessage, candidateRoot) : rawMessage;
    try {
      const steps = await retry(() => db.query.deploymentSteps.findMany({ where: eq(deploymentSteps.deploymentId, deploymentId) }));
      const failedStep = steps.find((step) => step.status === "running")
        ?? steps.sort((left, right) => left.sequence - right.sequence).find((step) => step.status === "pending");
      if (failedStep) {
        await retry(() => updateStep(db, deploymentId, failedStep.sequence, "failed", message, message.slice(0, 8_000)));
      }
    } catch (persistenceError) {
      console.error(`[config-test] failed to persist step failure for ${deploymentId}`, persistenceError);
    }
    try {
      await retry(() => db.update(deployments).set({ status: "failed", errorCode: error instanceof DraftChangedError ? "DRAFT_CHANGED" : "NGINX_TEST_FAILED", errorMessage: message, finishedAt: Date.now() }).where(eq(deployments.id, deploymentId)));
    } catch (persistenceError) {
      console.error(`[config-test] failed to persist deployment failure for ${deploymentId}; startup recovery will reconcile it`, persistenceError);
    }
  } finally {
    if (candidateRoot) {
      const root = candidateRoot;
      await retry(() => rm(root, { recursive: true, force: true })).catch((error) => {
        console.error(`[config-test] failed to remove candidate ${deploymentId}`, error);
      });
    }
  }
}

export function runConfigTest(db: AppEnv["Variables"]["db"], deploymentId: string) {
  const running = executeConfigTest(db, deploymentId);
  activeConfigTests.add(running);
  void running.then(
    () => activeConfigTests.delete(running),
    () => activeConfigTests.delete(running),
  );
  return running;
}

export function waitForConfigTests() {
  return Promise.allSettled([...activeConfigTests]);
}
