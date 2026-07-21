import { bootstrapOrigins, getBootstrapHosts, originsForHosts, managerUrl } from "@/worker/lib/runtime/env";

/**
 * Allowed browser Origins for mutating requests.
 * bootstrapHosts (HTTP) ∪ active manager user hosts (HTTP+HTTPS).
 */
export function computeAllowedOrigins(userHosts: string[] = []) {
  const allowed = new Set<string>([
    ...bootstrapOrigins([80, 8080]),
    ...originsForHosts(userHosts, ["http", "https"], [80, 443, 8080, 8443]),
  ]);

  // Development: any loopback origin is fine.
  if (process.env.APP_ENV === "development") {
    for (const host of [...getBootstrapHosts(), "::1"]) {
      allowed.add(`http://${host}`);
      allowed.add(`http://${host}:3000`);
      allowed.add(`http://${host}:8787`);
    }
  }

  // Legacy MANAGER_URL still accepted during migration.
  try {
    const legacy = managerUrl();
    if (legacy) allowed.add(legacy.origin);
  } catch {
    // ignore invalid legacy env
  }

  return allowed;
}

export function isOriginAllowed(origin: string | undefined, userHosts: string[] = []) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return computeAllowedOrigins(userHosts).has(parsed.origin);
  } catch {
    return false;
  }
}
