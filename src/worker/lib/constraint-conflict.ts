import type { AppEnv } from "@/worker/types";
import { assertHostnamesAvailable } from "./domain-validation";
import { BusinessError } from "./errors";

function isUniqueConstraint(error: unknown, ...columns: string[]) {
  return error instanceof Error
    && Boolean((error as Error & { code?: string }).code?.startsWith("SQLITE_CONSTRAINT"))
    && columns.every((column) => error.message.includes(column));
}

function isAnyUniqueConstraint(error: unknown): error is Error & { code?: string } {
  return error instanceof Error
    && Boolean((error as Error & { code?: string }).code?.startsWith("SQLITE_CONSTRAINT"))
    && error.message.includes("UNIQUE constraint failed");
}

export async function rethrowWriteConflict(
  db: AppEnv["Variables"]["db"],
  error: unknown,
  hostnames: string[],
  excludedDomainId?: string,
): Promise<never> {
  if (error instanceof BusinessError) throw error;
  if (
    isUniqueConstraint(error, "domains.primary_hostname")
    || isUniqueConstraint(error, "domain_aliases.hostname")
  ) {
    await assertHostnamesAvailable(db, hostnames, excludedDomainId);
    throw new BusinessError("errors:domainConflict", 409, "DOMAIN_CONFLICT");
  }
  if (isUniqueConstraint(error, "config_versions.domain_id", "config_versions.version_number")) {
    throw new BusinessError(
      "errors:versionConflict",
      409,
      "VERSION_CONFLICT",
    );
  }
  if (isAnyUniqueConstraint(error)) {
    throw new BusinessError(
      "errors:resourceConflict",
      409,
      "RESOURCE_CONFLICT",
      { cause: error },
    );
  }
  throw error;
}
