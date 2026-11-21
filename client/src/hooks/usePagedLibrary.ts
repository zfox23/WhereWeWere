import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 * Loaded rows parked by `snapshotKey` when a paged list unmounts, so coming
 * back to it (Back from a row's page) shows the same rows rather than just the
 * first page. Module-level so it outlives the component; entries expire.
 */
const snapshots = new Map<string, { rows: unknown[]; total: number; savedAt: number }>();
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SNAPSHOTS = 20;
/** The most rows a revalidation asks for in one request (the servers' page limit). */
const MAX_REVALIDATE = 500;

export interface PagedLibraryOptions {
  /**
   * Identity of this list's rows (the history entry and its filters). When a
   * list with the same key was unmounted recently, its rows come back at once
   * and are refreshed in place, in one request for as many rows.
   */
  snapshotKey?: string | null;
}

/**
 * A server-paged library: the first page loads again whenever `deps` change
 * (a new search, sort, filter or period), and `loadMore` appends the next page.
 * `fetchPage(offset, limit?)` should close over the current filters; `limit`,
 * when given, overrides the page size (used to refresh restored rows).
 */
export function usePagedLibrary<T>(
  fetchPage: (offset: number, limit?: number) => Promise<Page<T>>,
  deps: unknown[],
  opts: PagedLibraryOptions = {},
) {
  const restored = useRef<{ rows: T[]; total: number } | null | undefined>(undefined);
  if (restored.current === undefined) {
    const snap = opts.snapshotKey ? snapshots.get(opts.snapshotKey) : undefined;
    restored.current = snap && Date.now() - snap.savedAt < SNAPSHOT_MAX_AGE_MS ? { rows: snap.rows as T[], total: snap.total } : null;
  }
  const [rows, setRows] = useState<T[]>(restored.current?.rows ?? []);
  const [total, setTotal] = useState(restored.current?.total ?? 0);
  const [loading, setLoading] = useState(!restored.current);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  // Each reset bumps this, so a slow answer for an old filter is dropped.
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  // Park the rows under the key they were loaded for.
  const parked = useRef({ key: opts.snapshotKey, rows, total });
  parked.current = { key: opts.snapshotKey, rows, total };
  useLayoutEffect(
    () => () => {
      const { key, rows: current, total: count } = parked.current;
      if (!key || current.length === 0) return;
      snapshots.delete(key);
      snapshots.set(key, { rows: current, total: count, savedAt: Date.now() });
      if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value as string);
    },
    [],
  );

  useEffect(() => {
    const mine = ++generation.current;
    const revalidate = restored.current;
    restored.current = null;
    if (revalidate) {
      // Restored rows stay on screen; refresh them in place (edits and deletes made meanwhile).
      if (revalidate.rows.length <= MAX_REVALIDATE) {
        fetchRef
          .current(0, revalidate.rows.length)
          .then((page) => {
            if (generation.current !== mine) return;
            setRows(page.rows);
            setTotal(page.total);
          })
          .catch(() => undefined);
      }
      return;
    }
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

  /** Drop rows the user just deleted or removed, without reloading. */
  const removeWhere = useCallback((predicate: (row: T) => boolean) => {
    setRows((prev) => {
      const kept = prev.filter((r) => !predicate(r));
      setTotal((t) => Math.max(0, t - (prev.length - kept.length)));
      return kept;
    });
  }, []);

  return { rows, total, loading, loadingMore, error, loadMore, removeWhere };
}

/** For tests: forget every parked list. */
export function resetPagedSnapshots(): void {
  snapshots.clear();
}
