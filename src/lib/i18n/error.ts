import type { TFunction } from "i18next";
import { ApiError, type ErrorParams } from "@/lib/api";

/** Extract i18n interpolation params from a thrown/API error. */
export function errorParams(error: unknown): ErrorParams | undefined {
  if (error instanceof ApiError) return error.params;
  return undefined;
}

/**
 * Translate an unknown error for display.
 * - ApiError / Error with message key → t(message, params)
 * - non-Error → t(fallbackKey)
 * t() leaves non-key strings unchanged, so plain messages stay safe.
 */
export function formatErrorMessage(
  t: TFunction,
  error: unknown,
  fallbackKey = "errors:requestFailed",
): string {
  if (error instanceof Error) {
    return t(error.message, errorParams(error) ?? {});
  }
  return t(fallbackKey);
}

/** Translate a bare message key (e.g. fieldErrors entry) with optional params. */
export function formatMessageKey(
  t: TFunction,
  key: string | undefined | null,
  params?: ErrorParams,
  fallbackKey = "errors:requestFailed",
): string {
  if (!key) return t(fallbackKey);
  return t(key, params ?? {});
}

/** Read i18n params from a Zod issue (custom issues only carry params). */
export function zodIssueParams(issue: unknown): ErrorParams | undefined {
  if (!issue || typeof issue !== "object") return undefined;
  const params = (issue as { params?: unknown }).params;
  if (!params || typeof params !== "object") return undefined;
  const out: ErrorParams = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") out[key] = value;
    else if (value != null) out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}
