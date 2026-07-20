import { open } from "node:fs/promises";

const chunkSize = 64 * 1024;

export async function readLastLines(path: string, limit: number, maxScanBytes = 8 * 1024 * 1024) {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    let position = size;
    let scanned = 0;
    let remainder = Buffer.alloc(0);
    const lines: Buffer[] = [];
    while (position > 0 && lines.length <= limit && scanned < maxScanBytes) {
      const length = Math.min(chunkSize, position, maxScanBytes - scanned);
      position -= length;
      scanned += length;
      const chunk = Buffer.allocUnsafe(length);
      await file.read(chunk, 0, length, position);
      const data = Buffer.concat([chunk, remainder]);
      let end = data.length;
      for (let index = data.length - 1; index >= 0 && lines.length <= limit; index -= 1) {
        if (data[index] !== 0x0a) continue;
        if (end > index + 1) lines.push(Buffer.from(data.subarray(index + 1, end)));
        end = index;
      }
      remainder = Buffer.from(data.subarray(0, end));
    }
    if (position === 0 && remainder.length && lines.length < limit) lines.push(remainder);
    return {
      lines: lines.slice(0, limit).reverse().map((line) => line.toString("utf8")),
      truncated: position > 0 || lines.length > limit,
    };
  } finally {
    await file.close();
  }
}

export function sanitizeLogLine(line: string) {
  return line.replace(/\0/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 64 * 1024);
}
