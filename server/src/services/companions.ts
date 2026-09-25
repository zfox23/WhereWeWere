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

/** Summary of a companion name for the Profile "Companions" tab. */
export interface CompanionSummary {
  name: string;
  /** Number of check-ins this name appears on (standalone names count as 0). */
  checkin_count: number;
  /** ISO timestamp of the most recent check-in carrying this name, or null. */
  last_checkin_at: string | null;
}

/**
 * One row per companion name: how many check-ins it appears on and the most
 * recent such check-in. `timestampUnionSql` must resolve check-in ids to
 * anchor timestamps — use the registry's `pluginTimestampUnion()` (it takes
 * $1, a uuid[] of ids) — and is LEFT JOINed on checkin_id.
 */
export async function listCompanionSummaries(
  timestampUnionSql: string,
  client?: QueryExecutor | null,
): Promise<CompanionSummary[]> {
  const ex = executor(client);
  const idsResult = await ex.query(
    'SELECT DISTINCT checkin_id FROM companions WHERE checkin_id IS NOT NULL',
  );
  const checkinIds: string[] = idsResult.rows.map((r) => r.checkin_id as string);
  const result = await ex.query(
    `SELECT c.name,
            COUNT(c.checkin_id) AS checkin_count,
            MAX(t.checked_in_at) AS last_checkin_at
     FROM companions c
     LEFT JOIN (
       ${timestampUnionSql}
     ) t ON t.id = c.checkin_id
     GROUP BY c.name
     ORDER BY c.name`,
    [checkinIds],
  );
  return result.rows.map((r) => ({
    name: r.name as string,
    checkin_count: Number(r.checkin_count ?? 0),
    last_checkin_at: (r.last_checkin_at as string | null) ?? null,
  }));
}

/**
 * Add a standalone companion name (not yet attached to any check-in) to the
 * shared name pool. Rejects names that already exist (case-insensitively).
 * Returns the stored (trimmed) name.
 */
export async function addCompanionName(
  name: string,
  client?: QueryExecutor | null,
): Promise<string> {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) {
    const err = new Error('Companion name is required') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const ex = executor(client);
  const existing = await ex.query(
    'SELECT 1 FROM companions WHERE lower(name) = lower($1) LIMIT 1',
    [clean],
  );
  if ((existing.rowCount ?? existing.rows.length) > 0) {
    const err = new Error(`Companion "${clean}" already exists`) as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  await ex.query('INSERT INTO companions (name) VALUES ($1)', [clean]);
  return clean;
}

/**
 * Rename a companion name across every check-in it appears on (and, if it
 * exists, its standalone row). When the target name already occupies the
 * same check-in, the two rows merge into the existing one. Refuses renames
 * whose target collides with an existing standalone name.
 * Returns the number of rows updated.
 */
export async function renameCompanionName(
  fromName: string,
  toName: string,
  client?: QueryExecutor | null,
): Promise<number> {
  const from = typeof fromName === 'string' ? fromName.trim() : '';
  const to = typeof toName === 'string' ? toName.trim() : '';
  if (!from || !to) {
    const err = new Error('Both the current and the new name are required') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  if (from === to) return 0;
  const ex = executor(client);
  // Standalone rows have NULL keys, which ON CONFLICT cannot dedupe — refuse
  // a rename that would create a second standalone row for the target name.
  const collision = await ex.query(
    `SELECT 1 FROM companions
     WHERE checkin_id IS NULL
       AND lower(name) = lower($1)
       AND lower(name) <> lower($2)
     LIMIT 1`,
    [to, from],
  );
  if ((collision.rowCount ?? collision.rows.length) > 0) {
    const err = new Error(`Companion "${to}" already exists`) as Error & { status?: number };
    err.status = 409;
    throw err;
  }
  const result = await ex.query(
    `WITH affected AS (
       SELECT checkin_type, checkin_id FROM companions WHERE name = $1
     ),
     moved AS (
       INSERT INTO companions (checkin_type, checkin_id, name)
       SELECT checkin_type, checkin_id, $2 FROM affected
       ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING
     )
     DELETE FROM companions WHERE name = $1`,
    [from, to],
  );
  return result.rowCount ?? 0;
}

/**
 * Remove a companion name from every check-in (and its standalone row, if
 * any). Returns the number of rows deleted.
 */
export async function deleteCompanionName(
  name: string,
  client?: QueryExecutor | null,
): Promise<number> {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) {
    const err = new Error('Companion name is required') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const result = await executor(client).query('DELETE FROM companions WHERE name = $1', [clean]);
  return result.rowCount ?? 0;
}

/**
 * Restore companion rows from a backup dump (the v2 bundle's companions.json)
 * inside the given executor. Rows keep their (checkin_type, checkin_id, name)
 * identity; the row id is regenerated. Standalone rows (both keys null) use
 * the partial unique index on lower(name) as the conflict arbiter, since the
 * composite unique constraint cannot dedupe NULL keys. Idempotent — the
 * plugins' payloads may re-restore the same rows. Returns per-row counts.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function restoreCompanionRows(
  rows: unknown[],
  client?: QueryExecutor | null,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const ex = executor(client);
  // The dump is de-duplicated at export, but a hand-edited bundle could
  // carry case-variant duplicates that the indexes would reject — collapse
  // them here (case-insensitive per (check-in, name)).
  const seen = new Set<string>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) { skipped++; continue; }

    const checkinType = typeof row.checkin_type === 'string' && row.checkin_type !== ''
      ? row.checkin_type
      : null;
    const checkinId = typeof row.checkin_id === 'string' && UUID_RE.test(row.checkin_id)
      ? row.checkin_id
      : null;
    // A type without an id (or vice versa) is not a valid companion row.
    if ((checkinType === null) !== (checkinId === null)) { skipped++; continue; }

    const dedupeKey = checkinId === null
      ? `standalone:${name.toLowerCase()}`
      : `${checkinType}|${checkinId}|${name.toLowerCase()}`;
    if (seen.has(dedupeKey)) { skipped++; continue; }
    seen.add(dedupeKey);

    const createdAt = typeof row.created_at === 'string' ? row.created_at : null;
    const sql = checkinId === null
      ? `INSERT INTO companions (name, created_at)
         VALUES ($1, $2)
         ON CONFLICT (lower(name)) WHERE checkin_id IS NULL DO NOTHING`
      : `INSERT INTO companions (checkin_type, checkin_id, name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING`;
    const result = await ex.query(sql, checkinId === null ? [name, createdAt] : [checkinType, checkinId, name, createdAt]);
    if ((result.rowCount ?? 0) > 0) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
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
