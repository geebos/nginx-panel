import type Database from "better-sqlite3";

type DuplicateDraft = {
  domainId: string;
  draftCount: number;
};

export function assertNoDuplicateDrafts(connection: Database.Database) {
  const hasConfigVersions = connection.prepare<[], { exists: number }>(
    "SELECT 1 AS `exists` FROM sqlite_master WHERE type = 'table' AND name = 'config_versions'",
  ).get();
  if (!hasConfigVersions) return;

  const duplicates = connection.prepare<[], DuplicateDraft>(`
    SELECT domain_id AS domainId, COUNT(*) AS draftCount
    FROM config_versions
    WHERE status = 'draft'
    GROUP BY domain_id
    HAVING COUNT(*) > 1
    ORDER BY domain_id
  `).all();
  if (duplicates.length === 0) return;

  const details = duplicates
    .map(({ domainId, draftCount }) => `${domainId} (${draftCount} Drafts)`)
    .join(", ");
  throw new Error(
    `数据库迁移无法继续：以下 Domain 存在重复 Draft，请先修复历史数据：${details}`,
  );
}
