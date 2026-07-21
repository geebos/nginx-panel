import { hkdfSync } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadMasterKey(): Promise<Buffer> {
  const masterKeyFile = process.env.NGINX_MANAGER_MASTER_KEY_FILE ?? "/run/secrets/nginx_manager_master_key";
  try {
    return await readFile(masterKeyFile);
  } catch (error) {
    if (process.env.APP_ENV !== "development") throw error;
    return Buffer.from(process.env.NGINX_MANAGER_DEV_MASTER_KEY ?? "nginx-manager-development-key");
  }
}

export function deriveManagerKey(master: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", master, "nginx-domain-manager", info, length));
}
