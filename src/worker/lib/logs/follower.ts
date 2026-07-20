import { createHash } from "node:crypto";
import { open, stat, type FileHandle } from "node:fs/promises";

const readChunkBytes = 64 * 1024;
const maxLineBytes = 64 * 1024;

export type LogFollowSource = {
  domainId: string;
  hostname: string;
  logType: "access" | "error";
  path: string;
};

export type LogFollowEvent =
  | { type: "line"; source: LogFollowSource; fileId: string; offset: number; line: string; truncated: boolean }
  | { type: "rotated"; source: LogFollowSource; previousFileId: string; nextFileId: string };

type FollowState = {
  source: LogFollowSource;
  handle: FileHandle | null;
  fileId: string | null;
  offset: number;
  pending: Buffer;
  pendingTruncated: boolean;
  openedOnce: boolean;
};

function fileId(stats: { dev: number | bigint; ino: number | bigint }) {
  return createHash("sha256").update(`${stats.dev}:${stats.ino}`).digest("base64url").slice(0, 22);
}

async function openCurrent(state: FollowState) {
  try {
    const handle = await open(state.source.path, "r");
    const stats = await handle.stat();
    state.handle = handle;
    state.fileId = fileId(stats);
    state.offset = state.openedOnce ? 0 : stats.size;
    state.openedOnce = true;
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function consumeChunk(
  state: FollowState,
  chunk: Buffer,
  chunkOffset: number,
  emit: (event: LogFollowEvent) => Promise<void>,
) {
  let data = chunk;
  let dataOffset = chunkOffset;

  if (state.pendingTruncated) {
    const newline = data.indexOf(0x0a);
    if (newline < 0) return;
    await emit({
      type: "line",
      source: state.source,
      fileId: state.fileId!,
      offset: dataOffset + newline + 1,
      line: state.pending.toString("utf8"),
      truncated: true,
    });
    data = data.subarray(newline + 1);
    dataOffset += newline + 1;
    state.pending = Buffer.alloc(0);
    state.pendingTruncated = false;
  } else if (state.pending.length) {
    data = Buffer.concat([state.pending, data]);
    dataOffset -= state.pending.length;
    state.pending = Buffer.alloc(0);
  }

  let start = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== 0x0a) continue;
    const bytes = data.subarray(start, index);
    await emit({
      type: "line",
      source: state.source,
      fileId: state.fileId!,
      offset: dataOffset + index + 1,
      line: bytes.subarray(0, maxLineBytes).toString("utf8"),
      truncated: bytes.length > maxLineBytes,
    });
    start = index + 1;
  }

  const remainder = data.subarray(start);
  state.pending = Buffer.from(remainder.subarray(0, maxLineBytes));
  state.pendingTruncated = remainder.length > maxLineBytes;
}

async function readAvailable(state: FollowState, emit: (event: LogFollowEvent) => Promise<void>) {
  if (!state.handle && !(await openCurrent(state))) return;
  const stats = await state.handle!.stat();
  if (stats.size > state.offset) {
    const length = Math.min(readChunkBytes, stats.size - state.offset);
    const chunk = Buffer.allocUnsafe(length);
    const start = state.offset;
    const result = await state.handle!.read(chunk, 0, length, start);
    state.offset += result.bytesRead;
    await consumeChunk(state, chunk.subarray(0, result.bytesRead), start, emit);
    if (stats.size > state.offset) return;
  }

  try {
    const current = await stat(state.source.path);
    const nextFileId = fileId(current);
    if (nextFileId === state.fileId) return;
    const previousFileId = state.fileId!;
    await state.handle!.close();
    state.handle = null;
    state.fileId = null;
    state.offset = 0;
    state.pending = Buffer.alloc(0);
    state.pendingTruncated = false;
    await openCurrent(state);
    if (state.fileId) await emit({ type: "rotated", source: state.source, previousFileId, nextFileId: state.fileId });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function followLogFiles(
  sources: LogFollowSource[],
  options: {
    signal: AbortSignal;
    emit: (event: LogFollowEvent) => Promise<void>;
    heartbeat: () => Promise<void>;
    pollIntervalMs?: number;
    heartbeatMs?: number;
    maxDurationMs?: number;
  },
) {
  const states: FollowState[] = sources.map((source) => ({ source, handle: null, fileId: null, offset: 0, pending: Buffer.alloc(0), pendingTruncated: false, openedOnce: false }));
  const startedAt = Date.now();
  let heartbeatAt = startedAt;
  try {
    while (!options.signal.aborted && Date.now() - startedAt < (options.maxDurationMs ?? 30 * 60 * 1000)) {
      for (const state of states) await readAvailable(state, options.emit);
      if (Date.now() - heartbeatAt >= (options.heartbeatMs ?? 15_000)) {
        await options.heartbeat();
        heartbeatAt = Date.now();
      }
      await delay(options.pollIntervalMs ?? 250);
    }
    return options.signal.aborted ? "aborted" as const : "stream_limit" as const;
  } finally {
    await Promise.all(states.map((state) => state.handle?.close().catch(() => undefined)));
  }
}
