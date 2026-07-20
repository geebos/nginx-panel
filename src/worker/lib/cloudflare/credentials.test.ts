import assert from "node:assert/strict";
import test from "node:test";
import { decryptCloudflareToken, encryptCloudflareToken } from "@/worker/lib/cloudflare/credentials";

test("Cloudflare tokens are encrypted with credential-bound authenticated encryption", async () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = "development";
  const encrypted = await encryptCloudflareToken("credential-1", "secret-token");
  assert.notEqual(encrypted.ciphertext.toString("hex"), Buffer.from("secret-token").toString("hex"));
  assert.equal(await decryptCloudflareToken("credential-1", {
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
  }), "secret-token");
  await assert.rejects(() => decryptCloudflareToken("credential-2", {
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
  }), /errors:cloudflareCredentialDecryptFailed/);
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});
