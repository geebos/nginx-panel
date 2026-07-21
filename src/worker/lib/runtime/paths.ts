/** Default nginx runtime root when NGINX_RUNTIME_ROOT is unset. */
export const DEFAULT_NGINX_RUNTIME_ROOT = "/data/nginx";

/** Default ACME certificate data root when CERTIFICATE_DATA_ROOT is unset. */
export const DEFAULT_CERTIFICATE_DATA_ROOT = "/data/certs";

/**
 * Resolve nginx runtime root.
 * Uses `||` (not `??`) so empty strings fall back — matches historical call sites.
 */
export function nginxRuntimeRoot(override?: string | null): string {
  return override || process.env.NGINX_RUNTIME_ROOT || DEFAULT_NGINX_RUNTIME_ROOT;
}

/**
 * Resolve certificate data root.
 * Uses `||` (not `??`) so empty strings fall back — matches historical call sites.
 */
export function certificateDataRoot(override?: string | null): string {
  return override || process.env.CERTIFICATE_DATA_ROOT || DEFAULT_CERTIFICATE_DATA_ROOT;
}
