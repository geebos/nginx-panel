import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import { BusinessError } from "./errors";

// 校验失败时抛 BusinessError，交由 createErrorHandler 统一返回
// { code, message, data: null }，与项目既有错误格式保持一致。
export function jsonValidator<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      throw new BusinessError(result.error.issues[0]?.message ?? "参数错误", 400);
    }
  });
}
