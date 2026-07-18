import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/worker/types";

// 环境变量中间件骨架。
//
// Cloudflare Worker 的 bindings（wrangler.jsonc 里的 vars / d1_databases 等）
// 通过 c.env 暴露，本身在请求处理函数里就能直接读。这个中间件存在的理由是：
// 把 c.env 里的值一次性拷到一个模块级 store，让 lib/ 下不接收 c 的纯函数也能读到。
//
// 用法：
// 1. 在 types.ts 的 AppEnv["Bindings"] 里追加需要的变量，并在 wrangler.jsonc vars 里配上同名项。
// 2. 在本文件定义 EnvStore 字段 + 一个 configureEnv(env) 把 c.env 写进 store + 对应的 getter。
// 3. 在下面的 envMiddleware 里调用 configureEnv(c.env)。
// 4. index.ts 挂载 envMiddleware 后，lib/ 通过 getter 读取即可。
//
// 当前没有需要全局缓存的环境变量，中间件只透传请求，不做任何事。
// 需要时按上面的步骤填进来。

export const envMiddleware = createMiddleware<AppEnv>(async (_c, next) => {
  await next();
});
