/**
 * SCUBA dive check-in type — server half.
 *
 * GENERIC storage: dive check-ins live in the shared `plugin_checkins`
 * table, so the framework provides CRUD (`/api/v1/plugins/scuba/checkins`),
 * the unified timeline branch, backup/restore, start-over, and search
 * automatically. This server half owns:
 *
 *   - `/scuba/stats/*`            — dive stats for the Profile > Dives tab
 *   - `/import/scuba-logbook`     — import from a Diving Log 4.x .sql backup
 *                                  (POST /preview parses without writing;
 *                                  POST / honors per-dive `timezones` overrides)
 *
 * plus the cross-cutting service hooks (timestamps, reflections, earliest
 * date, LLM life summary, reconciliation).
 */

import { Router, Request, Response, NextFunction } from 'express';

import type { CheckinTypeServerPlugin, PluginLlmRow } from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../server/src/db';
import { createGenericCheckin } from '../../server/src/plugins/genericStore';
import { getPlugin } from '../../server/src/plugins/registry';
import { createImportUpload, removeImportFile } from '../../server/src/plugins/uploads';
import { parseDivingLogBackup, localTimeToIso } from './logbook';

import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';

const PLUGIN_ID = 'scuba';

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/scuba (stats)
// ---------------------------------------------------------------------------

const statsRouter = Router();

/**
 * Safe numeric extraction from the JSONB `data` payload: NULL unless the
 * stored JSON string looks like a finite number (JSON null / missing keys /
 * non-numeric values all yield NULL instead of a cast error).
 */
const NUM = (key: string) =>
  `(CASE WHEN (pc.data->>'${key}') ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN (pc.data->>'${key}')::numeric END)`;

/** Local calendar date of checked_in_at in the check-in's timezone. */
const LOCAL_DATE = `(pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))::date`;

function dateRangeWhere(hasRange: boolean): string {
  return hasRange ? `AND ${LOCAL_DATE} BETWEEN $2::date AND $3::date` : '';
}
function dateRangeParams(user_id: string, from: unknown, to: unknown): unknown[] {
  const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
  return hasRange ? [user_id, from, to] : [user_id];
}
function hasDateRange(from: unknown, to: unknown): boolean {
  return typeof from === 'string' && typeof to === 'string' && Boolean(from && to);
}

// GET /stats/summary — headline dive stats for a date range
statsRouter.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const params = dateRangeParams(String(user_id), from, to);
    const result = await query(
      `SELECT
         COUNT(*)::int AS total_dives,
         COALESCE(SUM(${NUM('bottom_time')}), 0) AS total_bottom_time,
         ROUND(AVG(${NUM('bottom_time')}), 1) AS avg_bottom_time,
         MAX(${NUM('depth')}) AS max_depth,
         ROUND(AVG(${NUM('depth')}), 1) AS avg_depth,
         COALESCE(SUM(CASE WHEN ${NUM('start_pressure')} IS NOT NULL AND ${NUM('end_pressure')} IS NOT NULL
                          THEN ${NUM('start_pressure')} - ${NUM('end_pressure')} END), 0) AS air_consumed_bar,
         COUNT(DISTINCT COALESCE(pc.data->>'place', pc.data->>'city'))::int AS unique_sites,
         MIN(pc.checked_in_at) AS first_dive,
         MAX(pc.checked_in_at) AS last_dive
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
         ${dateRangeWhere(hasDateRange(from, to))}`,
      params,
    );

    res.json(result.rows[0] || {
      total_dives: 0,
      total_bottom_time: 0,
      avg_bottom_time: null,
      max_depth: null,
      avg_depth: null,
      air_consumed_bar: 0,
      unique_sites: 0,
      first_dive: null,
      last_dive: null,
    });
  } catch (err) {
    console.error('Error getting scuba summary:', err);
    res.status(500).json({ error: 'Failed to get dive summary' });
  }
});

// GET /stats/by-year — dives / bottom time / max depth per year (all time)
statsRouter.get('/stats/by-year', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT
         EXTRACT(YEAR FROM ${LOCAL_DATE})::int AS year,
         COUNT(*)::int AS dives,
         ROUND(COALESCE(SUM(${NUM('bottom_time')}), 0), 1) AS total_bottom_time,
         MAX(${NUM('depth')}) AS max_depth
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
       GROUP BY EXTRACT(YEAR FROM ${LOCAL_DATE})
       ORDER BY year ASC`,
      [user_id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting scuba by-year:', err);
    res.status(500).json({ error: 'Failed to get dive stats by year' });
  }
});

// GET /stats/by-water — dive counts per water type
statsRouter.get('/stats/by-water', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT pc.data->>'water_type' AS water_type, COUNT(*)::int AS dives
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
         AND pc.data->>'water_type' IS NOT NULL
         ${dateRangeWhere(hasDateRange(from, to))}
       GROUP BY pc.data->>'water_type'
       ORDER BY dives DESC, water_type ASC`,
      dateRangeParams(String(user_id), from, to),
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting scuba by-water:', err);
    res.status(500).json({ error: 'Failed to get dive stats by water' });
  }
});

