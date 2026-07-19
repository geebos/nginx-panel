import { createHmac, hkdfSync } from "node:crypto";
import { readFile } from "node:fs/promises";

const masterKeyFile = process.env.NGINX_MANAGER_MASTER_KEY_FILE ?? "/run/secrets/nginx_manager_master_key";
let cursorKey: Buffer | null = null;

async function getCursorKey() {
  if (cursorKey) return cursorKey;
  let master: Buffer;
  try {
    master = await readFile(masterKeyFile);
  } catch (error) {
    if (process.env.APP_ENV !== "development") throw error;
    master = Buffer.from(process.env.NGINX_MANAGER_DEV_MASTER_KEY ?? "nginx-manager-development-key");
  }
  cursorKey = Buffer.from(hkdfSync("sha256", master, "nginx-domain-manager", "log-cursor-v1", 32));
  return cursorKey;
}

export async function encodeLogCursor(input: {
  namespace: "history" | "live";
  domainId: string;
  types: Array<"access" | "error">;
  filters: { keyword: string; method: string; status?: number };
  fileId: string;
  offset: number;
}) {
  const body = Buffer.from(JSON.stringify(input)).toString("base64url");
  const signature = createHmac("sha256", await getCursorKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}
