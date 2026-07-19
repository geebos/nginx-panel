import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  certificateActivations,
  certificates,
  configVersions,
  deploymentSteps,
  deployments,
  domainConfigSchema,
  domains,
  nginxLogSettingsSchema,
  settings,
  type NginxLogSettingsInput,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { getActiveLogSettings, logSettingsChecksum } from "./log-settings";
import { injectAccessLogFormat, renderDomainConfig } from "./nginx-config";
import { checksum, createRuntimeManifest } from "./runtime-manifest";
import { assertRuntimeMutable, getRuntimeState, setRuntimeDegraded, setRuntimeHealthy } from "./runtime-state";
import { createSnapshot } from "./snapshot";
import { BusinessError } from "./errors";
import { validateManagerTlsEnvironment } from "./manager-tls";
import { assertRuntimeStorageCapacity, cleanupRuntimeStorage } from "./runtime-storage";
import { touchJobRunnerHeartbeat } from "./service-lifecycle";

const execFileAsync = promisify(execFile);
const stepNames = ["Generate candidate config", "Validate files and targets", "Run nginx -t", "Activate revision", "Reload Nginx", "Run health checks", "Commit active version"];
let runnerTail = Promise.resolve();

class RebuildSourceError extends Error {
  override name = "RebuildSourceError";
}

function runtimePaths() {
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new Error("发布只允许在 nginx-manager runtime 中执行");
  const root = process.env.NGINX_RUNTIME_ROOT || "/data/nginx";
  const logsRoot = process.env.NGINX_LOG_DIR;
  if (!logsRoot) throw new Error("NGINX_LOG_DIR 未设置");
  return { root, logsRoot, active: join(root, "active"), candidates: join(root, "candidates"), revisions: join(root, "revisions") };
}

async function updateStep(db: AppEnv["Variables"]["db"], deploymentId: string, sequence: number, status: string, message?: string, logExcerpt?: string) {
  await db.update(deploymentSteps).set({
    status, message, logExcerpt,
    ...(status === "running" ? { startedAt: Date.now() } : {}),
    ...(["succeeded", "failed"].includes(status) ? { finishedAt: Date.now() } : {}),
  }).where(and(eq(deploymentSteps.deploymentId, deploymentId), eq(deploymentSteps.sequence, sequence)));
}

async function renderRuntimeRoot(logSettings: Awaited<ReturnType<typeof getActiveLogSettings>>) {
  const templatePath = process.env.NGINX_TEMPLATE_FILE || "/etc/nginx/templates/nginx-manager.conf.template";
  let rendered = await readFile(templatePath, "utf8");
  if (process.env.APP_ENV !== "development") {
    const required = ["MANAGER_HOST", "MANAGER_TLS_CERT_FILE", "MANAGER_TLS_KEY_FILE"] as const;
    for (const name of required) if (!process.env[name]) throw new Error(`${name} 未设置`);
    rendered = rendered.replace(/\$\{(MANAGER_HOST|MANAGER_TLS_CERT_FILE|MANAGER_TLS_KEY_FILE)\}/g, (_, name: typeof required[number]) => process.env[name]!);
  }
  return injectAccessLogFormat(rendered, logSettings);
}

