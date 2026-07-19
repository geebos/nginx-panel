import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { domains, logQuerySchema, logRotationRequestSchema, logStreamQuerySchema, type LogRecord, type LogStreamRecord } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { jsonValidator, queryValidator } from "@/worker/lib/validator";
import { logStreamCapacity } from "@/worker/logs/capacity";
import { encodeLogCursor } from "@/worker/logs/cursor";
import { followLogFiles } from "@/worker/logs/follower";
import { matchesLogFilters, parseLogLine } from "@/worker/logs/parser";
import { controlledLogPath } from "@/worker/logs/path";
import { readLastLines } from "@/worker/logs/reader";
import { createLogRotationDeployment, enqueueLogRotation } from "@/worker/logs/rotator";
import { assertAcceptingLogStreams, registerLogStream } from "@/worker/lib/service-lifecycle";

export const logsRoute = new Hono<AppEnv>();

logsRoute.get("/logs/domains", async (c) => {
  const items = await c.get("db").select({ id: domains.id, hostname: domains.primaryHostname, enabled: domains.enabled, activeVersionId: domains.activeVersionId }).from(domains).where(isNull(domains.deletedAt)).orderBy(domains.primaryHostname);
  return c.json({ items });
});

logsRoute.get("/logs/history", queryValidator(logQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const domain = await c.get("db").query.domains.findFirst({ where: and(eq(domains.id, query.domainId), isNull(domains.deletedAt)) });
  if (!domain) throw new BusinessError("域名不存在", 404, "DOMAIN_NOT_FOUND");
  if (!domain.activeVersionId) return c.json({ items: [], truncated: false, unpublished: true });
  const root = process.env.NGINX_LOG_DIR;
  if (!root) throw new BusinessError("日志目录未配置", 503, "LOG_FILE_UNAVAILABLE");
  const records: LogRecord[] = [];
  let truncated = false;
  for (const type of query.types) {
    let result: Awaited<ReturnType<typeof readLastLines>>;
    try {
      result = await readLastLines(controlledLogPath(root, domain.primaryHostname, `${type}.log`), query.limit);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw new BusinessError("日志文件不可读", 503, "LOG_FILE_UNAVAILABLE");
    }
    truncated ||= result.truncated;
    result.lines.forEach((line, index) => {
      const parsed = parseLogLine(type, line);
      if (!matchesLogFilters(parsed, query)) return;
      records.push({ id: `${type}-${index}-${parsed.raw.length}`, domainId: domain.id, hostname: domain.primaryHostname, type, ...parsed });
    });
  }
  records.sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""));
  return c.json({ items: records.slice(-query.limit), truncated, unpublished: false });
});

