/** Badge status for a domain row: disabled overrides runtime when the domain is off. */
export function domainDisplayStatus(domain: {
  enabled: boolean;
  runtimeStatus: string;
}): string {
  return domain.enabled ? domain.runtimeStatus : "disabled";
}
