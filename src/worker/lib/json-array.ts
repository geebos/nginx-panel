/**
 * Parse a persisted DB string-array JSON column.
 * No runtime array check — same as prior `JSON.parse(...) as string[]`.
 */
export function parseStringArrayJson(json: string): string[] {
  return JSON.parse(json) as string[];
}
