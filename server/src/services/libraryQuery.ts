/**
 * The shared shape of a searchable, sortable, paged library endpoint
 * (`?q=&sort=&dir=&limit=&offset=` in, `{ rows, total }` out).
 *
 * Request values are bounded here and sorts come from a whitelist the caller
 * owns, so nothing a request says is ever interpolated into SQL except the
 * validated numbers and the whitelisted column expression.
 *
 * Typical use: group in a subquery `g`, then
 *   SELECT g.*, COUNT(*) OVER()::int AS total FROM (...) g
 *   ORDER BY ${orderBy(SORTS, p.sort, p.dir, 'last_at DESC, lower(g.name)')}
 *   LIMIT ${p.limit} OFFSET ${p.offset}
 */

import { clampInt, escapeLike } from './queryParams';

export interface LibraryParams {
  /** Search text as the user typed it, trimmed and bounded. */
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface LibraryParamOptions {
  /** Allowed sort keys (the keys of the caller's whitelist). */
  sorts: string[];
  defaultSort: string;
  defaultDir?: 'asc' | 'desc';
  defaultLimit?: number;
  maxLimit?: number;
}

export const MAX_SEARCH_LENGTH = 200;

/** Read and bound `q`, `sort`, `dir`, `limit` and `offset` from a query string. */
export function parseLibraryParams(query: Record<string, unknown>, opts: LibraryParamOptions): LibraryParams {
  const sort = typeof query.sort === 'string' && opts.sorts.includes(query.sort) ? query.sort : opts.defaultSort;
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : opts.defaultDir ?? 'desc';
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, MAX_SEARCH_LENGTH) : '',
    sort,
    dir,
    limit: clampInt(query.limit, { fallback: opts.defaultLimit ?? 100, min: 1, max: opts.maxLimit ?? 500 }),
    offset: clampInt(query.offset, { fallback: 0, min: 0, max: 1_000_000 }),
  };
}

/** Lower-cased, wildcard-escaped search text for `lower(col) LIKE '%' || $n || '%' ESCAPE '\'`. */
export const likeText = (q: string): string => escapeLike(q.trim().toLowerCase());

/**
 * `ORDER BY` body: the whitelisted expression for `sort` in `dir` (nulls last),
 * then `tiebreak` so pages are stable.
 */
export function orderBy(sorts: Record<string, string>, sort: string, dir: 'asc' | 'desc', tiebreak: string): string {
  const expr = sorts[sort];
  if (!expr) throw new Error(`Unknown sort "${sort}"`);
  return `${expr} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, ${tiebreak}`;
}

/** Split rows that carry a `COUNT(*) OVER() AS total` column into `{ rows, total }`. */
export function pageResult<T extends { total?: number }>(rows: T[]): { rows: Omit<T, 'total'>[]; total: number } {
  return { rows: rows.map(({ total: _t, ...row }) => row), total: rows[0]?.total ?? 0 };
}
