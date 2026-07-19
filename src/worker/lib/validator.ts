import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import { BusinessError } from "./errors";

export function validationError(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
  }
  return new BusinessError(
    error.issues[0]?.message ?? "参数错误",
    400,
    "INVALID_REQUEST",
    { fieldErrors },
  );
}

// 校验失败时抛 BusinessError，交由 createErrorHandler 统一返回
// { code, message, data: null }，与项目既有错误格式保持一致。
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
