import { eq } from "drizzle-orm";
import {
  nginxLogSettingsSchema,
  requiredAccessLogFields,
  settings,
  type NginxLogSettings,
} from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { checksum } from "@/worker/lib/runtime/manifest";

export const defaultLogSettings: NginxLogSettings = {
  revision: 0,
  accessFields: [...requiredAccessLogFields, "request_time"],
  errorLevel: "warn",
  maxFileSizeMiB: 100,
  retainedFiles: 5,
  updatedAt: 0,
};

export async function getActiveLogSettings(db: AppEnv["Variables"]["db"]) {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "nginx_logs") });
  return row ? nginxLogSettingsSchema.parse(JSON.parse(row.valueJson)) : defaultLogSettings;
}

export function logSettingsChecksum(value: NginxLogSettings) {
  return checksum(JSON.stringify(value));
}
