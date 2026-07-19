import type { LogQuery } from "@/shared/schemas";
import { sanitizeLogLine } from "./reader";

export function parseLogLine(type: "access" | "error", line: string) {
  const raw = sanitizeLogLine(line);
  let fields: Record<string, string | number | null> = {};
  let parsed = false;

  if (type === "access") {
    try {
      fields = JSON.parse(raw) as Record<string, string | number | null>;
      for (const name of ["status", "request_time"]) {
        if (typeof fields[name] === "string" && fields[name] !== "") fields[name] = Number(fields[name]);
      }
      parsed = true;
    } catch {}
  } else {
    const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2}) \[([^\]]+)\] (.*)$/);
    if (match) {
      fields = {
        timestamp: `${match[1]}-${match[2]}-${match[3]}T${match[4]}`,
        level: match[5],
        message: match[6],
      };
      parsed = true;
    }
  }

  return {
    fields,
    parsed,
    raw,
    timestamp: typeof fields.timestamp === "string" ? fields.timestamp : null,
  };
}

export function matchesLogFilters(
  parsed: ReturnType<typeof parseLogLine>,
  filters: Pick<LogQuery, "keyword" | "method" | "status">,
) {
  if (filters.keyword && !parsed.raw.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
  if (filters.method && parsed.fields.method !== filters.method) return false;
  if (filters.status && Number(parsed.fields.status) !== filters.status) return false;
  return true;
}
