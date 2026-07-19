import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { deploymentSteps, deployments } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";

export const deploymentsRoute = new Hono<AppEnv>();

deploymentsRoute.get("/deployments", async (c) => {
  const items = await c.get("db").select().from(deployments).orderBy(desc(deployments.createdAt)).limit(100);
  return c.json({ items });
});

deploymentsRoute.get("/deployments/:id", async (c) => {
  const db = c.get("db");
  const deployment = await db.query.deployments.findFirst({ where: eq(deployments.id, c.req.param("id")) });
  if (!deployment) throw new BusinessError("任务不存在", 404, "DEPLOYMENT_NOT_FOUND");
  const steps = await db.query.deploymentSteps.findMany({
    where: eq(deploymentSteps.deploymentId, deployment.id),
    orderBy: [deploymentSteps.sequence],
  });
  return c.json({ deployment, steps });
});
