import { useCallback, useEffect, useState } from 'react';

/** A plugin's lists for its index: loaded once on mount, `refresh` after any change. */
export function useLists<L>(fetchLists: () => Promise<L[]>) {
  const [lists, setLists] = useState<L[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    fetchLists()
      .then(setLists)
      .catch(() => setLists([]))
      .finally(() => setLoading(false));
    // `fetchLists` is a module-level API call in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(refresh, [refresh]);
  return { lists, loading, refresh };
}
