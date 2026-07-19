import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rename, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { deploymentSteps, deployments, domains } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { enqueueRuntimeOperation } from "@/worker/lib/deployment-runner";
import { getActiveLogSettings } from "@/worker/lib/log-settings";
import { assertRuntimeMutable, getRuntimeState } from "@/worker/lib/runtime-state";
import { controlledLogPath } from "./path";

const execFileAsync = promisify(execFile);
const stepNames = ["Inspect log files", "Rotate files", "Reopen Nginx", "Commit rotation"];

type RotationInput = { domainId?: string; force: boolean };
type RotatedFile = { path: string; retainedFiles: number; backupPath: string };

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function updateStep(db: AppEnv["Variables"]["db"], deploymentId: string, sequence: number, status: string, message?: string) {
  await db.update(deploymentSteps).set({
    status,
    message,
    ...(status === "running" ? { startedAt: Date.now() } : {}),
    ...(["succeeded", "failed", "skipped"].includes(status) ? { finishedAt: Date.now() } : {}),
  }).where(and(eq(deploymentSteps.deploymentId, deploymentId), eq(deploymentSteps.sequence, sequence)));
}

export async function createLogRotationDeployment(
  db: AppEnv["Variables"]["db"],
  input: { domainId?: string; requestedBy?: string; idempotencyKey: string; force: boolean },
) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  assertRuntimeMutable();
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(deployments).values({
      id,
      domainId: input.domainId,
      type: "rotate_logs",
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      inputJson: JSON.stringify({ domainId: input.domainId, force: input.force } satisfies RotationInput),
      requestedBy: input.requestedBy,
      createdAt: Date.now(),
    }).run();
    for (const [sequence, name] of stepNames.entries()) {
      tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
    }
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export async function rotateFile(path: string, retainedFiles: number) {
  const backupPath = `${path}.${retainedFiles}.rotation-backup`;
  await rm(backupPath, { force: true });
  await rename(`${path}.${retainedFiles}`, backupPath).catch((error) => {
    if (!isMissing(error)) throw error;
  });
  for (let index = retainedFiles - 1; index >= 1; index -= 1) {
    await rename(`${path}.${index}`, `${path}.${index + 1}`).catch((error) => {
      if (!isMissing(error)) throw error;
    });
  }
  await rename(path, `${path}.1`);
  return { path, retainedFiles, backupPath };
}

export async function restoreFile(file: RotatedFile) {
  const current = await stat(file.path).catch(() => null);
  if (current && current.size > 0) return false;
  await rm(file.path, { force: true });
  await rename(`${file.path}.1`, file.path).catch(() => undefined);
  for (let index = 2; index <= file.retainedFiles; index += 1) {
    await rename(`${file.path}.${index}`, `${file.path}.${index - 1}`).catch(() => undefined);
  }
  await rename(file.backupPath, `${file.path}.${file.retainedFiles}`).catch(() => undefined);
  return true;
}

async function waitForCurrentFiles(files: RotatedFile[]) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ready = await Promise.all(files.map((file) => stat(file.path).then(() => true).catch(() => false)));
    if (ready.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Nginx reopen 后未创建新的日志文件");
}

async function rotationCandidates(db: AppEnv["Variables"]["db"], input: RotationInput) {
  const logRoot = process.env.NGINX_LOG_DIR;
  if (!logRoot) throw new Error("NGINX_LOG_DIR 未设置");
  const settings = await getActiveLogSettings(db);
  const domainRows = await db.select().from(domains).where(and(
    isNull(domains.deletedAt),
    isNotNull(domains.activeVersionId),
    ...(input.domainId ? [eq(domains.id, input.domainId)] : []),
  ));
  const paths: string[] = [];
  for (const domain of domainRows) {
    for (const type of ["access", "error"] as const) {
      const path = controlledLogPath(logRoot, domain.primaryHostname, `${type}.log`);
      const info = await stat(path).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (info && info.size > 0 && (input.force || info.size >= settings.maxFileSizeMiB * 1024 * 1024)) paths.push(path);
    }
  }
  return { paths, retainedFiles: settings.retainedFiles };
}

