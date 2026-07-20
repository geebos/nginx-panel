import type { CreateDomainInput, DomainConfig, LogStreamRecord, LogType, NginxLogSettings, NginxLogSettingsInput, RouteConfig, SessionPolicy } from "@/shared/schemas";
import { type AppLocale, type Messages } from "@/i18n/settings";
import { consumeNdjsonStream } from "@/lib/log-stream";

export type ErrorParams = Record<string, string | number>;

export type ApiErrorPayload = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
  minimumBytes?: number;
  /** i18next interpolation map for message key. */
  params?: ErrorParams;
};

export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors?: Record<string, string[]>;
  params?: ErrorParams;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.fieldErrors = payload.fieldErrors;
    this.params = payload.params;
  }
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!input.startsWith("/api/")) {
    throw new Error("errors:apiPathInvalid");
  }
  return globalThis.fetch(input, { credentials: "same-origin", ...init });
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const fallback: ApiErrorPayload = {
      code: "REQUEST_FAILED",
      message: "errors:requestFailed",
    };
    const payload = (await response.json().catch(() => fallback)) as ApiErrorPayload;
    throw new ApiError(payload, response.status);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// 按 locale 拉取后端错误 message 翻译（errors 命名空间）。失败时返回空对象，
// 让前端 t() 回退到 key 字符串本身（不阻塞渲染）。
export async function getErrorMessages(locale: AppLocale): Promise<Messages> {
  try {
    const result = await requestJson<{ errors: Messages }>(
      `/api/i18n/messages/${locale}`,
    );
    return result.errors ?? {};
  } catch {
    return {};
  }
}

export type DomainListItem = {
  id: string;
  primaryHostname: string;
  displayHostname: string;
  aliases: string[];
  enabled: boolean;
  runtimeStatus: string;
  activeVersionId: string | null;
  draftVersionId: string | null;
  createdAt: number;
  updatedAt: number;
  draftChanged: boolean;
};

export type SslStatus = "active" | "pending" | "disabled";

export type DomainListResponse = {
  items: (DomainListItem & { sslStatus: SslStatus })[];
  page: number;
  pageSize: number;
  total: number;
};

export type DashboardResponse = {
  refreshedAt: number;
  domains: { enabled: number; total: number; drafts: number; failed: number };
  certificates: { active: number; expiring: number; failed: number; renewing: number; waitingManual: number };
  nginx: { status: string; version: string | null; checkedAt: number | null };
  runtime: RuntimeDiagnostics["runtime"];
  lastDeployment: DeploymentSummary | null;
  recentDeployments: DeploymentSummary[];
  recentDomains: Omit<DomainListItem, "aliases" | "draftChanged">[];
  renewalAttention: Array<{ orderId: string; domainId: string; hostname: string; createdAt: number }>;
};

export type DeploymentSummary = {
  id: string;
  domainId: string | null;
  configVersionId: string | null;
  type: string;
  status: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type DomainOverviewResponse = {
  domain: DomainListItem;
  config: DomainConfig | null;
  draftVersion: VersionSummary | null;
  activeVersion: VersionSummary | null;
  recentDeployments: DeploymentSummary[];
};

export type VersionSummary = {
  id: string;
  domainId: string;
  versionNumber: number;
  status: string;
  changeSummary: string;
  snapshotChecksum: string;
  createdAt: number;
  updatedAt: number;
};

export function getDashboard() {
  return requestJson<DashboardResponse>("/api/dashboard");
}

export function getDomains(params: URLSearchParams) {
  return requestJson<DomainListResponse>(`/api/domains?${params.toString()}`);
}

export function getDomain(id: string) {
  return requestJson<DomainOverviewResponse>(`/api/domains/${encodeURIComponent(id)}`);
}

export function createDomain(input: CreateDomainInput) {
  return requestJson<{
    domainId: string;
    version: { versionId: string; versionNumber: number; snapshotChecksum: string };
  }>("/api/domains", { method: "POST", body: JSON.stringify(input) });
}

export function deleteDomain(id: string) {
  return requestJson<void>(`/api/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type ConfigVersionResponse = {
  id: string;
  domainId: string;
  versionNumber: number;
  status: string;
  sourceVersionId: string | null;
  changeSummary: string;
  snapshotChecksum: string;
  createdAt: number;
  updatedAt: number;
};

export function createConfigVersion(
  domainId: string,
  input: { config: DomainConfig; changeSummary: string },
  expectedChecksum: string,
) {
  return requestJson<{ changed: boolean; mode: "created" | "updated" | "unchanged"; version: ConfigVersionResponse }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions`,
    {
      method: "POST",
      headers: { "If-Match": `"${expectedChecksum}"` },
      body: JSON.stringify(input),
    },
  );
}

export function getDomainVersions(domainId: string) {
  return requestJson<{ items: ConfigVersionResponse[] }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions`,
  );
}

export function getDomainVersion(domainId: string, versionId: string) {
  return requestJson<{
    version: ConfigVersionResponse;
    config: DomainConfig;
    nginxPreview: string;
  }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}`,
  );
}