// GET /stats/by-type — dive counts per dive type (comma-separated field)
statsRouter.get('/stats/by-type', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT TRIM(dive_type) AS dive_type, COUNT(*)::int AS dives
       FROM plugin_checkins pc,
            LATERAL unnest(string_to_array(pc.data->>'divetype', ',')) AS dive_type
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
         AND TRIM(dive_type) <> ''
         ${dateRangeWhere(hasDateRange(from, to))}
       GROUP BY TRIM(dive_type)
       ORDER BY dives DESC, dive_type ASC`,
      dateRangeParams(String(user_id), from, to),
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting scuba by-type:', err);
    res.status(500).json({ error: 'Failed to get dive stats by type' });
  }
});

// GET /stats/top-sites — most-dived sites
statsRouter.get('/stats/top-sites', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT
         pc.data->>'place' AS place,
         pc.data->>'city' AS city,
         pc.data->>'country' AS country,
         COUNT(*)::int AS dives,
         MAX(${NUM('depth')}) AS max_depth
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
         AND (pc.data->>'place' IS NOT NULL OR pc.data->>'city' IS NOT NULL)
         ${dateRangeWhere(hasDateRange(from, to))}
       GROUP BY pc.data->>'place', pc.data->>'city', pc.data->>'country'
       ORDER BY dives DESC, place ASC NULLS LAST
       LIMIT 20`,
      dateRangeParams(String(user_id), from, to),
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting scuba top-sites:', err);
    res.status(500).json({ error: 'Failed to get top dive sites' });
  }
});

// GET /stats/monthly?year= — per-day dive counts for a year (heatmap)
statsRouter.get('/stats/monthly', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;
    if (!user_id || !year) return res.status(400).json({ error: 'user_id and year are required' });

    const yearNum = parseInt(String(year), 10);
    if (!Number.isFinite(yearNum)) return res.status(400).json({ error: 'year must be numeric' });

    const result = await query(
      `SELECT
         TO_CHAR(${LOCAL_DATE}, 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS count,
         ROUND(COALESCE(SUM(${NUM('bottom_time')}), 0), 1) AS total_bottom_time,
         MAX(${NUM('depth')}) AS max_depth
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1
         AND ${LOCAL_DATE} >= $2::date
         AND ${LOCAL_DATE} < ($2::date + INTERVAL '1 year')
       GROUP BY ${LOCAL_DATE}
       ORDER BY date ASC`,
      [user_id, `${yearNum}-01-01`],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting scuba monthly:', err);
    res.status(500).json({ error: 'Failed to get monthly dive stats' });
  }
});

