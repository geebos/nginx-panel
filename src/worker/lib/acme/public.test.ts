import assert from "node:assert/strict";
import test from "node:test";
import { publicCertificate, publicChallenge, publicOrder } from "@/worker/lib/acme/public";

const baseOrder = {
  id: "order-1",
  domainId: "domain-1",
  replacesCertificateId: null,
  validationMethod: "http-01" as const,
  dnsProvider: null,
  cloudflareCredentialId: null,
  cloudflareCredentialName: null,
  accountEmail: "admin@example.com",
  environment: "staging" as const,
  status: "waiting_http" as const,
  identifiersJson: JSON.stringify(["example.com", "www.example.com"]),
  orderUrl: null,
  unpublishedBaseVersionId: null,
  cleanupStatus: "pending" as const,
  nextPollAt: null,
  lastPolledAt: null,
  expiresAt: null,
  errorCode: null,
  errorMessage: null,
  idempotencyKey: "secret-key",
  createdAt: 1,
  updatedAt: 2,
};

test("publicOrder hides idempotencyKey and exposes parsed identifiers", () => {
  const result = publicOrder(baseOrder as never);
  assert.equal("idempotencyKey" in result, false);
  assert.equal("identifiersJson" in result, false);
  assert.deepEqual(result.identifiers, ["example.com", "www.example.com"]);
  assert.equal(result.id, "order-1");
  assert.equal(result.status, "waiting_http");
  assert.equal(result.accountEmail, "admin@example.com");
});

test("publicChallenge exposes dnsRecordValue only for dns-01", () => {
  const dns = publicChallenge({
    id: "c1",
    acmeOrderId: "order-1",
    hostname: "example.com",
    type: "dns-01",
    status: "pending",
    token: "tok",
    keyAuthorization: "ka",
    dnsRecordName: "_acme-challenge.example.com",
    dnsRecordValue: "token-value",
    dnsRecordId: null,
    expiresAt: 10,
    cleanedAt: null,
    createdAt: 1,
    updatedAt: 1,
  } as never);
  assert.equal(dns.dnsRecordValue, "token-value");
  assert.equal("token" in dns, false);
  assert.equal("keyAuthorization" in dns, false);

  const http = publicChallenge({
    id: "c2",
    acmeOrderId: "order-1",
    hostname: "example.com",
    type: "http-01",
    status: "pending",
    token: "tok",
    keyAuthorization: "ka",
    dnsRecordName: null,
    dnsRecordValue: "should-hide",
    dnsRecordId: null,
    expiresAt: 10,
    cleanedAt: null,
    createdAt: 1,
    updatedAt: 1,
  } as never);
  assert.equal(http.dnsRecordValue, null);
});

test("publicCertificate parses sans and attaches domain fields", () => {
  const result = publicCertificate(
    {
      id: "cert-1",
      domainId: "domain-1",
      acmeOrderId: "order-1",
      provider: "letsencrypt",
      environment: "production",
      status: "active",
      sansJson: JSON.stringify(["example.com"]),
      certPath: "/secret/cert.pem",
      keyPath: "/secret/key.pem",
      certFileChecksum: "c",
      publicKeySpkiChecksum: "k",
      notBefore: 1,
      notAfter: 2,
      autoRenew: true,
      issuedAt: 3,
      activatedAt: 4,
      nextCheckAt: 5,
      lastErrorCode: null,
      lastValidationMethod: "http-01",
      lastDnsProvider: null,
      lastCloudflareCredentialId: null,
      createdAt: 1,
      updatedAt: 1,
    } as never,
    {
      primaryHostname: "example.com",
      enabled: true,
      activeVersionId: "version-1",
    },
  );
  assert.deepEqual(result.sans, ["example.com"]);
  assert.equal(result.primaryHostname, "example.com");
  assert.equal(result.domainEnabled, true);
  assert.equal(result.activeVersionId, "version-1");
  assert.equal(result.id, "cert-1");
  assert.equal("certPath" in result, false);
  assert.equal("keyPath" in result, false);
  assert.equal("sansJson" in result, false);
});