export function getDomainVersionDiff(domainId: string, versionId: string, baseVersionId: string) {
  return requestJson<{
    base: ConfigVersionResponse;
    target: ConfigVersionResponse;
    changes: Array<{ section: string; kind: "added" | "removed" | "changed"; label: string; before?: string; after?: string }>;
    baseJson: string;
    targetJson: string;
    baseNginx: string;
    targetNginx: string;
  }>(`/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}/diff?base=${encodeURIComponent(baseVersionId)}`);
}

export type PublishPreviewResponse = {
  domainId: string;
  baseVersion: ConfigVersionResponse | null;
  targetVersion: ConfigVersionResponse;
  targetSnapshotChecksum: string;
  changes: Array<{ section: string; kind: "added" | "removed" | "changed"; label: string; before?: string; after?: string }>;
  baseJson: string | null;
  targetJson: string;
  baseNginx: string | null;
  targetNginx: string;
};

export function getPublishPreview(domainId: string, versionId: string, signal?: AbortSignal) {
  return requestJson<PublishPreviewResponse>(
    `/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}/publish-preview`,
    { signal },
  );
}

export function testDomainVersion(domainId: string, versionId: string, expectedSnapshotChecksum: string, idempotencyKey = crypto.randomUUID()) {
  return requestJson<{ deploymentId: string; statusUrl: string }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}/test`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ expectedSnapshotChecksum }) },
  );
}

export function deployDomainVersion(domainId: string, versionId: string, expectedSnapshotChecksum: string, preflightDeploymentId: string, idempotencyKey = crypto.randomUUID()) {
  return requestJson<{ deploymentId: string; statusUrl: string }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}/deploy`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ expectedSnapshotChecksum, preflightDeploymentId }) },
  );
}

export function rollbackDomainVersion(domainId: string, versionId: string, idempotencyKey = crypto.randomUUID()) {
  return requestJson<{ deploymentId: string; versionId: string; versionNumber: number | null; statusUrl: string }>(
    `/api/domains/${encodeURIComponent(domainId)}/versions/${encodeURIComponent(versionId)}/rollback`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
  );
}

export type CertificateOrderSummary = {
  id: string;
  domainId: string;
  replacesCertificateId: string | null;
  validationMethod: string;
  dnsProvider: string | null;
  accountEmail: string;
  environment: string;
  status: string;
  cleanupStatus: string;
  identifiers: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CertificateSummary = {
  id: string;
  domainId: string;
  acmeOrderId: string;
  provider: string;
  environment: string;
  status: string;
  sans: string[];
  notBefore: number | null;
  notAfter: number | null;
  autoRenew: boolean;
  issuedAt: number | null;
  activatedAt: number | null;
  nextCheckAt: number | null;
  lastErrorCode: string | null;
  primaryHostname: string;
  domainEnabled: boolean;
  activeVersionId: string | null;
};

export function getCertificates() {
  return requestJson<{ items: CertificateSummary[] }>("/api/certificates");
}

export function getDomainCertificateOrders(domainId: string) {
  return requestJson<{ items: CertificateOrderSummary[] }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders`);
}

export function getCertificateOrder(domainId: string, orderId: string) {
  return requestJson<{ order: CertificateOrderSummary; challenges: Array<{ id: string; hostname: string; type: string; status: string; dnsRecordName: string | null; dnsRecordValue: string | null; expiresAt: number }>; certificate: CertificateSummary | null; activation: { status: string; configVersionId: string | null; deploymentId: string | null; errorMessage: string | null } | null; deployment: DeploymentSummary & { errorMessage: string | null } | null }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders/${encodeURIComponent(orderId)}`);
}

export function getDomainCertificates(domainId: string) {
  return requestJson<{ items: CertificateSummary[] }>(`/api/domains/${encodeURIComponent(domainId)}/certificates`);
}

export function createCertificateOrder(domainId: string, input: { accountEmail: string; environment: "staging" | "production"; validation: DomainConfig["ssl"]["validation"] }, idempotencyKey = crypto.randomUUID()) {
  return requestJson<{ order: CertificateOrderSummary }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) });
}

export function renewCertificate(domainId: string, idempotencyKey = crypto.randomUUID()) {
  return requestJson<{ order: CertificateOrderSummary }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/renew`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey } });
}

export function cancelCertificateOrder(domainId: string, orderId: string) {
  return requestJson<{ order: CertificateOrderSummary }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
}

export function recheckCertificateOrder(domainId: string, orderId: string) {
  return requestJson<{ order: CertificateOrderSummary; debounced: boolean }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders/${encodeURIComponent(orderId)}/recheck`, { method: "POST" });
}

