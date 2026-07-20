import * as React from "react";

export function useApiQuery<T>(load: () => Promise<T>) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const requestRef = React.useRef(0);

  const run = React.useCallback(
    async (refresh = false) => {
      const requestId = ++requestRef.current;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const nextData = await load();
        if (requestId === requestRef.current) setData(nextData);
      } catch (nextError) {
        if (requestId === requestRef.current) {
          setError(nextError instanceof Error ? nextError : new Error("errors:requestFailed"));
        }
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [load],
  );

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void run(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current += 1;
    };
  }, [run]);

  const refresh = React.useCallback(() => run(true), [run]);

  return { data, error, loading, refreshing, refresh };
}
