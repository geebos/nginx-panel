import { BusinessError } from "./errors";

const HEARTBEAT_STALE_MS = 30_000;

type ShutdownListener = () => void | Promise<void>;

let phase: "running" | "draining" = "running";
let heartbeatAt: number | null = null;
const streamShutdownListeners = new Set<ShutdownListener>();

export function touchJobRunnerHeartbeat(now = Date.now()) {
  heartbeatAt = now;
}

export function startJobRunnerHeartbeat(options: { intervalMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  touchJobRunnerHeartbeat(now());
  const timer = setInterval(() => touchJobRunnerHeartbeat(now()), options.intervalMs ?? 5_000);
  timer.unref();
  return () => clearInterval(timer);
}

export function getServiceLifecycle(now = Date.now()) {
  return {
    phase,
    acceptingWrites: phase === "running",
    acceptingLogStreams: phase === "running",
    jobRunnerHeartbeatAt: heartbeatAt,
    jobRunnerHealthy: heartbeatAt !== null && now - heartbeatAt <= HEARTBEAT_STALE_MS,
    activeLogStreams: streamShutdownListeners.size,
  } as const;
}

export function assertAcceptingWrites() {
  if (phase !== "running") throw new BusinessError("errors:serverShuttingDown", 503, "SERVER_SHUTTING_DOWN");
}

export function assertAcceptingLogStreams() {
  if (phase !== "running") throw new BusinessError("errors:serverShuttingDown", 503, "SERVER_SHUTTING_DOWN");
}

export function registerLogStream(listener: ShutdownListener) {
  if (phase !== "running") {
    void listener();
    return () => undefined;
  }
  streamShutdownListeners.add(listener);
  return () => streamShutdownListeners.delete(listener);
}

export async function beginServiceShutdown() {
  if (phase === "draining") return;
  phase = "draining";
  const listeners = [...streamShutdownListeners];
  await Promise.allSettled(listeners.map((listener) => listener()));
}

export function resetServiceLifecycleForTests() {
  phase = "running";
  heartbeatAt = null;
  streamShutdownListeners.clear();
}

export const jobRunnerHeartbeatStaleMs = HEARTBEAT_STALE_MS;
