import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BusinessError } from "@/worker/lib/errors";

const MASTER_KEY_FILE = process.env.NGINX_MANAGER_MASTER_KEY_FILE ?? "/run/secrets/nginx_manager_master_key";
const SCHEMA_VERSION = 1;

async function credentialKey() {
  let master: Buffer;
  try {
    master = await readFile(MASTER_KEY_FILE);
  } catch (error) {
    if (process.env.APP_ENV !== "development") {
      throw new BusinessError("errors:secretMasterKeyUnavailable", 503, "SECRET_MASTER_KEY_UNAVAILABLE", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    master = Buffer.from(process.env.NGINX_MANAGER_DEV_MASTER_KEY ?? "nginx-manager-development-key");
  }
  return Buffer.from(hkdfSync("sha256", master, "nginx-domain-manager", "cloudflare-credentials-v1", 32));
}

function aad(credentialId: string) {
  return Buffer.from(`${credentialId}:${SCHEMA_VERSION}`);
}

export async function encryptCloudflareToken(credentialId: string, token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await credentialKey(), iv);
  cipher.setAAD(aad(credentialId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function encryptedBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error("Encrypted credential format is invalid");
}

export async function decryptCloudflareToken(credentialId: string, encrypted: { tokenCiphertext: unknown; tokenIv: unknown; tokenAuthTag: unknown }) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", await credentialKey(), encryptedBuffer(encrypted.tokenIv));
    decipher.setAAD(aad(credentialId));
    decipher.setAuthTag(encryptedBuffer(encrypted.tokenAuthTag));
    return Buffer.concat([decipher.update(encryptedBuffer(encrypted.tokenCiphertext)), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new BusinessError("errors:cloudflareCredentialDecryptFailed", 503, "CLOUDFLARE_CREDENTIAL_DECRYPT_FAILED", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
