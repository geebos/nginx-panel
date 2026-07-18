import { serve } from "@hono/node-server";
import { createApp } from "./index";

// Node 运行时入口（@hono/node-server）。
// 用于 DB_ENGINE=sqlite（本地文件 SQLite / better-sqlite3）场景，例如 Tauri/桌面后端。
// 启动方式：DB_ENGINE=sqlite DB_SQLITE_DIR=./.sqlite pnpm dev:worker:sqlite
const port = Number(process.env.PORT) || 8787;

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`[worker] listening on http://localhost:${info.port} (engine=${process.env.DB_ENGINE ?? "d1"})`);
});
