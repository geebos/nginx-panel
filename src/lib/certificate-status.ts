import { certificateRenewalWindowMs } from "@/shared/schemas";

export type CertificateDisplayStatus =
  | "ready"
  | "active"
  | "expiring"
  | "expired"
  | "failed"
  | "superseded";

/** Effective badge/filter status for a certificate row (failed → expired → expiring → raw). */
export function certificateDisplayStatus(
  certificate: { status: string; notAfter: number | null },
  now: number,
): CertificateDisplayStatus {
  if (certificate.status === "failed") return "failed";
  if (certificate.notAfter && certificate.notAfter <= now) return "expired";
  if (
    certificate.status === "active" &&
    certificate.notAfter &&
    certificate.notAfter - now <= certificateRenewalWindowMs
  ) {
    return "expiring";
  }
  return certificate.status as CertificateDisplayStatus;
}
