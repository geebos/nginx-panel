/** Initial challenge row status right after ACME prepare persistence. */
export function initialChallengeStatus(input: {
  challengeType: string;
  dnsProvider: string | null;
}): string {
  if (input.challengeType === "http-01") return "presented";
  if (input.dnsProvider === "cloudflare") return "pending";
  return "propagating";
}

/** Order status after prepare (before Cloudflare present continues). */
export function postPrepareOrderStatus(input: {
  dnsProvider: string | null;
  validationMethod: string;
}): string {
  if (input.dnsProvider === "cloudflare") return "preparing";
  if (input.validationMethod === "http-01") return "waiting_http";
  return "waiting_dns";
}

/** nextPollAt after prepare. Cloudflare stays immediate; others delay by method. */
export function postPrepareNextPollAt(
  now: number,
  input: {
    dnsProvider: string | null;
    validationMethod: string;
  },
): number {
  if (input.dnsProvider === "cloudflare") return now;
  return now + (input.validationMethod === "http-01" ? 5_000 : 15_000);
}
