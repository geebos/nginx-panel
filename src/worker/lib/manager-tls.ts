import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

export type ManagerTlsInfo = {
  hostname: string;
  subject: string;
  issuer: string;
  subjectAltName: string;
  validFrom: number;
  validTo: number;
  fingerprint256: string;
};

class ManagerTlsValidationError extends Error {
  override name = "ManagerTlsValidationError";
}

export function validateManagerTlsFiles(input: {
  hostname: string;
  certificateFile: string;
  privateKeyFile: string;
  now?: number;
}): ManagerTlsInfo {
  try {
    const certificate = new X509Certificate(readFileSync(input.certificateFile));
    const privateKey = createPrivateKey(readFileSync(input.privateKeyFile));
    const now = input.now ?? Date.now();
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);

    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now >= validTo) {
      throw new ManagerTlsValidationError("Manager TLS certificate is not within its validity period");
    }
    if (!certificate.checkHost(input.hostname)) {
      throw new ManagerTlsValidationError("Manager TLS certificate SAN does not cover MANAGER_HOST");
    }
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new ManagerTlsValidationError("Manager TLS certificate does not match private key");
    }

    return {
      hostname: input.hostname,
      subject: certificate.subject,
      issuer: certificate.issuer,
      subjectAltName: certificate.subjectAltName ?? "",
      validFrom,
      validTo,
      fingerprint256: certificate.fingerprint256,
    };
  } catch (error) {
    if (error instanceof ManagerTlsValidationError) throw error;
    throw new ManagerTlsValidationError("Manager TLS certificate or private key cannot be read or parsed");
  }
}

export function validateManagerTlsEnvironment() {
  const hostname = process.env.MANAGER_HOST;
  const certificateFile = process.env.MANAGER_TLS_CERT_FILE;
  const privateKeyFile = process.env.MANAGER_TLS_KEY_FILE;
  if (!hostname || !certificateFile || !privateKeyFile) {
    throw new Error("MANAGER_HOST, MANAGER_TLS_CERT_FILE, and MANAGER_TLS_KEY_FILE must be set");
  }
  return validateManagerTlsFiles({ hostname, certificateFile, privateKeyFile });
}
