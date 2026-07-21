/** Serial promise queue: failures are logged and do not break later work. */
export function createSerialQueue(logMessage: string) {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(operation: () => Promise<void>) {
      const run = tail.then(operation);
      tail = run.catch((error) => {
        console.error(logMessage, error instanceof Error ? error.name : "unknown");
      });
      return run;
    },
    wait() {
      return tail;
    },
  };
}
