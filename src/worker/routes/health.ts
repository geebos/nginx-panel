import { Hono } from "hono";
import { getRuntimeState } from "@/worker/lib/runtime-state";

export const healthRoute = new Hono();

healthRoute.get("/health", (c) => {
  const runtime = getRuntimeState();
  return c.json({ ok: true, runtime: { status: runtime.status, checkedAt: runtime.checkedAt } });
});
