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
    throw new BusinessError("域名已被其他配置使用", 409, "DOMAIN_CONFLICT");
  }
  if (isUniqueConstraint(error, "config_versions.domain_id", "config_versions.version_number")) {
    throw new BusinessError(
      "草稿已被其他会话修改，请刷新后重试",
      409,
      "VERSION_CONFLICT",
    );
  }
  if (isAnyUniqueConstraint(error)) {
    throw new BusinessError(
      "资源已存在或与现有数据冲突",
      409,
      "RESOURCE_CONFLICT",
      { cause: error },
    );
  }
  throw error;
}
