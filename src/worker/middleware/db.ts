import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { getSqliteDb } from "../db/engine";

export function createDbMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    // sqlite：单写者文件库天然 read-your-writes，复用进程级连接。
    c.set("db", await getSqliteDb());
    await next();
  });
}
