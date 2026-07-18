import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "@/worker/types";
import { healthRoute } from "./routes/health";
import { helloRoute } from "./routes/hello";
import { todosRoute } from "./routes/todos";
import { createErrorHandler } from "./middleware/error";
import { createDbMiddleware } from "./middleware/db";

// 构建 Hono app。CF Workers（默认导出）与 Node 入口（serve.ts）共用此构造，
// 保证两条运行时路径挂载的中间件/路由完全一致。
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use("*", createDbMiddleware());

  app.route("/api", healthRoute);
  app.route("/api", helloRoute);
  app.route("/api", todosRoute);

  app.onError(createErrorHandler<AppEnv>());

  return app;
}

// Wrangler 入口：CF Workers 运行时，默认 DB_ENGINE=d1。
export default createApp();
