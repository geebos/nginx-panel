import { validateManagerTlsFiles } from "@/worker/lib/runtime/manager-tls";
import { BOOTSTRAP_HOSTS } from "@/shared/schemas";

let cached: { key: string; url?: URL; error?: Error } | undefined;

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
/** DNS hostname (at least one label) — bootstrap entry only, not manager bind rules. */
const BOOTSTRAP_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Parse BOOTSTRAP_EXTRA_HOSTS (comma/whitespace separated).
 * Accepts IPv4 literals and DNS hostnames/labels; rejects junk that would break nginx server_name.
 */
export function parseBootstrapExtraHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const host of parts) {
    if (seen.has(host)) continue;
    const looksLikeIpv4 = /^\d+(?:\.\d+)+$/.test(host);
    const ok = looksLikeIpv4
      ? IPV4_PATTERN.test(host)
      : BOOTSTRAP_HOSTNAME_PATTERN.test(host);
    if (!ok) {
      throw new Error(
        `BOOTSTRAP_EXTRA_HOSTS entry is invalid (use IPv4 or DNS hostname): ${host}`,
      );
    }
    if ((BOOTSTRAP_HOSTS as readonly string[]).includes(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/** Fixed loopback bootstrap hosts ∪ BOOTSTRAP_EXTRA_HOSTS (server/LAN IP, optional). */
export function getBootstrapHosts(): string[] {
  return [...BOOTSTRAP_HOSTS, ...parseBootstrapExtraHosts(process.env.BOOTSTRAP_EXTRA_HOSTS)];
}

/**
 * Optional legacy MANAGER_URL for migration seed / diagnostics.
 * No longer required for production greenfield boot.
 */
export function managerUrl() {
  const value = process.env.MANAGER_URL;
  const key = `${process.env.APP_ENV ?? ""}\0${value ?? ""}`;
  if (cached?.key === key) {
    if (cached.error) throw cached.error;
    return cached.url;
  }

  if (!value) {
    cached = { key };
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const error = new Error("MANAGER_URL must be a valid HTTP or HTTPS URL");
    cached = { key, error };
    throw error;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("MANAGER_URL must be a valid HTTP or HTTPS URL");
    cached = { key, error };
    throw error;
  }
  cached = { key, url };
  return url;
}

/** Effective request scheme from nginx-injected X-Forwarded-Proto or the connection. */
export function effectiveRequestScheme(headers: Headers, fallback: "http" | "https" = "http"): "http" | "https" {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") return forwarded;
  return fallback;
}

export function bootstrapOrigins(ports: number[] = [80, 8080]): string[] {
  const origins: string[] = [];
  for (const host of getBootstrapHosts()) {
    origins.push(`http://${host}`);
    for (const port of ports) {
      if (port !== 80) origins.push(`http://${host}:${port}`);
    }
  }
  return origins;
}

export function originsForHosts(hosts: string[], schemes: Array<"http" | "https">, ports: number[] = [80, 443, 8080, 8443]) {
  const origins: string[] = [];
  for (const host of hosts) {
    for (const scheme of schemes) {
      const defaultPort = scheme === "https" ? 443 : 80;
      origins.push(`${scheme}://${host}`);
      for (const port of ports) {
        if (port !== defaultPort) origins.push(`${scheme}://${host}:${port}`);
      }
    }
  }
  return origins;
}

/**
 * Soft validation on worker start. TLS files are validated only when both
 * MANAGER_TLS_* paths are configured (migration / emergency override).
 */
export function validateRuntimeEnv() {
  // Throws if BOOTSTRAP_EXTRA_HOSTS contains invalid entries.
  parseBootstrapExtraHosts(process.env.BOOTSTRAP_EXTRA_HOSTS);

  const url = managerUrl();
  if (url && process.env.MANAGER_HOST && url.hostname !== process.env.MANAGER_HOST) {
    throw new Error("MANAGER_URL hostname must match MANAGER_HOST when both are set");
  }

  const certFile = process.env.MANAGER_TLS_CERT_FILE;
  const keyFile = process.env.MANAGER_TLS_KEY_FILE;
  if (certFile || keyFile) {
    if (!certFile || !keyFile) {
      throw new Error("MANAGER_TLS_CERT_FILE and MANAGER_TLS_KEY_FILE must both be set when either is present");
    }
    const hostname = process.env.MANAGER_HOST;
    if (hostname) {
      validateManagerTlsFiles({ hostname, certificateFile: certFile, privateKeyFile: keyFile });
    }
  }
}
