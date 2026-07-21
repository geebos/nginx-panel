/** Cloudflare terminal/cancel cleanup bookkeeping fields for acme_orders. */

export function orderCleanupStatus(dnsProvider: string | null | undefined): "pending" | "succeeded" {
  return dnsProvider === "cloudflare" ? "pending" : "succeeded";
}

/** nextPollAt when ending an order that may still need Cloudflare DNS cleanup. */
export function orderCleanupNextPollAt(
  dnsProvider: string | null | undefined,
  now: number,
): number | null {
  return dnsProvider === "cloudflare" ? now : null;
}
