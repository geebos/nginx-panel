import { acmeChallenges, acmeOrders, certificates } from "@/shared/schemas";
import { parseStringArrayJson } from "@/worker/lib/json-array";

export function publicOrder(order: typeof acmeOrders.$inferSelect) {
  const { idempotencyKey: _idempotencyKey, identifiersJson, ...safe } = order;
  void _idempotencyKey;
  return { ...safe, identifiers: parseStringArrayJson(identifiersJson) };
}

export function publicChallenge(challenge: typeof acmeChallenges.$inferSelect) {
  return {
    id: challenge.id,
    hostname: challenge.hostname,
    type: challenge.type,
    status: challenge.status,
    dnsRecordName: challenge.dnsRecordName,
    dnsRecordValue: challenge.type === "dns-01" ? challenge.dnsRecordValue : null,
    expiresAt: challenge.expiresAt,
    cleanedAt: challenge.cleanedAt,
  };
}

export function publicCertificate(
  certificate: typeof certificates.$inferSelect,
  domain: { primaryHostname: string; enabled: boolean; activeVersionId: string | null },
) {
  return {
    id: certificate.id,
    domainId: certificate.domainId,
    acmeOrderId: certificate.acmeOrderId,
    provider: certificate.provider,
    environment: certificate.environment,
    status: certificate.status,
    sans: parseStringArrayJson(certificate.sansJson),
    notBefore: certificate.notBefore,
    notAfter: certificate.notAfter,
    autoRenew: certificate.autoRenew,
    issuedAt: certificate.issuedAt,
    activatedAt: certificate.activatedAt,
    nextCheckAt: certificate.nextCheckAt,
    lastErrorCode: certificate.lastErrorCode,
    primaryHostname: domain.primaryHostname,
    domainEnabled: domain.enabled,
    activeVersionId: domain.activeVersionId,
  };
}
