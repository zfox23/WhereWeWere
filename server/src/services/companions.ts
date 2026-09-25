/**
 * Core companion service.
 *
 * Companions (people "with" on a check-in) are a cross-cutting check-in
 * attribute: any check-in type plugin can implement them (location, media,
 * ...). All such types share this single storage table (`companions`,
 * migration 048), this service layer, the core autocomplete endpoint
 * (/api/v1/companions/names), and the client's CompanionChipInput component.
 *
 * Rows are keyed by (checkin_type, checkin_id, name):
 *   - checkin_type is the check-in type's plugin id (e.g. 'location',
 *     'media') — the same string used in the unified timeline `type` column.
 *   - checkin_id is the plugin-owned check-in row's id.
 *
 * There is intentionally no FK to the plugin's check-in table (the core
 * cannot reference plugin-owned tables); companion rows are cleaned up by
 * the owning plugin on check-in deletion and by its start-over/backup hooks.
 */

import { query, pool } from '../db';
/** Anything able to run parameterized queries (pool or a tx client). */
export type QueryExecutor = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

/** Resolves to the given executor when non-null, else the shared query helper. */
function executor(client: QueryExecutor | null | undefined): QueryExecutor {
  if (client) return client;
  return {
    query: (sql: string, values?: unknown[]) =>
      query(sql, (values ?? []) as never[]) as Promise<{ rows: any[]; rowCount?: number | null }>,
  };
}

/**
 * Trim, de-duplicate, and drop empty companion names (case-insensitive
 * dedupe). The canonical payload normalization used by every plugin that
 * accepts companions from a client.
 */
export function normalizeCompanions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Companion names for a single check-in, ordered alphabetically. */
export async function getCompanions(
  checkinType: string,
  checkinId: string,
  client?: QueryExecutor | null,
): Promise<string[]> {
  const result = await executor(client).query(
    `SELECT name FROM companions
     WHERE checkin_type = $1 AND checkin_id = $2
     ORDER BY name`,
    [checkinType, checkinId],
  );
  return result.rows.map((r) => r.name as string);
}

/**
 * Companion names for a set of check-ins, grouped by check-in id (each list
 * alphabetically ordered). Missing check-ins simply get no entry.
 */
export async function getCompanionsByCheckin(
  checkinType: string,
  checkinIds: string[],
  client?: QueryExecutor | null,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (checkinIds.length === 0) return map;
  const result = await executor(client).query(
    `SELECT checkin_id, name FROM companions
     WHERE checkin_type = $1 AND checkin_id = ANY($2::uuid[])
     ORDER BY checkin_id, name`,
    [checkinType, checkinIds],
  );
  for (const row of result.rows) {
    const key = row.checkin_id as string;
    const list = map.get(key) ?? [];
    list.push(row.name as string);
    map.set(key, list);
  }
  return map;
}

/**
 * Idempotently insert companion names for a check-in (used when creating a
 * check-in; existing (type, checkin, name) rows are kept).
 */
export async function insertCompanions(
  checkinType: string,
  checkinId: string,
  names: unknown,
  client?: QueryExecutor | null,
): Promise<void> {
  const clean = normalizeCompanions(names);
  if (clean.length === 0) return;
  await executor(client).query(
    `INSERT INTO companions (checkin_type, checkin_id, name)
     SELECT $1, $2, unnest($3::text[])
     ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING`,
    [checkinType, checkinId, clean],
  );
}

/**
 * Full-replacement set for a check-in's companions (used when updating a
 * check-in): deletes the check-in's existing rows and re-inserts `names`.
 * `names` may be a raw client payload — it is normalized internally.
 * Returns the stored (normalized) names.
 */
export async function setCompanions(
  checkinType: string,
  checkinId: string,
  names: unknown,
  client?: QueryExecutor | null,
): Promise<string[]> {
  const clean = normalizeCompanions(names);
  const ex = executor(client);
  await ex.query(
    'DELETE FROM companions WHERE checkin_type = $1 AND checkin_id = $2',
    [checkinType, checkinId],
  );
  if (clean.length > 0) {
    await ex.query(
      `INSERT INTO companions (checkin_type, checkin_id, name)
       SELECT $1, $2, unnest($3::text[])
       ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING`,
      [checkinType, checkinId, clean],
    );
  }
  return clean;
}

/** Delete all companion rows for the given check-ins of a type. */
export async function deleteCompanionsForCheckins(
  checkinType: string,
  checkinIds: string[],
  client?: QueryExecutor | null,
): Promise<void> {
  if (checkinIds.length === 0) return;
  await executor(client).query(
    'DELETE FROM companions WHERE checkin_type = $1 AND checkin_id = ANY($2::uuid[])',
    [checkinType, checkinIds],
  );
}

/**
 * Distinct companion names for autocomplete, case-insensitively filtered by
 * `q` (ILIKE) when present, alphabetically ordered. Shared across all
 * check-in types so a name typed on one type autocompletes on every other.
 */
export async function searchCompanionNames(
  q?: string | null,
  limit?: number | string,
  client?: QueryExecutor | null,
): Promise<string[]> {
  const limitNum = Math.min(Math.max(parseInt(String(limit ?? 50), 10) || 50, 1), 200);
  const params: unknown[] = [];
  let sql = 'SELECT name FROM companions';
  if (q && q.trim() !== '') {
    params.push(`%${q.trim()}%`);
    sql += ' WHERE name ILIKE $1';
  }
  sql += `
    GROUP BY name
    ORDER BY name
    LIMIT $${params.length + 1}`;
  params.push(limitNum);
  const result = await executor(client).query(sql, params);
  return result.rows.map((r) => r.name as string);
}

/**
 * SQL fragment for embedding a check-in's companion names in a larger
 * SELECT (e.g. a timeline branch's `data` jsonb or a dedicated envelope
 * column): a scalar jsonb array of names, '[]' when the check-in has none.
 *
 * `checkinIdColumn` is the column expression holding the check-in id (e.g.
 * `c.id`). The check-in type is interpolated — it must be a valid plugin id
 * (the registry enforces /^[a-z][a-z0-9_]*$/), never client input.
 */
export function companionNamesSql(checkinType: string, checkinIdColumn: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(checkinType)) {
    throw new Error(`Invalid companion checkin_type: ${checkinType}`);
  }
  return `SELECT COALESCE(json_agg(name ORDER BY name), '[]'::json)
         FROM companions
         WHERE checkin_type = '${checkinType}' AND checkin_id = ${checkinIdColumn}`;
}
