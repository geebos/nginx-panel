import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/shared/schemas";

// better-sqlite3 本地文件库（Node 运行时，@hono/node-server）。
// 用于 Tauri/桌面后端 / 自托管。
const SQLITE_FILE = "app.db";

// 进程级缓存的 better-sqlite3 drizzle 实例。
// Node 运行时全局复用一条连接；migrate 在首次创建时执行一次。
let sqliteDb: BetterSQLite3Database<typeof schema> | null = null;

// 创建并缓存 sqlite 引擎的 drizzle 实例。
// better-sqlite3 / node:fs / node:path 用动态 import，确保打包路径可控。
export async function getSqliteDb(): Promise<BetterSQLite3Database<typeof schema>> {
  if (sqliteDb) return sqliteDb;

  const dir = process.env.DB_SQLITE_DIR;
  if (!dir) {
    throw new Error("DB_SQLITE_DIR 未设置：sqlite 引擎需要指定数据文件目录");
  }
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(dir, { recursive: true });

  const Database = (await import("better-sqlite3")).default;
  const conn = new Database(path.join(dir, SQLITE_FILE));

  const db = drizzle(conn, { schema });
  // 启动时从 ./drizzle 应用迁移；单写者进程启动期执行，无并发迁移问题。
  migrate(db, { migrationsFolder: "./drizzle" });
  sqliteDb = db;
  return db;
}

// 统一抽取「受影响行数」。better-sqlite3 的 RunResult 直接是 result.changes。
export function affectedRows(result: unknown): number {
  const r = result as { changes?: number };
  return r?.changes ?? 0;
}
