export function safeErrorMessage(
  error: unknown,
  fallback: string,
  urlPlaceholder = "[URL]",
): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/https?:\/\/\S+/g, urlPlaceholder).slice(0, 500);
}
