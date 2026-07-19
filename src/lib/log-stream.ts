import type { LogStreamRecord } from "@/shared/schemas";

export async function consumeNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: LogStreamRecord) => void,
  onMalformed?: (line: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";

  const consume = (line: string) => {
    if (!line) return;
    try {
      onRecord(JSON.parse(line) as LogStreamRecord);
    } catch {
      onMalformed?.(line);
    }
  };

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const text = remainder + decoder.decode(result.value, { stream: true });
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";
      lines.forEach(consume);
    }
    remainder += decoder.decode();
    consume(remainder);
  } finally {
    reader.releaseLock();
  }
}