logsRoute.get("/logs/follow", queryValidator(logStreamQuerySchema), async (c) => {
  assertAcceptingLogStreams();
  const query = c.req.valid("query");
  const domain = await c.get("db").query.domains.findFirst({ where: and(eq(domains.id, query.domainId), isNull(domains.deletedAt)) });
  if (!domain) throw new BusinessError("域名不存在", 404, "DOMAIN_NOT_FOUND");
  if (!domain.activeVersionId) throw new BusinessError("Domain 尚未发布", 409, "DOMAIN_NOT_PUBLISHED");
  const root = process.env.NGINX_LOG_DIR;
  if (!root) throw new BusinessError("日志目录未配置", 503, "LOG_FILE_UNAVAILABLE");

  const sources = query.types.map((logType) => ({
    domainId: domain.id,
    hostname: domain.primaryHostname,
    logType,
    path: controlledLogPath(root, domain.primaryHostname, `${logType}.log`),
  }));
  const release = logStreamCapacity.acquire(c.get("sessionIdHash")!);

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-store");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async (output) => {
    const controller = new AbortController();
    output.onAbort(() => controller.abort());
    let lastCursor: string | undefined;
    let windowStartedAt = Date.now();
    let windowLines = 0;
    let windowBytes = 0;
    let dropped = 0;

    const write = async (record: LogStreamRecord) => {
      await output.writeln(JSON.stringify(record));
    };
    const flushDropped = async () => {
      if (!dropped) return;
      await write({ type: "dropped", count: dropped, reason: "rate_limit" });
      dropped = 0;
    };
    const unregister = registerLogStream(async () => {
      try {
        await flushDropped();
        await write({ type: "end", reason: "server_shutdown", ...(lastCursor ? { cursor: lastCursor } : {}) });
      } finally {
        controller.abort();
      }
    });

    try {
      await write({ type: "heartbeat", at: new Date().toISOString() });
      const result = await followLogFiles(sources, {
        signal: controller.signal,
        emit: async (event) => {
          if (event.type === "rotated") {
            const cursor = await encodeLogCursor({ namespace: "live", domainId: domain.id, types: query.types, filters: { keyword: query.keyword, method: query.method, ...(query.status ? { status: query.status } : {}) }, fileId: event.nextFileId, offset: 0 });
            lastCursor = cursor;
            await write({ type: "rotated", previousFileId: event.previousFileId, nextFileId: event.nextFileId, cursor });
            return;
          }
          const parsed = parseLogLine(event.source.logType, event.line);
          if (!matchesLogFilters(parsed, query)) return;
          const cursor = await encodeLogCursor({ namespace: "live", domainId: domain.id, types: query.types, filters: { keyword: query.keyword, method: query.method, ...(query.status ? { status: query.status } : {}) }, fileId: event.fileId, offset: event.offset });
          lastCursor = cursor;
          const record: LogStreamRecord = {
            type: "entry",
            domainId: event.source.domainId,
            hostname: event.source.hostname,
            logType: event.source.logType,
            cursor,
            ...parsed,
            truncated: event.truncated,
          };
          const encodedBytes = Buffer.byteLength(JSON.stringify(record)) + 1;
          if (Date.now() - windowStartedAt >= 1000) {
            await flushDropped();
            windowStartedAt = Date.now();
            windowLines = 0;
            windowBytes = 0;
          }
          if (windowLines >= 1000 || windowBytes + encodedBytes > 2 * 1024 * 1024) {
            dropped += 1;
            return;
          }
          windowLines += 1;
          windowBytes += encodedBytes;
          await write(record);
        },
        heartbeat: async () => {
          await flushDropped();
          await write({ type: "heartbeat", at: new Date().toISOString(), ...(lastCursor ? { cursor: lastCursor } : {}) });
        },
      });
      if (result === "stream_limit") {
        await flushDropped();
        await write({ type: "end", reason: "stream_limit", ...(lastCursor ? { cursor: lastCursor } : {}) });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[logs] follow stream failed", error instanceof Error ? error.name : "unknown");
        await write({ type: "error", code: "file_unavailable", recoverable: true });
      }
    } finally {
      unregister();
      release();
    }
  });
});

logsRoute.post("/logs/rotate", jsonValidator(logRotationRequestSchema), async (c) => {
  if (process.env.RUNTIME_MODE !== "nginx-manager") throw new BusinessError("日志轮动只允许在 Nginx runtime 中执行", 409, "DEPLOYMENT_UNAVAILABLE");
  const body = c.req.valid("json");
  if (body.domainId) {
    const domain = await c.get("db").query.domains.findFirst({ where: and(eq(domains.id, body.domainId), isNull(domains.deletedAt)) });
    if (!domain) throw new BusinessError("域名不存在", 404, "DOMAIN_NOT_FOUND");
  }
  const deployment = await createLogRotationDeployment(c.get("db"), {
    domainId: body.domainId,
    requestedBy: c.get("user")!.id,
    idempotencyKey: c.req.header("Idempotency-Key") || randomUUID(),
    force: true,
  });
  if (deployment.status === "queued") void enqueueLogRotation(c.get("db"), deployment.id);
  return c.json({ deploymentId: deployment.id, statusUrl: `/api/deployments/${deployment.id}` }, 202);
});