async function runLogRotation(db: AppEnv["Variables"]["db"], deploymentId: string) {
  const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
  if (!deployment || deployment.status !== "queued" || deployment.type !== "rotate_logs") return;
  const input = JSON.parse(deployment.inputJson ?? "{}") as RotationInput;
  const rotated: RotatedFile[] = [];
  try {
    await db.update(deployments).set({ status: "running", startedAt: Date.now() }).where(eq(deployments.id, deploymentId));
    await updateStep(db, deploymentId, 0, "running");
    const candidates = await rotationCandidates(db, input);
    await updateStep(db, deploymentId, 0, "succeeded", `发现 ${candidates.paths.length} 个待轮动文件`);
    await updateStep(db, deploymentId, 1, "running");
    for (const path of candidates.paths) rotated.push(await rotateFile(path, candidates.retainedFiles));
    await updateStep(db, deploymentId, 1, "succeeded", `已轮动 ${rotated.length} 个文件`);
    if (rotated.length) {
      await updateStep(db, deploymentId, 2, "running");
      const runtimeRoot = process.env.NGINX_RUNTIME_ROOT || "/data/nginx";
      await execFileAsync(process.env.NGINX_BIN || "/usr/sbin/nginx", ["-p", `${runtimeRoot}/active/`, "-s", "reopen", "-c", "nginx.conf"], { timeout: 10_000 });
      await waitForCurrentFiles(rotated);
      await Promise.all(rotated.map((file) => rm(file.backupPath, { force: true })));
      await updateStep(db, deploymentId, 2, "succeeded", "Nginx 已 reopen 并创建当前日志文件");
    } else {
      await updateStep(db, deploymentId, 2, "skipped", "没有需要轮动的日志文件");
    }
    await updateStep(db, deploymentId, 3, "running");
    await db.update(deployments).set({ status: "succeeded", finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
    await updateStep(db, deploymentId, 3, "succeeded", "日志轮动已完成");
  } catch (error) {
    await Promise.all(rotated.map(restoreFile));
    const message = error instanceof Error ? error.message : "日志轮动失败";
    const pending = await db.query.deploymentSteps.findFirst({ where: and(eq(deploymentSteps.deploymentId, deploymentId), isNull(deploymentSteps.finishedAt)) });
    if (pending) await updateStep(db, deploymentId, pending.sequence, "failed", message);
    await db.update(deployments).set({ status: "failed", errorCode: "LOG_ROTATION_FAILED", errorMessage: message, finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  }
}

export function enqueueLogRotation(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("log-rotation", () => runLogRotation(db, deploymentId));
}

export function startLogRotationScheduler(db: AppEnv["Variables"]["db"]) {
  let checking = false;
  let stopped = false;
  let schedulerTail = Promise.resolve();
  const interval = setInterval(() => {
    if (stopped || checking || process.env.RUNTIME_MODE !== "nginx-manager" || getRuntimeState().status !== "healthy") return;
    checking = true;
    schedulerTail = (async () => {
      const pending = await db.query.deployments.findFirst({
        where: and(eq(deployments.type, "rotate_logs"), inArray(deployments.status, ["queued", "running"])),
      });
      if (pending) return;
      const candidates = await rotationCandidates(db, { force: false });
      if (!candidates.paths.length) return;
      const deployment = await createLogRotationDeployment(db, {
        idempotencyKey: `automatic-log-rotation-${Math.floor(Date.now() / 30_000)}`,
        force: false,
      });
      if (!stopped && deployment.status === "queued") void enqueueLogRotation(db, deployment.id);
    })().catch((error) => console.error("[log-rotation] scheduled check failed", error instanceof Error ? error.name : "unknown")).finally(() => {
      checking = false;
    });
  }, 30_000);
  interval.unref();
  const stop = () => { stopped = true; clearInterval(interval); };
  Object.assign(stop, { wait: () => schedulerTail });
  return stop as typeof stop & { wait: () => Promise<void> };
}
