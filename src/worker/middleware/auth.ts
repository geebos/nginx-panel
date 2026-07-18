import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

// 鉴权 resolver：根据 db 和原始请求解析当前用户，返回 null 表示未登录。
// user 的具体类型由调用方在拿到 c.get("user") 后自行收窄。
type AuthResolver = (
  db: AppEnv["Variables"]["db"],
  request: Request,
) => Promise<NonNullable<AppEnv["Variables"]["user"]> | null>;

export function createAuthMiddleware(getAuthFromRequest: AuthResolver) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = await getAuthFromRequest(c.get("db"), c.req.raw);
    if (!user) {
      return c.json(
        { code: 401, message: "未登录或会话已过期", data: null },
        401,
      );
    }
    c.set("user", user);
    await next();
  });
}

export function createOptionalAuthMiddleware(getAuthFromRequest: AuthResolver) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = await getAuthFromRequest(c.get("db"), c.req.raw);
    if (user) {
      c.set("user", user);
    }
    await next();
  });
}
