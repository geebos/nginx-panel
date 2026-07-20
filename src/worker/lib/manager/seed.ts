import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  buildBoundManagerConfig,
  domains,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { createSnapshot } from "@/worker/lib/snapshot";
import { saveDraftVersion } from "@/worker/lib/domain/draft-version";
import { validateManagerTlsFiles } from "@/worker/lib/runtime/manager-tls";

type AppDb = AppEnv["Variables"]["db"];

export type ManagerSeedResult =
  | { seeded: false }
  | {
      seeded: true;
      domainId: string;
      /** Always false — seed writes a draft and caller enqueues root deploy (R2 / C4). */
      active: false;
      /** Draft version id — caller should enqueue preflight + publish. */
      draftVersionId: string;
      snapshotChecksum: string;
    };

/**
 * One-shot upgrade seed from legacy MANAGER_HOST env (§11.1).
 * Creates a type=manager draft when none exists and MANAGER_HOST is set.
 * Always draft + enqueue (even when TLS files validate) so nginx root leaves bootstrap-only (R2).
 */
export async function seedManagerFromEnv(db: AppDb): Promise<ManagerSeedResult> {
  const existing = await db.query.domains.findFirst({
    where: and(eq(domains.type, "manager"), isNull(domains.deletedAt)),
  });
  if (existing) return { seeded: false };

  const primary = process.env.MANAGER_HOST?.trim().toLowerCase().replace(/\.$/, "");
  if (!primary) return { seeded: false };

  let tlsOk = false;
  const certFile = process.env.MANAGER_TLS_CERT_FILE;
  const keyFile = process.env.MANAGER_TLS_KEY_FILE;
  if (certFile && keyFile) {
    try {
      validateManagerTlsFiles({ hostname: primary, certificateFile: certFile, privateKeyFile: keyFile });
      tlsOk = true;
    } catch {
      tlsOk = false;
    }
  }

  // enabled requires a valid email under managerSslConfigSchema (C3).
  // File-cert seed is transitional; use a deterministic operational address.
  const config = buildBoundManagerConfig({
    primaryHostname: primary,
    ssl: {
      enabled: tlsOk,
      email: tlsOk ? `ops@${primary}` : "",
      autoRenew: true,
      forceHttps: true,
      environment: "production",
      validation: { method: "dns-01", provider: "manual" },
    },
  });
  const snapshot = createSnapshot(config);
  const now = Date.now();
  const domainId = randomUUID();

  const saved = db.transaction((tx) => {
    tx.insert(domains).values({
      id: domainId,
      type: "manager",
      primaryHostname: config.primaryHostname,
      displayHostname: config.primaryHostname,
      enabled: true,
      runtimeStatus: "unknown",
      activeVersionId: null,
      draftVersionId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run();
    return saveDraftVersion(tx, {
      domainId,
      config,
      snapshot,
      changeSummary: "Seeded from MANAGER_HOST (draft pending root rebuild)",
      now,
    });
  });

  console.log(
    `[manager-seed] created manager domain ${domainId} for ${primary} (draft; root deploy pending)`,
  );
  return {
    seeded: true,
    domainId,
    active: false,
    draftVersionId: saved.versionId,
    snapshotChecksum: saved.snapshotChecksum,
  };
}
