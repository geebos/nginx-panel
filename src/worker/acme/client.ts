import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as acme from "acme-client";

export type PreparedAcmeChallenge = {
  hostname: string;
  type: "http-01" | "dns-01";
  token: string | null;
  keyAuthorization: string | null;
  dnsRecordName: string | null;
  dnsRecordValue: string | null;
  expiresAt: number;
};

export type PrepareAcmeOrderInput = {
  orderId: string;
  accountEmail: string;
  environment: "staging" | "production";
  identifiers: string[];
  validationMethod: "http-01" | "dns-01";
  allowAccountCreate?: boolean;
};

export type PreparedAcmeOrder = {
  orderUrl: string;
  expiresAt: number | null;
  challenges: PreparedAcmeChallenge[];
};

export type ExistingAcmeOrderInput = Pick<PrepareAcmeOrderInput, "accountEmail" | "environment" | "identifiers" | "validationMethod"> & {
  orderId: string;
  orderUrl: string;
};

export type AcmeOrderProgress = {
  orderStatus: "pending" | "ready" | "processing" | "valid" | "invalid";
  authorizations: Array<{
    hostname: string;
    status: "pending" | "valid" | "invalid" | "deactivated" | "expired" | "revoked";
  }>;
};

export type FinalizedAcmeOrder =
  | { status: "pending" }
  | { status: "downloaded"; certificatePem: string };

export class AcmeRecoveryError extends Error {
  constructor(public readonly code: "ACME_ACCOUNT_KEY_MISSING" | "ACME_ACCOUNT_METADATA_MISSING" | "ACME_ACCOUNT_METADATA_INVALID", message: string) {
    super(message);
    this.name = "AcmeRecoveryError";
  }
}

export interface AcmeAdapter {
  prepareOrder(input: PrepareAcmeOrderInput): Promise<PreparedAcmeOrder>;
  acknowledgeChallenges(input: ExistingAcmeOrderInput): Promise<void>;
  pollOrder(input: ExistingAcmeOrderInput): Promise<AcmeOrderProgress>;
  finalizeOrder(input: ExistingAcmeOrderInput): Promise<FinalizedAcmeOrder>;
}

type AccountMetadata = {
  schemaVersion: 1;
  environment: "staging" | "production";
  emailHash: string;
  directoryUrl: string;
  accountUrl: string;
  createdAt: number;
};

function acmeRoot() {
  return process.env.ACME_DATA_ROOT || "/data/acme";
}

function directoryUrl(environment: "staging" | "production") {
  return process.env[environment === "staging" ? "ACME_DIRECTORY_STAGING_URL" : "ACME_DIRECTORY_PRODUCTION_URL"]
    || acme.directory.letsencrypt[environment];
}

function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function atomicWrite(path: string, data: string | Buffer, mode: number) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx", mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readOptional(path: string) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function ensurePrivateKey(path: string) {
  const existing = await readOptional(path);
  if (existing) return existing;
  const generated = await acme.crypto.createPrivateEcdsaKey("P-256");
  await atomicWrite(path, generated, 0o600);
  return (await readFile(path));
}

async function accountClient(input: Pick<PrepareAcmeOrderInput, "accountEmail" | "environment">, allowCreate: boolean) {
  const normalizedEmail = input.accountEmail.trim().toLowerCase();
  const hash = emailHash(normalizedEmail);
  const root = join(acmeRoot(), "accounts", input.environment, hash);
  const keyPath = join(root, "account.key");
  const key = allowCreate ? await ensurePrivateKey(keyPath) : await readOptional(keyPath);
  if (!key) throw new AcmeRecoveryError("ACME_ACCOUNT_KEY_MISSING", "ACME account key 不存在，无法恢复订单");
  const metadataPath = join(root, "metadata.json");
  const url = directoryUrl(input.environment);
  const metadataRaw = await readOptional(metadataPath);
  if (metadataRaw) {
    const metadata = JSON.parse(metadataRaw.toString("utf8")) as AccountMetadata;
    if (metadata.schemaVersion !== 1 || metadata.emailHash !== hash || metadata.environment !== input.environment || metadata.directoryUrl !== url || !metadata.accountUrl) {
      throw new AcmeRecoveryError("ACME_ACCOUNT_METADATA_INVALID", "ACME account metadata 与当前环境不匹配");
    }
    return new acme.Client({ directoryUrl: url, accountKey: key, accountUrl: metadata.accountUrl });
  }
  if (!allowCreate) throw new AcmeRecoveryError("ACME_ACCOUNT_METADATA_MISSING", "ACME account metadata 不存在，无法恢复订单");
  const client = new acme.Client({ directoryUrl: url, accountKey: key });
  await client.createAccount({ contact: [`mailto:${normalizedEmail}`], termsOfServiceAgreed: true });
  const metadata: AccountMetadata = { schemaVersion: 1, environment: input.environment, emailHash: hash, directoryUrl: url, accountUrl: client.getAccountUrl(), createdAt: Date.now() };
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 0o600);
  return client;
}

