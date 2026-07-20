import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateManagerTlsFiles } from "./manager-tls";

function createCertificate(directory: string, name: string, hostname: string) {
  const certificateFile = join(directory, `${name}.crt`);
  const privateKeyFile = join(directory, `${name}.key`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKeyFile,
    "-out", certificateFile,
    "-subj", `/CN=${hostname}`,
    "-addext", `subjectAltName=DNS:${hostname}`,
    "-days", "1",
  ], { stdio: "ignore" });
  return { certificateFile, privateKeyFile };
}

test("manager TLS validation checks SAN, validity and private key match", () => {
  const directory = mkdtempSync(join(tmpdir(), "nginx-manager-tls-"));
  try {
    const primary = createCertificate(directory, "primary", "manager.example.com");
    const other = createCertificate(directory, "other", "other.example.com");
    const info = validateManagerTlsFiles({ hostname: "manager.example.com", ...primary });
    assert.equal(info.hostname, "manager.example.com");
    assert.match(info.subjectAltName, /manager\.example\.com/);
    assert.ok(info.validTo > Date.now());

    assert.throws(
      () => validateManagerTlsFiles({ hostname: "wrong.example.com", ...primary }),
      /SAN/,
    );
    assert.throws(
      () => validateManagerTlsFiles({ hostname: "manager.example.com", certificateFile: primary.certificateFile, privateKeyFile: other.privateKeyFile }),
      /does not match private key/,
    );
    assert.throws(
      () => validateManagerTlsFiles({ hostname: "manager.example.com", ...primary, now: info.validTo }),
      /validity period/,
    );
    assert.throws(
      () => validateManagerTlsFiles({ hostname: "manager.example.com", certificateFile: join(directory, "missing.crt"), privateKeyFile: primary.privateKeyFile }),
      (error: unknown) => error instanceof Error && error.message === "Manager TLS certificate or private key cannot be read or parsed" && !error.message.includes(directory),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
