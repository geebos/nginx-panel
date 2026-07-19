import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "@/worker/types";
import { healthRoute, internalHealthRoute } from "./routes/health";
import { dashboardRoute } from "./routes/dashboard";
import { domainsRoute } from "./routes/domains";
import { authRoute } from "./routes/auth";
import { versionsRoute } from "./routes/versions";
import { deploymentsRoute } from "./routes/deployments";
import { logsRoute } from "./routes/logs";
import { settingsRoute } from "./routes/settings";
import { acmeChallengeRoute, certificatesRoute } from "./routes/certificates";
import { requireAuth, requireSameOrigin } from "./middleware/auth";
import { createErrorHandler } from "./middleware/error";
import { createDbMiddleware } from "./middleware/db";
import { assertAcceptingWrites } from "./lib/service-lifecycle";

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
  app.route("/api", certificatesRoute);

  app.onError(createErrorHandler<AppEnv>());

  return app;
}
