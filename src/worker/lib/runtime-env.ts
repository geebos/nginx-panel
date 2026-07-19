let cached: { key: string; url?: URL; error?: Error } | undefined;

export function managerUrl() {
  const value = process.env.MANAGER_URL;
  const key = `${process.env.APP_ENV ?? ""}\0${value ?? ""}`;
  if (cached?.key === key) {
    if (cached.error) throw cached.error;
    return cached.url;
  }

  if (!value) {
    if (process.env.APP_ENV === "development") {
      cached = { key };
      return undefined;
    }
    const error = new Error("MANAGER_URL must be set outside development");
    cached = { key, error };
    throw error;
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

export function validateRuntimeEnv() {
  managerUrl();
}
