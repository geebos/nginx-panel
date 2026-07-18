import { isTauri } from "@tauri-apps/api/core";
import { fetch as adapterFetch } from "@/lib/adapter/fetch";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";
const DEFAULT_TAURI_BASE_URL = "https://template.geebosblog.com";

function isAbsoluteUrl(input: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(input);
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveApiUrl(input: string): string {
  if (isAbsoluteUrl(input)) return input;

  if (isTauri()) {
    return joinUrl(BASE_URL || DEFAULT_TAURI_BASE_URL, input);
  }

  return BASE_URL ? joinUrl(BASE_URL, input) : input;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return adapterFetch(resolveApiUrl(input), init);
}

export async function warmupNetworkPermission(): Promise<void> {
  if (!isTauri()) return;

  try {
    await apiFetch("/api/health");
  } catch {
    // iOS only needs a first network attempt to trigger permission.
  }
}

export class ApiError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
