import { and, eq, isNull } from "drizzle-orm";
import {
  BOOTSTRAP_HOSTS,
  certificates,
  configVersions,
  domains,
  managerConfigSchema,
  managerUserHostnames,
  type ManagerConfig,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import type { RenderManagerRootInput } from "@/worker/lib/nginx/config";

type AppDb = AppEnv["Variables"]["db"];

export async function loadActiveManagerConfig(db: AppDb): Promise<{
  domainId: string | null;
  versionId: string | null;
  config: ManagerConfig | null;
}> {
  const manager = await db.query.domains.findFirst({
    where: and(eq(domains.type, "manager"), isNull(domains.deletedAt)),
  });
  if (!manager?.activeVersionId) {
    return { domainId: manager?.id ?? null, versionId: null, config: null };
  }
  const version = await db.query.configVersions.findFirst({
    where: eq(configVersions.id, manager.activeVersionId),
  });
  if (!version) return { domainId: manager.id, versionId: null, config: null };
  try {
    return {
      domainId: manager.id,
      versionId: version.id,
      config: managerConfigSchema.parse(JSON.parse(version.snapshotJson)),
    };
  } catch {
    return { domainId: manager.id, versionId: version.id, config: null };
  }
}

export async function buildManagerRootInput(
  db: AppDb,
  options?: {
    /** Prefer this version snapshot over the active one (manager deploy/rollback). */
    targetConfig?: ManagerConfig;
  },
): Promise<RenderManagerRootInput> {
  const active = options?.targetConfig
    ? { config: options.targetConfig }
    : await loadActiveManagerConfig(db);
  const config = active.config;
  const userHostnames = config ? managerUserHostnames(config) : [];
  let tls: RenderManagerRootInput["tls"];

  if (config?.ssl.enabled && config.ssl.certificateId) {
    const cert = await db.query.certificates.findFirst({
      where: eq(certificates.id, config.ssl.certificateId),
    });
    if (cert && ["ready", "active"].includes(cert.status)) {
      tls = { fullchainPath: cert.certPath, privateKeyPath: cert.keyPath };
    }
  } else if (
    // Emergency file cert only while SSL is still enabled (or no snapshot ssl yet during seed).
    // Never force file TLS after the operator disables HTTPS (M2).
    config?.ssl.enabled
    && process.env.MANAGER_TLS_CERT_FILE
    && process.env.MANAGER_TLS_KEY_FILE
    && userHostnames.length > 0
  ) {
    tls = {
      fullchainPath: process.env.MANAGER_TLS_CERT_FILE,
      privateKeyPath: process.env.MANAGER_TLS_KEY_FILE,
    };
  }

  return {
    bootstrapHosts: [...BOOTSTRAP_HOSTS],
    userHostnames,
    listeners: { http: 8080, https: 8443 },
    tls,
    forceHttpsOnBound: config?.ssl.forceHttps ?? true,
    uiRoot: process.env.MANAGER_UI_ROOT || "/opt/nginx-manager/ui",
    apiUpstream: process.env.MANAGER_API_UPSTREAM || "http://127.0.0.1:8787",
  };
}
