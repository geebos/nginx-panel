import { eq } from "drizzle-orm";
import { sessionPolicySchema, settings, type SessionPolicy } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";

export const defaultSessionPolicy: SessionPolicy = {
  standardDays: 1,
  rememberDays: 30,
};

export async function getSessionPolicy(db: AppEnv["Variables"]["db"]) {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "security_session") });
  return row ? sessionPolicySchema.parse(JSON.parse(row.valueJson)) : defaultSessionPolicy;
}
