import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import type { AppEnv } from "@/worker/types";
import { getServiceLifecycle } from "@/worker/lib/service-lifecycle";
import { getRuntimeState, setRuntimeState, type RuntimeState } from "@/worker/lib/runtime-state";
import { verifyRuntime } from "@/worker/lib/runtime-verifier";
import { deployments } from "@/shared/schemas";

type HealthDependencies = {
  now?: () => number;
  verify?: (db: AppEnv["Variables"]["db"]) => Promise<RuntimeState>;
};

function isLoopback(value: string | undefined) {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

async function evaluateHealth(db: AppEnv["Variables"]["db"], dependencies: HealthDependencies) {
  const now = dependencies.now ?? Date.now;
  let database: "healthy" | "unhealthy" = "healthy";
  try {
    const result = await db.all<{ ok: number }>(sql.raw("SELECT 1 AS ok"));
    if (result[0]?.ok !== 1) database = "unhealthy";
  } catch {
    database = "unhealthy";
  }

  const lifecycle = getServiceLifecycle(now());
  let runtime = getRuntimeState();
  if (database === "healthy") {
    try {
      const activeMutation = await db.query.deployments.findFirst({ where: and(
        eq(deployments.status, "running"),
        inArray(deployments.type, ["deploy", "rollback", "apply_log_settings", "rebuild_active"]),
      ) });
      if (!activeMutation) {
        runtime = await (dependencies.verify ?? verifyRuntime)(db);
        setRuntimeState(runtime);
      }
    } catch {
      runtime = { status: "degraded", checkedAt: now(), activeRevision: runtime.activeRevision, issues: [{ code: "HEALTH_RUNTIME_CHECK_FAILED", message: "Active revision 健康检查失败" }] };
      setRuntimeState(runtime);
    }
  }
  const ok = database === "healthy" && lifecycle.jobRunnerHealthy && runtime.status === "healthy";
  return {
    ok,
    database: { status: database },
    jobRunner: {
      status: lifecycle.jobRunnerHealthy ? "healthy" as const : "stale" as const,
      heartbeatAt: lifecycle.jobRunnerHeartbeatAt,
    },
    runtime: { status: runtime.status, checkedAt: runtime.checkedAt },
  };
}

export function createHealthRoutes(dependencies: HealthDependencies = {}) {
  const publicRoute = new Hono<AppEnv>();
  const internalRoute = new Hono<AppEnv>();
  let cached: { at: number; result: Awaited<ReturnType<typeof evaluateHealth>> } | null = null;
  let inFlight: Promise<Awaited<ReturnType<typeof evaluateHealth>>> | null = null;
  const respond = async (c: Context<AppEnv>) => {
    const now = (dependencies.now ?? Date.now)();
    if (!cached || now - cached.at >= 5_000) {
      inFlight ??= evaluateHealth(c.get("db"), dependencies).finally(() => { inFlight = null; });
      cached = { at: now, result: await inFlight };
    }
    const result = cached.result;
    return c.json(result, result.ok ? 200 : 503);
  };

  publicRoute.get("/health", respond);
  internalRoute.get("/internal/health", async (c) => {
    const remoteAddress = c.env.incoming?.socket.remoteAddress;
    if (
      !isLoopback(remoteAddress)
      || c.req.header("host") !== "127.0.0.1"
      || c.req.header("x-internal-health-check") !== "1"
    ) {
      return c.json({ code: "NOT_FOUND", message: "Not Found" }, 404);
    }
    return respond(c);
  });
  return { public: publicRoute, internal: internalRoute };
}

const routes = createHealthRoutes();
export const healthRoute = routes.public;
export const internalHealthRoute = routes.internal;
