import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "@/worker/types";
import { healthRoute, internalHealthRoute } from "@/worker/routes/health";
import { dashboardRoute } from "@/worker/routes/dashboard";
import { domainsRoute } from "@/worker/routes/domains";
import { authRoute } from "@/worker/routes/auth";
import { versionsRoute } from "@/worker/routes/versions";
import { deploymentsRoute } from "@/worker/routes/deployments";
import { logsRoute } from "@/worker/routes/logs";
import { settingsRoute } from "@/worker/routes/settings";
import { managerRoute } from "@/worker/routes/manager";
import { acmeChallengeRoute, certificatesRoute } from "@/worker/routes/certificates";
import { requireAuth, requireSameOrigin } from "@/worker/middleware/auth";
import { createErrorHandler } from "@/worker/middleware/error";
import { i18nRoute } from "@/worker/routes/i18n";
import { createDbMiddleware } from "@/worker/middleware/db";
import { assertAcceptingWrites } from "@/worker/lib/service-lifecycle";

// 构建 Hono app。Node 入口（serve.ts）复用此构造，
// 保证中间件/路由挂载一致。
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("/api/*", logger());
  app.use("*", createDbMiddleware());
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) assertAcceptingWrites();
    await next();
  });
  app.route("/", acmeChallengeRoute);
  app.route("/", internalHealthRoute);

  app.route("/api", healthRoute);
  app.route("/api", i18nRoute);
  app.route("/api", authRoute);
  app.use("/api/dashboard", requireAuth);
  app.use("/api/dashboard", requireSameOrigin);
  app.use("/api/dashboard/*", requireAuth);
  app.use("/api/dashboard/*", requireSameOrigin);
  app.use("/api/domains", requireAuth);
  app.use("/api/domains", requireSameOrigin);
  app.use("/api/domains/*", requireAuth);
  app.use("/api/domains/*", requireSameOrigin);
  app.use("/api/deployments", requireAuth);
  app.use("/api/deployments/*", requireAuth);
  app.use("/api/logs", requireAuth);
  app.use("/api/logs", requireSameOrigin);
  app.use("/api/logs/*", requireAuth);
  app.use("/api/logs/*", requireSameOrigin);
  app.use("/api/settings", requireAuth);
  app.use("/api/settings", requireSameOrigin);
  app.use("/api/settings/*", requireAuth);
  app.use("/api/settings/*", requireSameOrigin);
  app.use("/api/certificates", requireAuth);
  app.use("/api/certificates", requireSameOrigin);
  app.use("/api/certificates/*", requireAuth);
  app.use("/api/certificates/*", requireSameOrigin);
  app.route("/api", dashboardRoute);
  app.route("/api", domainsRoute);
  app.route("/api", versionsRoute);
  app.route("/api", deploymentsRoute);
  app.route("/api", logsRoute);
  app.route("/api", settingsRoute);
  app.route("/api", managerRoute);
  app.route("/api", certificatesRoute);

  app.onError(createErrorHandler<AppEnv>());

  return app;
}