export async function createPublishDeployment(db: AppEnv["Variables"]["db"], input: { domainId: string; versionId: string; requestedBy: string; idempotencyKey: string; expectedSnapshotChecksum: string; preflightDeploymentId: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  assertRuntimeMutable();
  await assertRuntimeStorageCapacity(db);
  const id = randomUUID();
  const now = Date.now();
  db.transaction((tx) => {
    const domain = tx.select().from(domains).where(and(eq(domains.id, input.domainId), isNull(domains.deletedAt))).get();
    const version = tx.select().from(configVersions).where(and(eq(configVersions.id, input.versionId), eq(configVersions.domainId, input.domainId))).get();
    const preflight = tx.select().from(deployments).where(eq(deployments.id, input.preflightDeploymentId)).get();
    if (!domain || !version) throw new BusinessError("发布目标不存在", 404, "VERSION_NOT_FOUND");
    if (!domain.enabled) throw new BusinessError("Domain 已停用，请先启用", 409, "DOMAIN_DISABLED");
    const preflightInput = preflight?.inputJson ? JSON.parse(preflight.inputJson) as { expectedSnapshotChecksum?: string } : null;
    const validPreflight = preflight?.type === "test"
      && preflight.status === "succeeded"
      && preflight.domainId === domain.id
      && preflight.configVersionId === version.id
      && preflightInput?.expectedSnapshotChecksum === input.expectedSnapshotChecksum
      && domain.draftVersionId === version.id
      && version.status === "draft"
      && version.snapshotChecksum === input.expectedSnapshotChecksum;
    if (!validPreflight) throw new BusinessError("测试结果已过期，请重新测试", 409, "PREFLIGHT_STALE");
    tx.insert(deployments).values({ id, domainId: input.domainId, configVersionId: input.versionId, previousVersionId: domain.activeVersionId, type: "deploy", status: "queued", idempotencyKey: input.idempotencyKey, inputJson: JSON.stringify({ expectedSnapshotChecksum: input.expectedSnapshotChecksum, preflightDeploymentId: input.preflightDeploymentId }), requestedBy: input.requestedBy, createdAt: now }).run();
    for (const [sequence, name] of stepNames.entries()) tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export async function createCertificateDeployment(db: AppEnv["Variables"]["db"], input: { domainId: string; versionId: string; certificateId: string }) {
  const idempotencyKey = `activate-certificate:${input.certificateId}`;
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, idempotencyKey) });
  if (existing) return existing;
  assertRuntimeMutable();
  await assertRuntimeStorageCapacity(db);
  const id = randomUUID();
  const now = Date.now();
  db.transaction((tx) => {
    const domain = tx.select().from(domains).where(and(eq(domains.id, input.domainId), isNull(domains.deletedAt))).get();
    const version = tx.select().from(configVersions).where(and(eq(configVersions.id, input.versionId), eq(configVersions.domainId, input.domainId), eq(configVersions.sourceCertificateId, input.certificateId))).get();
    const certificate = tx.select().from(certificates).where(and(eq(certificates.id, input.certificateId), eq(certificates.domainId, input.domainId), eq(certificates.status, "ready"))).get();
    if (!domain || !version || !certificate || version.status !== "pending") throw new BusinessError("证书激活目标不存在", 409, "CERTIFICATE_ACTIVATION_TARGET_INVALID");
    tx.insert(deployments).values({
      id,
      domainId: input.domainId,
      configVersionId: input.versionId,
      previousVersionId: domain.activeVersionId,
      type: "deploy",
      status: "queued",
      idempotencyKey,
      inputJson: JSON.stringify({ expectedSnapshotChecksum: version.snapshotChecksum, sourceCertificateId: input.certificateId }),
      createdAt: now,
    }).run();
    for (const [sequence, name] of stepNames.entries()) tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export async function createRollbackDeployment(db: AppEnv["Variables"]["db"], input: { domainId: string; sourceVersionId: string; requestedBy: string; idempotencyKey: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return { deployment: existing, version: null };
  assertRuntimeMutable();
  await assertRuntimeStorageCapacity(db);
  const deploymentId = randomUUID();
  const versionId = randomUUID();
  const now = Date.now();
  let createdVersion!: typeof configVersions.$inferSelect;
  db.transaction((tx) => {
    const domain = tx.select().from(domains).where(and(eq(domains.id, input.domainId), isNull(domains.deletedAt))).get();
    const source = tx.select().from(configVersions).where(and(eq(configVersions.id, input.sourceVersionId), eq(configVersions.domainId, input.domainId))).get();
    if (!domain || !source) throw new BusinessError("回滚目标不存在", 404, "VERSION_NOT_FOUND");
    if (!domain.enabled) throw new BusinessError("Domain 已停用，请先启用", 409, "DOMAIN_DISABLED");
    if (!domain.activeVersionId) throw new BusinessError("Domain 尚未发布，不能回滚", 409, "DOMAIN_NO_ACTIVE_VERSION");
    if (domain.draftVersionId) throw new BusinessError("当前有未发布草稿，请先发布或处理草稿后再回滚", 409, "DRAFT_EXISTS");
    const latest = tx.select({ versionNumber: configVersions.versionNumber }).from(configVersions)
      .where(eq(configVersions.domainId, input.domainId)).orderBy(desc(configVersions.versionNumber)).limit(1).get();
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    tx.insert(configVersions).values({
      id: versionId,
      domainId: input.domainId,
      versionNumber,
      status: "draft",
      sourceVersionId: source.id,
      changeSummary: `回滚到 v${source.versionNumber}`,
      snapshotJson: source.snapshotJson,
      snapshotChecksum: source.snapshotChecksum,
      createdBy: input.requestedBy,
      createdAt: now,
      updatedAt: now,
    }).run();
    tx.update(domains).set({ draftVersionId: versionId, updatedAt: now }).where(eq(domains.id, domain.id)).run();
    tx.insert(deployments).values({
      id: deploymentId,
      domainId: input.domainId,
      configVersionId: versionId,
      previousVersionId: domain.activeVersionId,
      type: "rollback",
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      inputJson: JSON.stringify({ sourceVersionId: source.id, sourceVersionNumber: source.versionNumber }),
      requestedBy: input.requestedBy,
      createdAt: now,
    }).run();
    for (const [sequence, name] of stepNames.entries()) {
      tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId, sequence, name, status: "pending" }).run();
    }
    createdVersion = tx.select().from(configVersions).where(eq(configVersions.id, versionId)).get()!;
  });
  return {
    deployment: (await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) }))!,
    version: createdVersion,
  };
}

