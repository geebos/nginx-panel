import { domainConfigSchema, type DomainConfig } from "@/shared/schemas";

/** Parse a persisted domain config version snapshot JSON string. */
export function parseDomainSnapshot(json: string): DomainConfig {
  return domainConfigSchema.parse(JSON.parse(json));
}
