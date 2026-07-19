import { BusinessError } from "@/worker/lib/errors";

export class LogStreamCapacity {
  private active = 0;
  private readonly sessions = new Map<string, number>();

  constructor(private readonly instanceLimit = 20, private readonly sessionLimit = 5) {}

  acquire(sessionId: string) {
    const sessionCount = this.sessions.get(sessionId) ?? 0;
    if (this.active >= this.instanceLimit || sessionCount >= this.sessionLimit) {
      throw new BusinessError(
        "实时日志连接已达上限，请先关闭已有连接",
        429,
        "LOG_STREAM_CAPACITY_EXCEEDED",
      );
    }
    this.active += 1;
    this.sessions.set(sessionId, sessionCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = (this.sessions.get(sessionId) ?? 1) - 1;
      if (next > 0) this.sessions.set(sessionId, next);
      else this.sessions.delete(sessionId);
    };
  }
}

export const logStreamCapacity = new LogStreamCapacity();
