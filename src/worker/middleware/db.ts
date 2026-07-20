import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/worker/types";
import { getSqliteDb } from "@/worker/lib/db/engine";

export function createDbMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    // sqlite：单写者文件库天然 read-your-writes，复用进程级连接。
    c.set("db", await getSqliteDb());
    await next();
  });
}
