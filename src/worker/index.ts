import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "@/worker/types";
import { healthRoute } from "./routes/health";
import { createErrorHandler } from "./middleware/error";
import { createDbMiddleware } from "./middleware/db";

// 构建 Hono app。Node 入口（serve.ts）复用此构造，
// 保证中间件/路由挂载一致。
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use("*", createDbMiddleware());

  app.route("/api", healthRoute);

  app.onError(createErrorHandler<AppEnv>());

  return app;
}
