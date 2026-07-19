import { createHash } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

export function createSnapshot(value: unknown) {
  const json = JSON.stringify(sortValue(value));
  return {
    json,
    checksum: createHash("sha256").update(json).digest("hex"),
  };
}
