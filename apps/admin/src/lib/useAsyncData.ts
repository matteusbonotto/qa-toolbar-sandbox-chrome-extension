import { useCallback, useEffect, useState } from "react";

interface AsyncDataState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const run = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  useEffect(() => run(), [run]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
