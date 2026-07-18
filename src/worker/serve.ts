import { serve } from "@hono/node-server";
import { createApp } from "./index";

// Node 运行时入口（@hono/node-server）。
// better-sqlite3 本地文件库；启动方式：DB_SQLITE_DIR=./.sqlite pnpm dev:worker
// （PORT 可覆盖默认 8787 端口）。
const port = Number(process.env.PORT) || 8787;

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`[worker] listening on http://localhost:${info.port}`);
});
