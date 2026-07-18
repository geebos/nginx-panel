import type { Env, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BusinessError } from "../lib/errors";

export function createErrorHandler<E extends Env>(): ErrorHandler<E> {
  return (err, c) => {
    if (err instanceof BusinessError) {
      console.error(`[BusinessError] code=${err.code} msg="${err.message}"`, err.info);
      return c.json(
        { code: err.code, message: err.message, data: null },
        err.code as ContentfulStatusCode,
      );
    }

    console.error(`[InternalError] msg="${err.message}"`, err);
    return c.json(
      { code: 500, message: err instanceof Error ? err.message : "服务器错误", data: null },
      500,
    );
  };
}
