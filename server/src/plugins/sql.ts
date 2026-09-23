/**
 * SQL condition builder shared by every unified-timeline WHERE clause.
 *
 * Each branch (built-in types, generic storage, custom-storage plugins)
 * combines the same user/date/search conditions with its own extras. This
 * helper replaces the copy-pasted `push`/conditions boilerplate and gives
 * plugins a one-call way to get the default conditions.
 */

import type { PluginTimelineContext } from 'wwp-shared';

/**
 * Accumulates SQL conditions with positional `$n` placeholders. Write
 * conditions with `?` markers (one per value, in order); they are rewritten
 * to `$n` relative to the accumulated values.
 */
export interface SqlConditions {
  /** Append a condition (and its values). */
  push(cond: string, ...values: unknown[]): void;
  /** Join conditions with AND; `sql` is null when there are none. */
  build(): { sql: string | null; values: unknown[] };
}

export function createSqlConditions(): SqlConditions {
  const conditions: string[] = [];
  const values: unknown[] = [];
  return {
    push(cond: string, ...vals: unknown[]) {
      const base = values.length;
      let i = 0;
      conditions.push(cond.replace(/\?/g, () => `$${base + ++i}`));
      values.push(...vals);
    },
    build(): { sql: string | null; values: unknown[] } {
      return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
    },
  };
}

export interface TimelineWhereOptions {
  /** Table alias for the check-in table in this branch (e.g. 'mc'). */
  alias: string;
  /** The timestamp column to compare against `from`/`to` (e.g. 'checked_in_at'). */
  timestampColumn: string;
  /** The IANA timezone column for local-date conversion (e.g. 'mood_timezone'). */
  timezoneColumn?: string;
  /**
   * Free-text search condition. Called with the builder and the query when
   * `ctx.q` is set. Omit to make search a no-op for this type.
   */
  search?: (conds: SqlConditions, searchQuery: string) => void;
}

/**
 * Append the shared user/date/search conditions to `conds` (or create a new
 * builder when omitted). Date bounds compare the local calendar date of the
 * check-in (timestamp converted with its stored timezone) against `from`/`to`.
 *
 * Callers add their type-specific filter conditions to the returned builder,
 * then call `build()`.
 */
export function timelineWhereConditions(
  ctx: Pick<PluginTimelineContext, 'user_id' | 'from' | 'to' | 'q'>,
  opts: TimelineWhereOptions,
  conds: SqlConditions = createSqlConditions(),
): SqlConditions {
  const { alias, timestampColumn, timezoneColumn, search } = opts;
  const tz = timezoneColumn
    ? `COALESCE(${alias}.${timezoneColumn}, 'UTC')`
    : `'UTC'`;
  if (ctx.user_id) {
    conds.push(`${alias}.user_id = ?`, ctx.user_id);
  }
  if (ctx.from) {
    conds.push(
      `(${alias}.${timestampColumn} AT TIME ZONE ${tz})::date >= ?::date`,
      ctx.from,
    );
  }
  if (ctx.to) {
    conds.push(
      `(${alias}.${timestampColumn} AT TIME ZONE ${tz})::date <= ?::date`,
      ctx.to,
    );
  }
  if (ctx.q && search) {
    search(conds, ctx.q);
  }
  return conds;
}
