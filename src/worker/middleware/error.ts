import type { Env, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BusinessError } from "../lib/errors";

export function createErrorHandler<E extends Env>(): ErrorHandler<E> {
  return (err, c) => {
    if (err instanceof BusinessError) {
      console.error(`[BusinessError] code=${err.code} msg="${err.message}"`, err.info.context);
      return c.json(
        {
          code: err.code,
          message: err.message,
          fieldErrors: err.info.fieldErrors,
          retryAfterSeconds: err.info.retryAfterSeconds,
        },
        err.status as ContentfulStatusCode,
      );
    }

    console.error(`[InternalError] msg="${err.message}"`, err);
    return c.json(
      { code: "INTERNAL_ERROR", message: "服务器错误" },
      500,
    );
  };
}