function expiry(value?: string, fallback?: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : (fallback ?? Date.now() + 60 * 60 * 1000);
}

export class NodeAcmeAdapter implements AcmeAdapter {
  async prepareOrder(input: PrepareAcmeOrderInput): Promise<PreparedAcmeOrder> {
    const client = await accountClient(input, input.allowAccountCreate !== false);
    await ensurePrivateKey(join(acmeRoot(), "orders", input.orderId, "private.key"));
    const order = await client.createOrder({ identifiers: input.identifiers.map((value) => ({ type: "dns", value })) });
    const authorizations = await client.getAuthorizations(order);
    const orderExpiry = order.expires ? expiry(order.expires) : null;
    const challenges = await Promise.all(authorizations.map(async (authorization) => {
      const challenge = authorization.challenges.find((item) => item.type === input.validationMethod);
      if (!challenge) throw new Error(`${authorization.identifier.value} 不支持 ${input.validationMethod}`);
      const value = await client.getChallengeKeyAuthorization(challenge);
      const hostname = authorization.identifier.value.toLowerCase().replace(/\.$/, "");
      return {
        hostname,
        type: input.validationMethod,
        token: input.validationMethod === "http-01" ? challenge.token : null,
        keyAuthorization: input.validationMethod === "http-01" ? value : null,
        dnsRecordName: input.validationMethod === "dns-01" ? `_acme-challenge.${hostname}` : null,
        dnsRecordValue: input.validationMethod === "dns-01" ? value : null,
        expiresAt: expiry(authorization.expires, orderExpiry ?? undefined),
      } satisfies PreparedAcmeChallenge;
    }));
    return { orderUrl: order.url, expiresAt: orderExpiry, challenges };
  }

  async acknowledgeChallenges(input: ExistingAcmeOrderInput) {
    const { client, order } = await this.loadOrder(input);
    const authorizations = await client.getAuthorizations(order);
    this.assertIdentifiers(input.identifiers, authorizations.map((authorization) => authorization.identifier.value));
    for (const authorization of authorizations) {
      if (authorization.status === "valid") continue;
      if (authorization.status !== "pending") throw new Error(`ACME 授权状态不可继续: ${authorization.status}`);
      const challenge = authorization.challenges.find((item) => item.type === input.validationMethod);
      if (!challenge) throw new Error(`${authorization.identifier.value} 不支持 ${input.validationMethod}`);
      if (challenge.status === "invalid") throw new Error("ACME Challenge 已失效");
      if (challenge.status === "pending") await client.completeChallenge(challenge);
    }
  }

  async pollOrder(input: ExistingAcmeOrderInput): Promise<AcmeOrderProgress> {
    const { client, order } = await this.loadOrder(input);
    const authorizations = await client.getAuthorizations(order);
    this.assertIdentifiers(input.identifiers, authorizations.map((authorization) => authorization.identifier.value));
    return {
      orderStatus: order.status,
      authorizations: authorizations.map((authorization) => ({
        hostname: authorization.identifier.value.toLowerCase().replace(/\.$/, ""),
        status: authorization.status,
      })),
    };
  }

  async finalizeOrder(input: ExistingAcmeOrderInput): Promise<FinalizedAcmeOrder> {
    const { client, order } = await this.loadOrder(input);
    if (order.status === "invalid") throw new Error("ACME Order 已失效");
    let current = order;
    if (current.status === "ready") {
      const privateKey = await readFile(join(acmeRoot(), "orders", input.orderId, "private.key"));
      const [, csr] = await acme.crypto.createCsr({ commonName: input.identifiers[0], altNames: input.identifiers }, privateKey);
      current = await client.finalizeOrder(current, csr);
    }
    if (current.status !== "valid") return { status: "pending" };
    return { status: "downloaded", certificatePem: await client.getCertificate(current) };
  }

  private async loadOrder(input: ExistingAcmeOrderInput) {
    const client = await accountClient(input, false);
    const order = await client.getOrder({ url: input.orderUrl } as acme.Order);
    return { client, order };
  }

  private assertIdentifiers(expectedIdentifiers: string[], actualIdentifiers: string[]) {
    const expected = expectedIdentifiers.map((value) => value.toLowerCase().replace(/\.$/, "")).sort();
    const actual = actualIdentifiers.map((value) => value.toLowerCase().replace(/\.$/, "")).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("ACME 返回的授权域名与订单不一致");
  }
}

let defaultAdapter: AcmeAdapter | null = null;

export function getAcmeAdapter() {
  defaultAdapter ??= new NodeAcmeAdapter();
  return defaultAdapter;
}
