import { useCallback, useEffect, useRef, useState } from 'react';

export interface Page<T> {
  rows: T[];
  /** Matches across every page, not just the loaded ones. */
  total: number;
}

/** `value`, but only after it has stopped changing for `ms` (for search boxes that query the server). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * A server-paged library: the first page loads again whenever `deps` change
 * (a new search, sort, filter or period), and `loadMore` appends the next page.
 * `fetchPage(offset)` should close over the current filters.
 */
export function usePagedLibrary<T>(fetchPage: (offset: number) => Promise<Page<T>>, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  // Each reset bumps this, so a slow answer for an old filter is dropped.
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(false);
    fetchRef
      .current(0)
      .then((page) => {
        if (generation.current !== mine) return;
        setRows(page.rows);
        setTotal(page.total);
      })
      .catch((err) => {
        console.error('Failed to load library:', err);
        if (generation.current !== mine) return;
        setRows([]);
        setTotal(0);
        setError(true);
      })
      .finally(() => {
        if (generation.current === mine) setLoading(false);
      });
    // The caller's filters are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    const mine = generation.current;
    setLoadingMore(true);
    fetchRef
      .current(rows.length)
      .then((page) => {
        if (generation.current !== mine) return;
        setRows((prev) => [...prev, ...page.rows]);
        setTotal(page.total);
      })
      .catch(() => generation.current === mine && setError(true))
      .finally(() => setLoadingMore(false));
  }, [rows.length]);

  return { rows, total, loading, loadingMore, error, loadMore, setRows };
}