export async function createLogSettingsDeployment(db: AppEnv["Variables"]["db"], input: { settings: NginxLogSettingsInput; requestedBy: string; idempotencyKey: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  assertRuntimeMutable();
  await assertRuntimeStorageCapacity(db);
  const active = await getActiveLogSettings(db);
  const candidate = nginxLogSettingsSchema.parse({ ...input.settings, revision: active.revision + 1, updatedAt: Date.now() });
  const id = randomUUID();
  const names = [...stepNames];
  names[6] = "Commit log settings";
  db.transaction((tx) => {
    tx.insert(deployments).values({ id, type: "apply_log_settings", status: "queued", idempotencyKey: input.idempotencyKey, inputJson: JSON.stringify(candidate), requestedBy: input.requestedBy, createdAt: Date.now() }).run();
    for (const [sequence, name] of names.entries()) tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export async function createRebuildActiveDeployment(db: AppEnv["Variables"]["db"], input: { requestedBy: string; idempotencyKey: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  if (getRuntimeState().status !== "degraded") throw new Error("运行配置当前不需要重建");
  await assertRuntimeStorageCapacity(db);
  const id = randomUUID();
  const names = [...stepNames];
  names[0] = "Validate SQLite sources";
  names[6] = "Clear degraded state";
  db.transaction((tx) => {
    tx.insert(deployments).values({ id, type: "rebuild_active", status: "queued", idempotencyKey: input.idempotencyKey, requestedBy: input.requestedBy, createdAt: Date.now() }).run();
    for (const [sequence, name] of names.entries()) tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

const managerTlsStepNames = [
  "Validate mounted certificate",
  "Run active nginx -t",
  "Reload Nginx",
  "Verify manager HTTPS",
  "Finalize",
];

export async function createReloadManagerTlsDeployment(db: AppEnv["Variables"]["db"], input: { requestedBy: string; idempotencyKey: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(deployments).values({ id, type: "reload_manager_tls", status: "queued", idempotencyKey: input.idempotencyKey, requestedBy: input.requestedBy, createdAt: Date.now() }).run();
    for (const [sequence, name] of managerTlsStepNames.entries()) {
      tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence, name, status: "pending" }).run();
    }
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export async function createDiagnosticNginxTestDeployment(db: AppEnv["Variables"]["db"], input: { requestedBy: string; idempotencyKey: string }) {
  const existing = await db.query.deployments.findFirst({ where: eq(deployments.idempotencyKey, input.idempotencyKey) });
  if (existing) return existing;
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(deployments).values({ id, type: "diagnostic_test", status: "queued", idempotencyKey: input.idempotencyKey, requestedBy: input.requestedBy, createdAt: Date.now() }).run();
    tx.insert(deploymentSteps).values({ id: randomUUID(), deploymentId: id, sequence: 0, name: "Run active nginx -t", status: "pending" }).run();
  });
  return (await db.query.deployments.findFirst({ where: eq(deployments.id, id) }))!;
}

export function enqueueRuntimeOperation(label: string, operation: () => Promise<void>) {
  const running = runnerTail.then(async () => {
    touchJobRunnerHeartbeat();
    try {
      await operation();
    } finally {
      touchJobRunnerHeartbeat();
    }
  });
  runnerTail = running.catch((error) => console.error(`[${label}] unhandled runtime failure`, error));
  return running;
}

export function waitForRuntimeOperations() {
  return runnerTail;
}

export function enqueuePublish(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("deploy", () => runPublish(db, deploymentId));
}

export function enqueueLogSettings(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("log-settings", () => runPublish(db, deploymentId));
}

export function enqueueRebuildActive(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("rebuild-active", () => runPublish(db, deploymentId));
}

export function enqueueReloadManagerTls(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("reload-manager-tls", () => runReloadManagerTls(db, deploymentId));
}

export function enqueueDiagnosticNginxTest(db: AppEnv["Variables"]["db"], deploymentId: string) {
  return enqueueRuntimeOperation("diagnostic-nginx-test", () => runDiagnosticNginxTest(db, deploymentId));
}

function redactDiagnosticOutput(value: string, paths: ReturnType<typeof runtimePaths>) {
  const replacements = [
    [paths.active, "<runtime>/active"],
    [paths.root, "<runtime>"],
    [paths.logsRoot, "<logs>"],
    [process.env.CERTIFICATE_DATA_ROOT || "/data/certs", "<certificates>"],
    [process.env.DB_SQLITE_DIR, "<sqlite>"],
    [process.env.MANAGER_TLS_CERT_FILE, "<manager-certificate>"],
    [process.env.MANAGER_TLS_KEY_FILE, "<manager-private-key>"],
  ].filter((item): item is [string, string] => Boolean(item[0])).sort((left, right) => right[0].length - left[0].length);
  let redacted = value;
  for (const [path, placeholder] of replacements) redacted = redacted.split(path).join(placeholder);
  return redacted.replace(/(^|[\s'"(])\/(?!\/)[^\s'"),;]+/gm, "$1<absolute-path>").slice(0, 8_000);
}

async function runDiagnosticNginxTest(db: AppEnv["Variables"]["db"], deploymentId: string) {
  let paths: ReturnType<typeof runtimePaths> | undefined;
  try {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
    if (!deployment || deployment.status !== "queued" || deployment.type !== "diagnostic_test") return;
    paths = runtimePaths();
    await db.update(deployments).set({ status: "running", startedAt: Date.now() }).where(eq(deployments.id, deploymentId));
    await updateStep(db, deploymentId, 0, "running");
    const result = await execFileAsync(process.env.NGINX_BIN || "/usr/sbin/nginx", ["-p", `${paths.active}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    const output = redactDiagnosticOutput(`${result.stdout}\n${result.stderr}`.trim(), paths);
    await updateStep(db, deploymentId, 0, "succeeded", "Active 配置测试通过", output);
    await db.update(deployments).set({ status: "succeeded", finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Active 配置测试失败";
    const message = paths ? redactDiagnosticOutput(raw, paths) : "Active 配置测试失败";
    await updateStep(db, deploymentId, 0, "failed", message, message);
    await db.update(deployments).set({ status: "failed", errorCode: "NGINX_TEST_FAILED", errorMessage: message, finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  }
}

function verifyManagerHttps(hostname: string) {
  return new Promise<void>((resolve, reject) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port: 8443,
      path: "/api/health",
      method: "GET",
      servername: hostname,
      headers: { host: hostname },
      timeout: 5_000,
    }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error(`管理端 HTTPS 验证返回 ${response.statusCode ?? "未知状态"}`));
    });
    request.on("timeout", () => request.destroy(new Error("管理端 HTTPS 验证超时")));
    request.on("error", reject);
    request.end();
  });
}

async function runReloadManagerTls(db: AppEnv["Variables"]["db"], deploymentId: string) {
  try {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
    if (!deployment || deployment.status !== "queued" || deployment.type !== "reload_manager_tls") return;
    const paths = runtimePaths();
    const nginx = process.env.NGINX_BIN || "/usr/sbin/nginx";
    await db.update(deployments).set({ status: "running", startedAt: Date.now() }).where(eq(deployments.id, deploymentId));

    await updateStep(db, deploymentId, 0, "running");
    const certificate = validateManagerTlsEnvironment();
    await updateStep(db, deploymentId, 0, "succeeded", `证书有效，截止 ${new Date(certificate.validTo).toISOString()}`);

    await updateStep(db, deploymentId, 1, "running");
    await execFileAsync(nginx, ["-p", `${paths.active}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    await updateStep(db, deploymentId, 1, "succeeded", "Active 配置测试通过");

    await updateStep(db, deploymentId, 2, "running");
    await execFileAsync(nginx, ["-p", `${paths.active}/`, "-s", "reload", "-c", "nginx.conf"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    await updateStep(db, deploymentId, 2, "succeeded", "Nginx graceful reload 已完成");

    await updateStep(db, deploymentId, 3, "running");
    await verifyManagerHttps(certificate.hostname);
    await updateStep(db, deploymentId, 3, "succeeded", "管理端 HTTPS 验证通过");

    await updateStep(db, deploymentId, 4, "running");
    await updateStep(db, deploymentId, 4, "succeeded", "管理端 TLS 已重新加载");
    await db.update(deployments).set({ status: "succeeded", finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理端 TLS 重新加载失败";
    const pending = await db.query.deploymentSteps.findFirst({ where: and(eq(deploymentSteps.deploymentId, deploymentId), inArray(deploymentSteps.status, ["pending", "running"])) });
    if (pending) await updateStep(db, deploymentId, pending.sequence, "failed", message, message.slice(0, 8_000));
    await db.update(deployments).set({ status: "failed", errorCode: "MANAGER_TLS_INVALID", errorMessage: message, finishedAt: Date.now() }).where(eq(deployments.id, deploymentId));
  }
}

async function runPublish(db: AppEnv["Variables"]["db"], deploymentId: string) {
  const paths = runtimePaths();
  const candidate = join(paths.candidates, deploymentId);
  const revision = join(paths.revisions, deploymentId);
  let previousTarget: string | undefined;
  let activated = false;
  let completed = false;
  let rebuildActive = false;
  try {
    const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
    if (!deployment || deployment.status !== "queued") return;
    rebuildActive = deployment.type === "rebuild_active";
    const appliesLogSettings = deployment.type === "apply_log_settings";
    if (!rebuildActive && !appliesLogSettings && (!["deploy", "rollback"].includes(deployment.type) || !deployment.domainId || !deployment.configVersionId)) return;
    if (!rebuildActive) assertRuntimeMutable();
    else if (getRuntimeState().status !== "degraded") throw new Error("运行配置当前不需要重建");
    await assertRuntimeStorageCapacity(db);
    const publishInput = deployment.type === "deploy"
      ? JSON.parse(deployment.inputJson ?? "null") as { expectedSnapshotChecksum?: string; sourceCertificateId?: string } | null
      : null;
    const certificateActivation = Boolean(publishInput?.sourceCertificateId);
    if (deployment.type === "deploy") {
      const targetDomain = await db.query.domains.findFirst({ where: eq(domains.id, deployment.domainId!) });
      const targetVersion = await db.query.configVersions.findFirst({ where: eq(configVersions.id, deployment.configVersionId!) });
      const validTarget = certificateActivation
        ? targetVersion?.status === "pending" && targetVersion.sourceCertificateId === publishInput?.sourceCertificateId
        : targetDomain?.draftVersionId === targetVersion?.id && targetVersion?.status === "draft";
      if (!targetDomain || !targetVersion || !validTarget || targetVersion.snapshotChecksum !== publishInput?.expectedSnapshotChecksum) {
        throw new Error("发布目标草稿已变化");
      }
    }
    if (deployment.type === "rollback") {
      const targetDomain = await db.query.domains.findFirst({ where: eq(domains.id, deployment.domainId!) });
      const targetVersion = await db.query.configVersions.findFirst({ where: eq(configVersions.id, deployment.configVersionId!) });
      if (!targetDomain || !targetVersion || targetDomain.draftVersionId !== targetVersion.id || targetVersion.status !== "draft") {
        throw new Error("回滚目标版本已变化");
      }
    }
    const logSettings = appliesLogSettings
      ? nginxLogSettingsSchema.parse(JSON.parse(deployment.inputJson ?? "null"))
      : await getActiveLogSettings(db);
    if (appliesLogSettings) {
      const active = await getActiveLogSettings(db);
      if (logSettings.revision !== active.revision + 1) throw new Error("日志设置 revision 已过期");
    }
    await db.update(deployments).set({ status: "running", startedAt: Date.now() }).where(eq(deployments.id, deploymentId));
    await updateStep(db, deploymentId, 0, "running");
    if (rebuildActive) {
      const integrity = await db.all<{ integrity_check: string }>(sql.raw("PRAGMA integrity_check"));
      if (integrity.some((row) => row.integrity_check !== "ok")) throw new RebuildSourceError("SQLite integrity check 未通过");
    }
    const domainRows = await db.select().from(domains).where(
      appliesLogSettings || rebuildActive
        ? and(isNull(domains.deletedAt), isNotNull(domains.activeVersionId))
        : and(isNull(domains.deletedAt), or(isNotNull(domains.activeVersionId), eq(domains.id, deployment.domainId!))),
    );
    const selected = domainRows.map((domain) => ({
      ...domain,
      sourceVersionId: !appliesLogSettings && !rebuildActive && domain.id === deployment.domainId ? deployment.configVersionId! : domain.activeVersionId!,
    }));
    const versions = await db.select().from(configVersions).where(inArray(configVersions.id, selected.map((item) => item.sourceVersionId)));
    const byId = new Map(versions.map((version) => [version.id, version]));
    const snapshots = new Map(versions.map((version) => [version.id, domainConfigSchema.parse(JSON.parse(version.snapshotJson))]));
    const certificateIds = [...new Set([...snapshots.values()].map((snapshot) => snapshot.ssl.certificateId).filter((value): value is string => Boolean(value)))];
    const certificateRows = certificateIds.length ? await db.select().from(certificates).where(inArray(certificates.id, certificateIds)) : [];
    const certificatesById = new Map(certificateRows.map((certificate) => [certificate.id, certificate]));
    await mkdir(join(candidate, "domains"), { recursive: true });
    const rootConfig = await renderRuntimeRoot(logSettings);
    await writeFile(join(candidate, "nginx.conf"), rootConfig, { mode: 0o640 });
    const manifestDomains: Record<string, { sourceVersionId: string; snapshotChecksum: string; enabled: boolean; certificateId: string | null; configChecksum: string }> = {};
    for (const domain of selected) {
      const version = byId.get(domain.sourceVersionId);
      if (!version) throw new RebuildSourceError("Active 配置版本缺失");
      const snapshot = snapshots.get(version.id)!;
      if (createSnapshot(snapshot).checksum !== version.snapshotChecksum) throw new RebuildSourceError("Active 配置快照 checksum 无效");
      const certificate = snapshot.ssl.certificateId ? certificatesById.get(snapshot.ssl.certificateId) : undefined;
      if (snapshot.ssl.certificateId && (!certificate || certificate.domainId !== domain.id || !["ready", "active"].includes(certificate.status))) throw new RebuildSourceError("配置引用的证书资产不可用");
      await mkdir(join(paths.logsRoot, snapshot.primaryHostname), { recursive: true });
      const enabled = !appliesLogSettings && !rebuildActive && domain.id === deployment.domainId && !certificateActivation ? true : domain.enabled;
      const config = renderDomainConfig({ mode: "runtime", domainId: domain.id, snapshot, enabled, logs: { root: paths.logsRoot, errorLevel: logSettings.errorLevel }, listeners: { http: 8080, https: 8443 }, certificate: certificate ? { fullchainPath: certificate.certPath, privateKeyPath: certificate.keyPath } : undefined });
      await writeFile(join(candidate, "domains", `${domain.id}.conf`), config, { mode: 0o640 });
      manifestDomains[domain.id] = { sourceVersionId: version.id, snapshotChecksum: version.snapshotChecksum, enabled, certificateId: snapshot.ssl.certificateId ?? null, configChecksum: checksum(config) };
    }
    const manifest = createRuntimeManifest({ rootConfig, logSettings: { revision: logSettings.revision, checksum: logSettingsChecksum(logSettings) }, rootInputs: { logsRoot: paths.logsRoot, runtimeRoot: paths.root }, domains: manifestDomains });
    await writeFile(join(candidate, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
    await updateStep(db, deploymentId, 0, "succeeded", rebuildActive ? `SQLite 来源校验通过，生成 ${selected.length} 个 Domain 配置` : `生成 ${selected.length} 个 Domain 配置`);
    await updateStep(db, deploymentId, 1, "running");
    await updateStep(db, deploymentId, 1, "succeeded", "Schema、路径和 checksum 校验通过");
    await updateStep(db, deploymentId, 2, "running");
    const nginx = process.env.NGINX_BIN || "/usr/sbin/nginx";
    await execFileAsync(nginx, ["-p", `${candidate}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000, maxBuffer: 128 * 1024 });
    await updateStep(db, deploymentId, 2, "succeeded", "候选配置测试通过");
    await updateStep(db, deploymentId, 3, "running");
    previousTarget = await readlink(paths.active);
    await rename(candidate, revision);
    const next = join(paths.root, `.active-${deploymentId}`);
    await symlink(`revisions/${deploymentId}`, next);
    await rename(next, paths.active);
    activated = true;
    await execFileAsync(nginx, ["-p", `${paths.active}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000 });
    await updateStep(db, deploymentId, 3, "succeeded", "Runtime revision 已原子激活");
    await updateStep(db, deploymentId, 4, "running");
    await execFileAsync(nginx, ["-p", `${paths.active}/`, "-s", "reload", "-c", "nginx.conf"], { timeout: 10_000 });
    await updateStep(db, deploymentId, 4, "succeeded", "Nginx graceful reload 已完成");
    await updateStep(db, deploymentId, 5, "running");
    const response = await fetch("http://127.0.0.1:8082/internal/health", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("管理端健康检查失败");
    await updateStep(db, deploymentId, 5, "succeeded", "管理端健康检查通过");
    await updateStep(db, deploymentId, 6, "running");
    db.transaction((tx) => {
      if (appliesLogSettings) {
        tx.insert(settings).values({ key: "nginx_logs", valueJson: JSON.stringify(logSettings), updatedAt: logSettings.updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(logSettings), updatedAt: logSettings.updatedAt } }).run();
      } else if (!rebuildActive) {
        const activatedAt = Date.now();
        tx.update(configVersions).set({ status: "superseded" }).where(and(eq(configVersions.domainId, deployment.domainId!), eq(configVersions.status, "active"))).run();
        tx.update(configVersions).set({ status: "active" }).where(eq(configVersions.id, deployment.configVersionId!)).run();
        tx.update(domains).set({ activeVersionId: deployment.configVersionId, ...(!certificateActivation ? { draftVersionId: null, enabled: true } : {}), runtimeStatus: "running", updatedAt: activatedAt }).where(eq(domains.id, deployment.domainId!)).run();
        const committedSnapshot = snapshots.get(deployment.configVersionId!);
        if (committedSnapshot?.ssl.certificateId) {
          tx.update(certificates).set({ autoRenew: committedSnapshot.ssl.autoRenew }).where(eq(certificates.id, committedSnapshot.ssl.certificateId)).run();
        }
        if (publishInput?.sourceCertificateId) {
          tx.update(certificates).set({ status: "superseded" }).where(and(eq(certificates.domainId, deployment.domainId!), eq(certificates.status, "active"))).run();
          tx.update(certificates).set({ status: "active", activatedAt }).where(eq(certificates.id, publishInput.sourceCertificateId)).run();
          tx.update(certificateActivations).set({ updatedAt: activatedAt }).where(eq(certificateActivations.certificateId, publishInput.sourceCertificateId)).run();
        }
      }
      tx.update(deployments).set({ status: "succeeded", finishedAt: Date.now() }).where(eq(deployments.id, deploymentId)).run();
    });
    if (rebuildActive) setRuntimeHealthy(deploymentId);
    await updateStep(db, deploymentId, 6, "succeeded", rebuildActive ? "Runtime 已按 SQLite 重建并恢复健康" : appliesLogSettings ? `日志设置 revision ${logSettings.revision} 已提交` : "Active Version 已提交");
    void cleanupRuntimeStorage(db).catch((error) => console.error("[runtime-storage] post-deployment cleanup failed", error));
    completed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布失败";
    if (rebuildActive) {
      setRuntimeDegraded([{ code: "ACTIVE_REBUILD_FAILED", message: "按 SQLite 重建未完成，运行配置仍处于 degraded 状态" }]);
    }
    let recoveryFailed = false;
    if (activated && previousTarget) {
      const recovery = join(paths.root, `.active-recovery-${deploymentId}`);
      try {
        await symlink(previousTarget, recovery);
        await rename(recovery, paths.active);
        await execFileAsync(process.env.NGINX_BIN || "/usr/sbin/nginx", ["-p", `${paths.active}/`, "-t", "-c", "nginx.conf"], { timeout: 10_000 });
        await execFileAsync(process.env.NGINX_BIN || "/usr/sbin/nginx", ["-p", `${paths.active}/`, "-s", "reload", "-c", "nginx.conf"], { timeout: 10_000 });
      } catch {
        recoveryFailed = true;
        setRuntimeDegraded([{ code: "RECOVERY_FAILED", message: "发布恢复失败，运行配置需要人工重建" }]);
      }
    }
    const pending = await db.query.deploymentSteps.findFirst({ where: and(eq(deploymentSteps.deploymentId, deploymentId), inArray(deploymentSteps.status, ["pending", "running"])) });
    if (pending) await updateStep(db, deploymentId, pending.sequence, "failed", message, message.slice(0, 8_000));
    await db.update(deployments).set({
      status: "failed",
      errorCode: recoveryFailed ? "RECOVERY_FAILED" : rebuildActive && error instanceof RebuildSourceError ? "ACTIVE_REBUILD_SOURCE_UNAVAILABLE" : rebuildActive ? "ACTIVE_REBUILD_FAILED" : activated ? "NGINX_RELOAD_FAILED" : "NGINX_TEST_FAILED",
      errorMessage: message,
      finishedAt: Date.now(),
    }).where(eq(deployments.id, deploymentId));
    const failedDeployment = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
    if (failedDeployment?.type === "rollback" && failedDeployment.configVersionId && failedDeployment.domainId) {
      db.transaction((tx) => {
        tx.update(configVersions).set({ status: "failed", updatedAt: Date.now() }).where(eq(configVersions.id, failedDeployment.configVersionId!)).run();
        tx.update(domains).set({ draftVersionId: null, updatedAt: Date.now() })
          .where(and(eq(domains.id, failedDeployment.domainId!), eq(domains.draftVersionId, failedDeployment.configVersionId!))).run();
      });
    }
  } finally {
    if (!rebuildActive || completed) await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
  }
}
