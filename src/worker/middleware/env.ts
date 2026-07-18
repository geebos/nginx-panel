import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/worker/types";

// 环境变量中间件骨架。
//
// Node 运行时（@hono/node-server）下，`process.env` 可被任何模块直接读取，
// 通常不需要此中间件。保留为可选骨架：若日后需要把请求期 env 一次性拷到
// 模块级 store（统一注入/快照），在此实现 configureEnv + getter，并在
// index.ts 挂载 envMiddleware 后由 lib/ 读取。
//
// 当前没有需要全局缓存的环境变量，中间件只透传请求，不做任何事。
export const envMiddleware = createMiddleware<AppEnv>(async (_c, next) => {
  await next();
});
