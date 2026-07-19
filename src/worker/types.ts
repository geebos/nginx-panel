import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { IncomingMessage, ServerResponse } from "node:http";
import type * as schema from "@/shared/schemas";
import type { User } from "@/shared/schemas";

// Hono 环境类型（Node 运行时，@hono/node-server + better-sqlite3）。
// - Variables：中间件往上下文里写入的运行时值。
//   - db：createDbMiddleware 注入的 drizzle（better-sqlite3）实例，类型由本地 schema 推断。
//   - user：createAuthMiddleware 注入的当前用户，未挂载时为 undefined。
export type AppEnv = {
  Bindings: {
    incoming?: IncomingMessage;
    outgoing?: ServerResponse;
  };
  Variables: {
    db: BetterSQLite3Database<typeof schema>;
    user?: Pick<User, "id" | "username">;
    sessionIdHash?: string;
  };
};
