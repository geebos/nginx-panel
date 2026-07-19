export function safeRedirectPath(value: string | string[] | undefined) {
  if (typeof value !== "string" || /[\\\r\n\0]/.test(value)) return "/dashboard";

  let decoded = value;
  try {
    for (let index = 0; index < 5; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return "/dashboard";
  }

  return !/[\\\r\n\0]/.test(decoded)
    && !/%(?:25)*(?:2f|5c)/i.test(decoded)
    && decoded.startsWith("/")
    && !decoded.startsWith("//")
    ? value
    : "/dashboard";
}
