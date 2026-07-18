import { createMiddleware } from "hono/factory";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";

const HEADER_TIMESTAMP = "x-request-timestamp";
const HEADER_NETWORK_LATENCY = "x-network-latency";
const HEADER_WORKER_LATENCY = "x-worker-latency";
const HEADER_COLO = "x-cf-colo";

export const latencyMiddleware = createMiddleware(async (c, next) => {
  const tsHeader = c.req.header(HEADER_TIMESTAMP);
  const hasTimestamp = tsHeader !== undefined;
  const networkLatency = hasTimestamp ? Date.now() - Number(tsHeader) : -1;

  const handlerStart = Date.now();
  await next();
  const handlerCost = Date.now() - handlerStart;

  const cf = (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf;
  const colo = cf?.colo ?? "";

  if (hasTimestamp) {
    c.res.headers.set(HEADER_NETWORK_LATENCY, String(networkLatency));
    c.res.headers.set(HEADER_WORKER_LATENCY, String(handlerCost));
    c.res.headers.set(HEADER_COLO, colo);
  }
});
