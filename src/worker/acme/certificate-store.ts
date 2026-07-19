import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as acme from "acme-client";

export type PersistCertificateInput = {
  certificateId: string;
  domainId: string;
  orderId: string;
  identifiers: string[];
  certificatePem: string;
};

export type PersistedCertificate = {
  sans: string[];
  certPath: string;
  keyPath: string;
  certFileChecksum: string;
  publicKeySpkiChecksum: string;
  notBefore: number;
  notAfter: number;
};

export interface CertificateStore {
  persist(input: PersistCertificateInput): Promise<PersistedCertificate>;
  cleanupOrder(orderId: string): Promise<void>;
}

function acmeRoot() {
  return process.env.ACME_DATA_ROOT || "/data/acme";
}

function certificateRoot() {
  return process.env.CERTIFICATE_DATA_ROOT || "/data/certs";
}

function checksum(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase().replace(/\.$/, "")))].sort();
}

async function writeSynced(path: string, value: string | Buffer) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileCertificateStore implements CertificateStore {
  async persist(input: PersistCertificateInput): Promise<PersistedCertificate> {
    const privateKey = await readFile(join(acmeRoot(), "orders", input.orderId, "private.key"));
    const chain = acme.crypto.splitPemChain(input.certificatePem);
    if (chain.length === 0) throw new Error("ACME 未返回证书链");
    const info = acme.crypto.readCertificateInfo(chain[0]);
    const sans = normalized(info.domains.altNames);
    if (JSON.stringify(sans) !== JSON.stringify(normalized(input.identifiers))) throw new Error("证书 SAN 与订单域名不一致");

    const leaf = new X509Certificate(chain[0]);
    const certificateSpki = leaf.publicKey.export({ type: "spki", format: "der" });
    const privateKeySpki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    if (!Buffer.from(certificateSpki).equals(Buffer.from(privateKeySpki))) throw new Error("证书与订单私钥不匹配");
    const notBefore = info.notBefore.getTime();
    const notAfter = info.notAfter.getTime();
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notAfter <= Date.now()) throw new Error("证书有效期无效");

    const target = join(certificateRoot(), input.domainId, input.certificateId);
    const temporary = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { mode: 0o700 });
    try {
      await writeSynced(join(temporary, "fullchain.pem"), input.certificatePem);
      await writeSynced(join(temporary, "private.key"), privateKey);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    return {
      sans,
      certPath: join(target, "fullchain.pem"),
      keyPath: join(target, "private.key"),
      certFileChecksum: checksum(input.certificatePem),
      publicKeySpkiChecksum: checksum(Buffer.from(certificateSpki)),
      notBefore,
      notAfter,
    };
  }

  async cleanupOrder(orderId: string) {
    await rm(join(acmeRoot(), "orders", orderId), { recursive: true, force: true });
  }
}

let defaultStore: CertificateStore | null = null;

export function getCertificateStore() {
  defaultStore ??= new FileCertificateStore();
  return defaultStore;
}