export function retryCertificateActivation(domainId: string, orderId: string) {
  return requestJson<{ activation: { status: string }; deployment: DeploymentSummary | null }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders/${encodeURIComponent(orderId)}/activation/retry`, { method: "POST" });
}

export function retryCloudflareCleanup(domainId: string, orderId: string) {
  return requestJson<{ order: CertificateOrderSummary }>(`/api/domains/${encodeURIComponent(domainId)}/certificate/orders/${encodeURIComponent(orderId)}/cleanup/retry`, { method: "POST" });
}

export type DeploymentDetailResponse = {
  deployment: DeploymentSummary & {
    idempotencyKey: string;
    errorCode: string | null;
    errorMessage: string | null;
  };
  steps: Array<{
    id: string;
    sequence: number;
    name: string;
    status: string;
    message: string | null;
    logExcerpt: string | null;
    startedAt: number | null;
    finishedAt: number | null;
  }>;
};

export function getDeployments() {
  return requestJson<{ items: DeploymentSummary[] }>("/api/deployments");
}

export function getDeployment(id: string) {
  return requestJson<DeploymentDetailResponse>(`/api/deployments/${encodeURIComponent(id)}`);
}

export type LogDomainItem = { id: string; hostname: string; enabled: boolean; activeVersionId: string | null };
export type LogRecord = { id: string; domainId: string; hostname: string; type: "access" | "error"; timestamp: string | null; parsed: boolean; raw: string; fields: Record<string, string | number | null> };

export function getLogDomains() {
  return requestJson<{ items: LogDomainItem[] }>("/api/logs/domains");
}

export type LogFilters = { keyword?: string; method?: string; status?: number };

function appendLogFilters(params: URLSearchParams, filters: LogFilters) {
  if (filters.keyword) params.set("keyword", filters.keyword);
  if (filters.method) params.set("method", filters.method);
  if (filters.status) params.set("status", String(filters.status));
}

export function getLogs(input: { domainId: string; types: LogType[]; limit?: number } & LogFilters) {
  const params = new URLSearchParams({ domainId: input.domainId, types: input.types.join(","), limit: String(input.limit ?? 200) });
  appendLogFilters(params, input);
  return requestJson<{ items: LogRecord[]; truncated: boolean; unpublished: boolean }>(`/api/logs/history?${params.toString()}`);
}

export async function followLogs(
  input: { domainId: string; types: LogType[] } & LogFilters,
  signal: AbortSignal,
  onRecord: (record: LogStreamRecord) => void,
  onMalformed?: (line: string) => void,
) {
  const params = new URLSearchParams({ domainId: input.domainId, types: input.types.join(","), follow: "true" });
  appendLogFilters(params, input);
  const response = await apiFetch(`/api/logs/follow?${params.toString()}`, {
    headers: { Accept: "application/x-ndjson" },
    signal,
  });
  if (!response.ok) {
    const fallback: ApiErrorPayload = { code: "LOG_STREAM_FAILED", message: `实时日志连接失败 (${response.status})` };
    const payload = (await response.json().catch(() => fallback)) as ApiErrorPayload;
    throw new ApiError(payload, response.status);
  }
  if (!response.body) throw new Error("浏览器不支持实时日志流");
  await consumeNdjsonStream(response.body, onRecord, onMalformed);
}

export function getLogSettings() {
  return requestJson<{
    active: NginxLogSettings;
    pendingDeploymentId: string | null;
    preview: string;
    logRootConfigured: boolean;
  }>("/api/settings/logs");
}

export function updateLogSettings(input: NginxLogSettingsInput) {
  return requestJson<{ deploymentId: string; statusUrl: string }>("/api/settings/logs", {
    method: "PUT",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export type CloudflareCredentialSummary = {
  id: string;
  name: string;
  tokenLast4: string;
  cloudflareTokenId: string | null;
  status: string;
  expiresAt: number | null;
  visibleZoneCount: number | null;
  lastVerifiedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export function getCloudflareCredentials() {
  return requestJson<{ items: CloudflareCredentialSummary[] }>("/api/settings/cloudflare");
}

export function createCloudflareCredential(input: { name: string; token: string }) {
  return requestJson<{ credential: CloudflareCredentialSummary }>("/api/settings/cloudflare", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function replaceCloudflareCredentialToken(id: string, token: string) {
  return requestJson<{ credential: CloudflareCredentialSummary }>(`/api/settings/cloudflare/${encodeURIComponent(id)}/token`, {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
}

export function deleteCloudflareCredential(id: string) {
  return requestJson<void>(`/api/settings/cloudflare/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function changePassword(input: { currentPassword: string; newPassword: string; confirmPassword: string }) {
  return requestJson<{ user: AuthUser }>("/api/settings/security/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeAllSessions() {
  return requestJson<void>("/api/auth/sessions/revoke-all", { method: "POST" });
}

export function getSessionPolicy() {
  return requestJson<{ policy: SessionPolicy }>("/api/settings/security/session-policy");
}

export function updateSessionPolicy(policy: SessionPolicy) {
  return requestJson<{ policy: SessionPolicy }>("/api/settings/security/session-policy", {
    method: "PATCH",
    body: JSON.stringify(policy),
  });
}

export type RuntimeStorageSummary = {
  usedBytes: number;
  maxBytes: number;
  minimumAllowedBytes: number;
  projectedBytes: number;
  candidateRequiredBytes: number;
  filesystemAvailableBytes: number | null;
  locked: boolean;
  retainedRevisionCount: number;
  protectedRevisionIds: string[];
};

export type NginxSettingsResponse = {
  nginx: { version: string | null };
  paths: { configRoot: string; staticAllowedRoots: string[] };
  storage: RuntimeStorageSummary;
  health: {
    status: "checking" | "healthy" | "degraded";
    checkedAt: number | null;
    activeRevision: string | null;
    issues: Array<{ code: string; message: string }>;
  };
};

export function getNginxSettings() {
  return requestJson<NginxSettingsResponse>("/api/settings/nginx");
}

export function updateNginxSettings(revisionMaxBytes: number) {
  return requestJson<{ storage: RuntimeStorageSummary }>("/api/settings/nginx", {
    method: "PATCH",
    body: JSON.stringify({ revisionMaxBytes }),
  });
}

export function rotateLogs(domainId?: string) {
  return requestJson<{ deploymentId: string; statusUrl: string }>("/api/logs/rotate", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(domainId ? { domainId } : {}),
  });
}

export type RuntimeDiagnostics = {
  runtime: {
    status: "checking" | "healthy" | "degraded";
    checkedAt: number | null;
    activeRevision: string | null;
    issues: Array<{ code: string; message: string }>;
  };
  rebuildAvailable: boolean;
  managerTls: {
    status: "valid" | "invalid" | "unavailable";
    certificate?: {
      hostname: string;
      subject: string;
      issuer: string;
      subjectAltName: string;
      validFrom: number;
      validTo: number;
      fingerprint256: string;
    };
    error?: string;
  };
  storage: Array<{
    key: "sqlite" | "runtime" | "certificates" | "logs" | "revisions";
    label: string;
    path: string;
    status: "available" | "missing" | "unconfigured" | "unreadable";
    itemBytes: number | null;
    filesystem: { totalBytes: number; freeBytes: number; availableBytes: number } | null;
  }>;
  logRoots: {
    current: { path: string; readable: boolean } | null;
    historical: Array<{ path: string; readable: boolean }>;
  };
  worker: { status: "running"; uptimeSeconds: number; pid: number };
};

export type ActiveRuntimeConfig = {
  domain: { id: string; hostname: string };
  revision: string;
  file: string;
  config: string;
  checksums: { source: string; config: string; actualConfig: string };
  inputs: {
    sourceVersionId: string;
    enabled: boolean;
    certificateId: string | null;
    hostname: string;
    aliases: string[];
    routes: number;
    headers: number;
    advanced: boolean;
    logSettingsRevision: number;
    logSettingsChecksum: string;
  };
};

export function getRuntimeDiagnostics() {
  return requestJson<RuntimeDiagnostics>("/api/settings/diagnostics");
}

export function getActiveRuntimeConfig(domainId: string) {
  return requestJson<ActiveRuntimeConfig>(`/api/settings/diagnostics/runtime-config?domainId=${encodeURIComponent(domainId)}`);
}

export function runDiagnosticNginxTest() {
  return requestJson<{ deploymentId: string; statusUrl: string }>("/api/settings/diagnostics/nginx-test", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
}

export function rebuildActiveRuntime(currentPassword: string) {
  return requestJson<{ deploymentId: string; statusUrl: string }>("/api/settings/diagnostics/rebuild-active", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ currentPassword }),
  });
}

export function reloadManagerTls() {
  return requestJson<{ deploymentId: string; statusUrl: string }>("/api/settings/diagnostics/reload-manager-tls", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
}

export type EditableRoute = RouteConfig;

export type AuthUser = { id: string; username: string };

export function getSetupStatus() {
  return requestJson<{ setupRequired: boolean }>("/api/setup/status");
}

export function setupAdmin(input: { username: string; password: string }) {
  return requestJson<{ user: AuthUser }>("/api/setup/admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { username: string; password: string; remember: boolean }) {
  return requestJson<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout() {
  return requestJson<void>("/api/auth/logout", { method: "POST" });
}

export function getCurrentUser() {
  return requestJson<{ user: AuthUser }>("/api/auth/me");
}
