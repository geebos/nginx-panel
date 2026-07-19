import { beginServiceShutdown } from "./service-lifecycle";

export type DrainableServer = {
  close: (callback: (error?: Error) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
};

export async function drainWorker(input: {
  server: DrainableServer;
  timeoutMs: number;
  stopProducers: Array<() => void>;
  persistAcmeState: () => Promise<void>;
  waitForWork: Array<() => Promise<unknown>>;
  markInterrupted: () => Promise<void>;
}) {
  for (const stop of input.stopProducers) stop();
  await beginServiceShutdown();
  await input.persistAcmeState();

  const serverClosed = new Promise<void>((resolve, reject) => {
    input.server.close((error) => error ? reject(error) : resolve());
    input.server.closeIdleConnections?.();
  });
  const workCompleted = Promise.all([serverClosed, ...input.waitForWork.map((wait) => wait())]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), input.timeoutMs);
  });
  const result = await Promise.race([workCompleted.then(() => "complete" as const), deadline]);
  if (timeout) clearTimeout(timeout);
  if (result === "timeout") {
    await input.markInterrupted();
    input.server.closeAllConnections?.();
    return { timedOut: true } as const;
  }
  return { timedOut: false } as const;
}
