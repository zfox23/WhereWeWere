/**
 * Small helpers for turning untrusted query-string values into safe numbers.
 * `parseInt` alone yields NaN/negatives that Postgres rejects (a 500 instead of
 * a 400) or, with no upper bound, lets one request load an entire table.
 */

/** Parse an integer query value, clamped to [min, max]; `fallback` when missing/invalid. */
export function clampInt(raw: unknown, opts: { fallback: number; min: number; max: number }): number {
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? Math.trunc(raw) : NaN;
  if (!Number.isFinite(parsed)) return opts.fallback;
  return Math.min(Math.max(parsed, opts.min), opts.max);
}

/** Pagination pair with the project's standard bounds. */
export function pagination(
  limit: unknown,
  offset: unknown,
  defaults: { limit?: number; maxLimit?: number } = {}
): { limit: number; offset: number } {
  return {
    limit: clampInt(limit, { fallback: defaults.limit ?? 50, min: 1, max: defaults.maxLimit ?? 500 }),
    offset: clampInt(offset, { fallback: 0, min: 0, max: 10_000_000 }),
  };
}

/** A plausible calendar year, or null when the value isn't one. */
export function parseYear(raw: unknown): number | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2200 ? n : null;
}

/** A month number 1-12, or null. */
export function parseMonth(raw: unknown): number | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/** Escape LIKE/ILIKE wildcards so user text is matched literally (use with `ESCAPE '\\'`, Postgres' default). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
