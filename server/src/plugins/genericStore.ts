/**
 * Generic storage for plugin check-in types.
 *
 * Plugins using the default ('generic') storage keep all per-check-in data in
 * the shared `plugin_checkins` table: a first-class timestamp/timezone plus a
 * JSONB `data` object validated against the plugin's field schema. Backup,
 * restore, and start-over are driven by the same helpers below.
 */

import type { CheckinTypeServer, PluginTimelineContext } from 'wwp-shared';
import { validatePluginData } from 'wwp-shared';
import { query, pool } from '../db';

export interface GenericCheckinRow {
  id: string;
  plugin_id: string;
  user_id: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Validate a payload `data` object against the plugin's field schema,
 * applying field defaults for missing optional values.
 * Returns `{ data, errors }`; `data` is the normalized object to store.
 */
export function normalizePluginData(
  plugin: CheckinTypeServer,
  data: Record<string, unknown> | undefined | null,
): { data: Record<string, unknown>; errors: string[] } {
  const input = data && typeof data === 'object' ? { ...data } : {};

  for (const field of plugin.fields) {
    if (input[field.name] === undefined && field.default !== undefined) {
      input[field.name] = field.default;
    }
  }

  const errors = validatePluginData(plugin.fields, input);
  return { data: input, errors };
}

/**
 * Build the timeline WHERE clause for generic storage, combining the shared
 * user/date/search conditions with (optionally) plugin filter params.
 * Placeholders are positional starting at $1.
 */
export function genericTimelineWhere(
  plugin: CheckinTypeServer,
  ctx: PluginTimelineContext,
): { sql: string | null; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const push = (cond: string, value: unknown) => {
    values.push(value);
    conditions.push(cond.replace('?', `$${values.length}`));
  };

  if (ctx.user_id) {
    push('user_id = ?', ctx.user_id);
  }
  if (ctx.from) {
    push(`(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date >= ?::date`, ctx.from);
  }
  if (ctx.to) {
    push(`(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date <= ?::date`, ctx.to);
  }
  if (ctx.q) {
    // Search free text across the whole JSONB data payload.
    push(`(data::text ILIKE ?)`, `%${ctx.q}%`);
  }

  // Plugin-specific filters for generic storage: equality on data keys.
  // The convention is `data.<field> = value` for string values; numeric
  // fields compare numerically when the stored value is a number.
  for (const [name, value] of Object.entries(ctx.filterParams)) {
    if (value === undefined || value === '') continue;
    const field = plugin.fields.find((f) => f.name === name);
    if (!field) continue;
    if (field.kind === 'number' || field.kind === 'integer' || field.kind === 'rating') {
      push(`(data->>'${field.name}')::numeric = ?::numeric`, value);
    } else {
      push(`data->>'${field.name}' = ?`, value);
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : null,
    values,
  };
}

/** Timeline SELECT branch for generic storage. */
export function genericTimelineSelect(pluginId: string): string {
  return `
    SELECT '${pluginId}' AS type,
           pc.id,
           pc.user_id,
           NULL AS notes,
           pc.checked_in_at,
           pc.created_at,
           pc.checkin_timezone AS timezone,
           pc.data
    FROM plugin_checkins pc
  `;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createGenericCheckin(
  user_id: string,
  plugin: CheckinTypeServer,
  input: {
    checked_in_at?: string | null;
    checkin_timezone?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<GenericCheckinRow> {
  const { data, errors } = normalizePluginData(plugin, input.data);
  if (errors.length > 0) {
    const err = new Error(`Invalid check-in data: ${errors.join('; ')}`) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const result = await query(
    `INSERT INTO plugin_checkins (plugin_id, user_id, checked_in_at, checkin_timezone, data)
     VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5::jsonb)
     RETURNING *`,
    [plugin.id, user_id, input.checked_in_at || null, input.checkin_timezone || null, JSON.stringify(data)],
  );
  return result.rows[0];
}

export async function getGenericCheckin(
  id: string,
  pluginId: string,
): Promise<GenericCheckinRow | null> {
  const result = await query(
    `SELECT * FROM plugin_checkins WHERE id = $1 AND plugin_id = $2`,
    [id, pluginId],
  );
  return result.rows[0] ?? null;
}

export async function updateGenericCheckin(
  id: string,
  plugin: CheckinTypeServer,
  input: {
    checked_in_at?: string | null;
    checkin_timezone?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<GenericCheckinRow | null> {
  if (input.data !== undefined) {
    const { data, errors } = normalizePluginData(plugin, input.data);
    if (errors.length > 0) {
      const err = new Error(`Invalid check-in data: ${errors.join('; ')}`) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    const result = await pool.query(
      `UPDATE plugin_checkins
       SET data = $3::jsonb,
           checked_in_at = COALESCE($4::timestamptz, checked_in_at),
           checkin_timezone = COALESCE($5, checkin_timezone)
       WHERE id = $1 AND plugin_id = $2
       RETURNING *`,
      [id, plugin.id, JSON.stringify(data), input.checked_in_at || null, input.checkin_timezone || null],
    );
    return result.rows[0] ?? null;
  }
  const result = await pool.query(
    `UPDATE plugin_checkins
     SET checked_in_at = COALESCE($3::timestamptz, checked_in_at),
         checkin_timezone = COALESCE($4, checkin_timezone)
     WHERE id = $1 AND plugin_id = $2
     RETURNING *`,
    [id, plugin.id, input.checked_in_at || null, input.checkin_timezone || null],
  );
  return result.rows[0] ?? null;
}

export async function deleteGenericCheckin(id: string, pluginId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM plugin_checkins WHERE id = $1 AND plugin_id = $2 RETURNING id`,
    [id, pluginId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGenericCheckins(
  pluginId: string,
  user_id: string,
  opts: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<GenericCheckinRow[]> {
  const result = await query(
    `SELECT * FROM plugin_checkins
     WHERE plugin_id = $1 AND user_id = $2
     ORDER BY checked_in_at DESC
     LIMIT $3 OFFSET $4`,
    [pluginId, user_id, opts.limit, opts.offset],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Backup / restore / start-over
// ---------------------------------------------------------------------------

export interface PluginCheckinBackupRow {
  id: string;
  plugin_id: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function exportGenericCheckins(user_id: string): Promise<PluginCheckinBackupRow[]> {
  const result = await query(
    `SELECT id, plugin_id, checked_in_at, checkin_timezone, data, created_at, updated_at
     FROM plugin_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
    [user_id],
  );
  return result.rows;
}

export async function importGenericCheckins(
  user_id: string,
  rows: PluginCheckinBackupRow[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || typeof row.plugin_id !== 'string') {
        skipped++;
        continue;
      }
      const result = await client.query(
        `INSERT INTO plugin_checkins (id, plugin_id, user_id, checked_in_at, checkin_timezone, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.plugin_id,
          user_id,
          row.checked_in_at,
          row.checkin_timezone ?? null,
          JSON.stringify(row.data ?? {}),
          row.created_at ?? null,
          row.updated_at ?? null,
        ],
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
      else skipped++;
    }
  } finally {
    client.release();
  }
  return { inserted, skipped };
}

export async function deleteAllGenericCheckins(user_id: string): Promise<number> {
  const result = await query(
    `DELETE FROM plugin_checkins WHERE user_id = $1 RETURNING id`,
    [user_id],
  );
  return result.rowCount ?? 0;
}

export async function deletePluginCheckins(user_id: string, pluginId: string): Promise<number> {
  const result = await query(
    `DELETE FROM plugin_checkins WHERE user_id = $1 AND plugin_id = $2 RETURNING id`,
    [user_id, pluginId],
  );
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Plugin settings (generic key/value per user per plugin)
// ---------------------------------------------------------------------------

/**
 * Return the effective settings object for a plugin: declared keys with
 * defaults, overlaid with stored values.
 */
export async function getPluginSettings(
  user_id: string,
  plugin: CheckinTypeServer,
): Promise<Record<string, unknown>> {
  const keys = plugin.server.settingsKeys ?? [];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key.name] = key.default ?? null;
  }
  if (keys.length > 0) {
    const names = keys.map((k) => k.name);
    const result = await query(
      `SELECT key, value FROM plugin_settings
       WHERE user_id = $1 AND plugin_id = $2 AND key = ANY($3::text[])`,
      [user_id, plugin.id, names],
    );
    for (const row of result.rows) {
      out[row.key] = row.value;
    }
  }
  return out;
}

/**
 * Upsert a subset of a plugin's declared settings keys. Unknown keys are
 * rejected (400).
 */
export async function setPluginSettings(
  user_id: string,
  plugin: CheckinTypeServer,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const declared = new Map((plugin.server.settingsKeys ?? []).map((k) => [k.name, k]));
  for (const key of Object.keys(updates)) {
    if (!declared.has(key)) {
      const err = new Error(`Unknown setting: ${key}`) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
  }
  const entries = Object.entries(updates);
  const client = await pool.connect();
  try {
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [user_id, plugin.id, key, JSON.stringify(value)],
      );
    }
  } finally {
    client.release();
  }
  return getPluginSettings(user_id, plugin);
}
