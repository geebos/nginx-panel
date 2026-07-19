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
      throw new ManagerTlsValidationError("管理端 TLS 证书不在有效期内");
    }
    if (!certificate.checkHost(input.hostname)) {
      throw new ManagerTlsValidationError("管理端 TLS 证书 SAN 不覆盖 MANAGER_HOST");
    }
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new ManagerTlsValidationError("管理端 TLS 证书与私钥不匹配");
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
    throw new ManagerTlsValidationError("管理端 TLS 证书或私钥无法读取或解析");
  }
}

export function validateManagerTlsEnvironment() {
  const hostname = process.env.MANAGER_HOST;
  const certificateFile = process.env.MANAGER_TLS_CERT_FILE;
  const privateKeyFile = process.env.MANAGER_TLS_KEY_FILE;
  if (!hostname || !certificateFile || !privateKeyFile) {
    throw new Error("MANAGER_HOST、MANAGER_TLS_CERT_FILE 和 MANAGER_TLS_KEY_FILE 必须设置");
  }
  return validateManagerTlsFiles({ hostname, certificateFile, privateKeyFile });
}
