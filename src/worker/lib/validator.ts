import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import { BusinessError, type ErrorParams } from "./errors";

type IssueLike = {
  path: PropertyKey[];
  message: string;
  params?: Record<string, unknown>;
};

function toErrorParams(value: Record<string, unknown> | undefined): ErrorParams | undefined {
  if (!value) return undefined;
  const params: ErrorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number") params[key] = entry;
    else if (entry != null) params[key] = String(entry);
  }
  return Object.keys(params).length ? params : undefined;
}

export function validationError(error: { issues: readonly IssueLike[] }) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
  }
  const first = error.issues[0];
  return new BusinessError(
    first?.message ?? "errors:invalidRequest",
    400,
    "INVALID_REQUEST",
    { fieldErrors, params: toErrorParams(first?.params) },
  );
}

// 校验失败时抛 BusinessError，交由 createErrorHandler 统一返回
// { code, message, fieldErrors, params }，与项目既有错误格式保持一致。
export function jsonValidator<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      throw validationError(result.error);
    }
  });
}

export function queryValidator<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result) => {
    if (!result.success) throw validationError(result.error);
  });
}