// GET /stats/earliest — earliest dive date (profile period selector)
statsRouter.get('/stats/earliest', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT MIN(${LOCAL_DATE})::text AS date
       FROM plugin_checkins pc
       WHERE pc.plugin_id = '${PLUGIN_ID}' AND pc.user_id = $1`,
      [user_id],
    );
    res.json({ date: result.rows[0]?.date ?? null });
  } catch (err) {
    console.error('Error getting scuba earliest:', err);
    res.status(500).json({ error: 'Failed to get earliest dive date' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/import/scuba-logbook
// ---------------------------------------------------------------------------

const importRouter = Router();

const logbookUpload = createImportUpload({
  fileFilter: (file) => {
    const name = file.originalname.toLowerCase();
    return name.endsWith('.sql') || name.endsWith('.sqlite') || name.endsWith('.db')
      ? null
      : 'Only Diving Log .sql backup files are allowed';
  },
});

// ---------------------------------------------------------------------------
// Shared parse + import logic (also used by the /preview endpoint)
// ---------------------------------------------------------------------------

type ScubaLogbookRow = ReturnType<typeof parseDivingLogBackup>['rows'][number];

/**
 * Parse a Diving Log .sql backup, applying the caller's per-dive timezone
 * overrides (keyed by the row's `source_uuid`). Overridden rows get their
 * timestamp re-anchored to the new zone while keeping the logged wall-clock
 * date + entry time. The fallback zone only affects dives whose stored
 * UtcOffset is missing and whose site has no coordinates.
 */
export async function parseLogbookForImport(
  filePath: string,
  fallbackTimezone: string,
  timezoneOverrides: Record<string, string> | undefined,
): Promise<{ rows: ScubaLogbookRow[]; errors: string[] }> {
  const fallback = isValidTimeZone(fallbackTimezone) ? fallbackTimezone : 'UTC';
  const parsed = parseDivingLogBackup(filePath, fallback);

  const rows: ScubaLogbookRow[] = [];
  for (const row of parsed.rows) {
    const uuid = typeof row.data.source_uuid === 'string' ? row.data.source_uuid : '';
    const override = uuid ? timezoneOverrides?.[uuid]?.trim() : undefined;
    if (override && override !== row.checkin_timezone && isValidTimeZone(override)) {
      const entryTime = typeof row.data.entry_time === 'string' ? row.data.entry_time : '';
      const checkedInAt = localTimeToIso(row.local_date, entryTime, override);
      if (!checkedInAt) {
        const label = `Dive ${row.data.source_number ?? row.data.source_id ?? '?'}`;
        parsed.errors.push(`${label}: could not build a timestamp for ${row.local_date} ${entryTime} in ${override}`);
        continue;
      }
      rows.push({ ...row, checkin_timezone: override, checked_in_at: checkedInAt });
    } else {
      rows.push(row);
    }
  }
  return { rows, errors: parsed.errors };
}

/**
 * Execute an import: skips dives whose `source_uuid` already exists
 * (idempotent re-imports) and creates the rest as generic check-ins.
 * Returns the stored check-in id for imported rows.
 */
export async function executeScubaLogbookImport(rows: ScubaLogbookRow[]): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  imported_ids: (string | null)[];
}> {
  const plugin = getPlugin(PLUGIN_ID);
  if (!plugin) {
    throw new Error('scuba plugin is not registered');
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const importedIds: (string | null)[] = [];

  for (const row of rows) {
    const sourceUuid = row.data.source_uuid;

    // Idempotent re-import: skip dives already imported from this backup.
    if (typeof sourceUuid === 'string' && sourceUuid) {
      const existing = await query(
        `SELECT id FROM plugin_checkins
         WHERE plugin_id = $1 AND user_id = $2 AND data->>'source_uuid' = $3`,
        [PLUGIN_ID, USER_ID, sourceUuid],
      );
      if (existing.rows.length > 0) {
        skipped++;
        importedIds.push(null);
        continue;
      }
    }

    try {
      const created = await createGenericCheckin(USER_ID, plugin, {
        checked_in_at: row.checked_in_at,
        checkin_timezone: row.checkin_timezone || null,
        data: row.data,
      });
      imported++;
      importedIds.push(created.id);
    } catch (rowErr) {
      errors.push(`Dive ${row.data.source_number ?? row.data.source_id ?? '?'}: ${(rowErr as Error).message}`);
      skipped++;
      importedIds.push(null);
    }
  }

  return { imported, skipped, errors, imported_ids: importedIds };
}

// POST /preview — parse the backup without writing anything; returns one
// preview row per dive (site, date, resolved timezone + how it was derived).
importRouter.post('/preview', logbookUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No logbook file provided' });
  }

  try {
    let result;
    try {
      result = await parseLogbookForImport(file.path, String(req.body?.fallback_timezone || ''), undefined);
    } catch (err) {
      return res.status(400).json({
        error: `Could not read the logbook file: ${(err as Error).message || err}`,
      });
    }

    res.json({
      total: result.rows.length,
      rows: result.rows.map((row) => ({
        source_uuid: typeof row.data.source_uuid === 'string' ? row.data.source_uuid : null,
        source_number: typeof row.data.source_number === 'number' ? row.data.source_number : null,
        place: typeof row.data.place === 'string' ? row.data.place : null,
        city: typeof row.data.city === 'string' ? row.data.city : null,
        local_date: row.local_date,
        entry_time: typeof row.data.entry_time === 'string' ? row.data.entry_time : null,
        depth: typeof row.data.depth === 'number' ? row.data.depth : null,
        bottom_time: typeof row.data.bottom_time === 'number' ? row.data.bottom_time : null,
        checkin_timezone: row.checkin_timezone,
        timezone_source: row.timezone_source,
        checked_in_at: row.checked_in_at,
      })),
      errors: result.errors,
    });
  } catch (err) {
    console.error('SCUBA logbook preview error:', err);
    res.status(500).json({ error: 'Preview failed', details: (err as Error).message || String(err) });
  } finally {
    removeImportFile(file.path);
  }
});

// POST / — import a Diving Log .sql backup. Optional `timezones` body maps
// `source_uuid` → IANA zone for dives the user re-zoned in the preview.
importRouter.post('/', logbookUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No logbook file provided' });
  }

  try {
    const timezones =
      req.body?.timezones && typeof req.body.timezones === 'object' && !Array.isArray(req.body.timezones)
        ? (req.body.timezones as Record<string, string>)
        : undefined;

    let result;
    try {
      result = await parseLogbookForImport(file.path, String(req.body?.fallback_timezone || ''), timezones);
    } catch (err) {
      return res.status(400).json({
        error: `Could not read the logbook file: ${(err as Error).message || err}`,
      });
    }

    const outcome = await executeScubaLogbookImport(result.rows);
    const errors = [...result.errors, ...outcome.errors];

    res.json({
      imported: outcome.imported,
      skipped: outcome.skipped,
      imported_ids: outcome.imported_ids,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err) {
    console.error('SCUBA logbook import error:', err);
    res.status(500).json({ error: 'Import failed', details: (err as Error).message || String(err) });
  } finally {
    removeImportFile(file.path);
  }
});

// Surface multer/file-filter rejections (e.g. a non-.sql upload) as 400s.
importRouter.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.status && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});

// ---------------------------------------------------------------------------
// Plugin server half
// ---------------------------------------------------------------------------

export const server: CheckinTypeServerPlugin = {
  // Generic storage: CRUD, timeline, backup/restore, and start-over are all
  // framework-provided for plugin_checkins rows.
  storage: 'generic',

  api: [
    { mount: '/scuba', router: statsRouter },
    { mount: '/import/scuba-logbook', router: importRouter },
  ],

  // No plugin settings keys for now (the import form collects its options
  // per request).

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and Maloja enrichment.
  resolveTimestamps: () => ({
    sql: `SELECT id, checked_in_at FROM plugin_checkins
          WHERE plugin_id = '${PLUGIN_ID}' AND id = ANY($1::uuid[])`,
  }),

  // "This day in previous years" reflection branch.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'scuba' AS type,
        pc.id,
        pc.checked_in_at,
        pc.data->>'comments' AS note,
        NULL::uuid AS venue_id,
        COALESCE(pc.data->>'place', pc.data->>'city') AS venue_name,
        pc.data->>'city' AS city,
        pc.data->>'country' AS country,
        (CASE WHEN (pc.data->>'latitude') ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN (pc.data->>'latitude')::double precision END) AS latitude,
        (CASE WHEN (pc.data->>'longitude') ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN (pc.data->>'longitude')::double precision END) AS longitude,
        NULL::text AS venue_category,
        pc.checkin_timezone AS venue_timezone,
        EXTRACT(YEAR FROM pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))::int
        )::int AS years_ago,
        pc.data AS data
      FROM plugin_checkins pc
      WHERE pc.plugin_id = '${PLUGIN_ID}'
        AND pc.user_id = $1
        AND TO_CHAR(pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector.
  earliestDate: () => ({
    sql: `SELECT MIN((checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')))::text AS date
          FROM plugin_checkins
          WHERE plugin_id = '${PLUGIN_ID}' AND user_id = $1`,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'scuba dives',
    gather: async (user_id, from, to): Promise<PluginLlmRow[]> => {
      const result = await query(
        `SELECT pc.checked_in_at, pc.checkin_timezone AS timezone, pc.data
         FROM plugin_checkins pc
         WHERE pc.plugin_id = $3
           AND pc.user_id = $1
           AND (pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))::date >= $2::date
           AND (pc.checked_in_at AT TIME ZONE COALESCE(pc.checkin_timezone, 'UTC'))::date <= $4::date
         ORDER BY pc.checked_in_at ASC`,
        [user_id, from, PLUGIN_ID, to],
      );
      return result.rows;
    },
    toLines: (row) => {
      const d = (row.data ?? {}) as Record<string, unknown>;
      const place = [d.place, d.city].filter(Boolean).join(', ');
      const depth = typeof d.depth === 'number' ? `to ${d.depth} m` : null;
      const time = typeof d.bottom_time === 'number' ? `${d.bottom_time} min` : null;
      const bits = [place, depth, time].filter(Boolean).join(' ');
      const comment = d.comments ? ` — "${d.comments}"` : '';
      return [`- dive${bits ? ` ${bits}` : ''}${comment}`];
    },
  },

  // Timestamp reconciliation participation (label-only corrections).
  reconcile: {
    anchorLabel: 'dive',
    scanAll: false,
    detailPath: (id) => `/checkins/${PLUGIN_ID}/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id, checked_in_at, checkin_timezone AS original_timezone,
                (CASE WHEN (data->>'latitude') ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN (data->>'latitude')::double precision END) AS latitude,
                (CASE WHEN (data->>'longitude') ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN (data->>'longitude')::double precision END) AS longitude
         FROM plugin_checkins
         WHERE plugin_id = $1 AND user_id = $2
         ORDER BY checked_in_at ASC`,
        [PLUGIN_ID, user_id],
      );
      return result.rows;
    },
    apply: async (id, suggested_timezone) => {
      const result = await query(
        `UPDATE plugin_checkins
         SET checkin_timezone = $2, updated_at = NOW()
         WHERE id = $1 AND plugin_id = $3
         RETURNING id`,
        [id, suggested_timezone, PLUGIN_ID],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },
};
