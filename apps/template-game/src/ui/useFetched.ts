// Fetch-on-mount/deps helper: state is set from the promise callback (never synchronously inside
// the effect body), stale results are dropped, `reload()` re-runs the fetcher.
import { useCallback, useEffect, useState } from 'react';

export function useFetched<T>(fetcher: () => Promise<T | null>): {
  data: T | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void n;
    fetcher().then(
      (d) => {
        if (alive && d !== null) setData(d);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [fetcher, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, reload };
}
