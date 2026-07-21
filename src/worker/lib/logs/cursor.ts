import { createHmac } from "node:crypto";
import { deriveManagerKey, loadMasterKey } from "@/worker/lib/master-key";

let cursorKey: Buffer | null = null;

async function getCursorKey() {
  if (cursorKey) return cursorKey;
  const master = await loadMasterKey();
  cursorKey = deriveManagerKey(master, "log-cursor-v1");
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
