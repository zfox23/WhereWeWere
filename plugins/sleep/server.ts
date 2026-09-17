/**
 * Sleep check-in type — server half.
 *
 * CUSTOM storage: Sleep keeps its pre-existing `sleep_entries` and
 * `sleep_webhook_events` tables so the Sleep as Android webhook, CSV import,
 * and timestamp reconciliation keep working untouched. The framework uses
 * this half for the unified timeline, backups, start-over, and mounts the
 * plugin-owned API routers.
 *
 * This plugin owns ALL sleep-specific API surface (entry CRUD + stats, the
 * Sleep as Android webhook, and the CSV import) — no sleep-specific routes
 * live in the core platform.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type {
  CheckinTypeServerPlugin,
  PluginTimelineContext,
} from 'wwp-shared';
import { query, pool } from '../../server/src/db';

const USER_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/sleep-entries
// (moved from server/src/routes/sleep-entries.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const sleepEntriesRouter = Router();

function sanitizeTimezone(value: unknown): string {
  const tz = String(value || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function normalizeRating(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

function normalizeComment(value: unknown): string | null {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

// GET / - list sleep entries
sleepEntriesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      from,
      to,
      limit = '50',
      offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`se.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`(se.started_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date >= $${paramIndex}::date`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`(se.started_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date <= $${paramIndex}::date`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const result = await query(
      `SELECT se.id, se.user_id, se.sleep_as_android_id, se.sleep_timezone,
              se.started_at, se.ended_at, se.rating, se.comment,
              se.created_at, se.updated_at
       FROM sleep_entries se
       ${whereClause}
       ORDER BY se.started_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing sleep entries:', err);
    res.status(500).json({ error: 'Failed to list sleep entries' });
  }
});

// GET /:id - get single sleep entry
sleepEntriesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT se.id, se.user_id, se.sleep_as_android_id, se.sleep_timezone,
              se.started_at, se.ended_at, se.rating, se.comment,
              se.created_at, se.updated_at
       FROM sleep_entries se
       WHERE se.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting sleep entry:', err);
    res.status(500).json({ error: 'Failed to get sleep entry' });
  }
});

// POST / - create sleep entry
sleepEntriesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      sleep_as_android_id,
      sleep_timezone,
      started_at,
      ended_at,
      rating,
      comment,
    } = req.body;

    if (!started_at || !ended_at) {
      return res.status(400).json({ error: 'started_at and ended_at are required' });
    }

    const result = await query(
      `INSERT INTO sleep_entries (
         user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, rating, comment
       )
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
       RETURNING *`,
      [
        USER_ID,
        Number.isFinite(Number(sleep_as_android_id)) ? Number(sleep_as_android_id) : Date.now(),
        sanitizeTimezone(sleep_timezone),
        started_at,
        ended_at,
        normalizeRating(rating),
        normalizeComment(comment),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Duplicate sleep_as_android_id for this user' });
    }
    console.error('Error creating sleep entry:', err);
    res.status(500).json({ error: 'Failed to create sleep entry' });
  }
});

// PUT /:id - update sleep entry
sleepEntriesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      sleep_timezone,
      started_at,
      ended_at,
      rating,
      comment,
    } = req.body;

    const result = await query(
      `UPDATE sleep_entries
       SET sleep_timezone = COALESCE($2, sleep_timezone),
           started_at = COALESCE($3::timestamptz, started_at),
           ended_at = COALESCE($4::timestamptz, ended_at),
           rating = COALESCE($5, rating),
           comment = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        sleep_timezone != null ? sanitizeTimezone(sleep_timezone) : null,
        started_at || null,
        ended_at || null,
        rating != null ? normalizeRating(rating) : null,
        normalizeComment(comment),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating sleep entry:', err);
    res.status(500).json({ error: 'Failed to update sleep entry' });
  }
});

// DELETE /:id - delete sleep entry
sleepEntriesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM sleep_entries WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json({ message: 'Sleep entry deleted', id });
  } catch (err) {
    console.error('Error deleting sleep entry:', err);
    res.status(500).json({ error: 'Failed to delete sleep entry' });
  }
});

// ---------------------------------------------------------------------------
// Sleep stats
// (moved from the sleep-* endpoints in server/src/routes/stats.ts;
// behavior unchanged)
// ---------------------------------------------------------------------------

const SLEEP_DATE_RANGE_WHERE = (hasRange: boolean) =>
  hasRange
    ? "AND (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date BETWEEN $2::date AND $3::date"
    : '';
const SLEEP_DATE_RANGE_PARAMS = (user_id: unknown, from: unknown, to: unknown) =>
  typeof from === 'string' && typeof to === 'string' && from && to
    ? [user_id, from, to]
    : [user_id];

// GET /stats/summary - aggregate sleep stats for a date range
sleepEntriesRouter.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT
         COUNT(*)::int AS total_sleeps,
         ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::numeric, 1)::float AS avg_duration_minutes,
         ROUND(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::numeric, 1)::float AS total_sleep_minutes,
         ROUND(AVG(NULLIF(rating, 0))::numeric, 2)::float AS avg_rating,
         COUNT(*) FILTER (WHERE rating > 0)::int AS rated_count
       FROM sleep_entries
       WHERE user_id = $1
         ${SLEEP_DATE_RANGE_WHERE(hasRange)}`,
      SLEEP_DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows[0] || {
      total_sleeps: 0,
      avg_duration_minutes: 0,
      total_sleep_minutes: 0,
      avg_rating: null,
      rated_count: 0,
    });
  } catch (err) {
    console.error('Error getting sleep-summary:', err);
    res.status(500).json({ error: 'Failed to get sleep summary' });
  }
});

// GET /stats/daily - nightly sleep duration and rating per day
sleepEntriesRouter.get('/stats/daily', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT
         TO_CHAR((ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date, 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS count,
         ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::numeric, 1)::float AS avg_duration_minutes,
         ROUND(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::numeric, 1)::float AS total_sleep_minutes,
         ROUND(AVG(NULLIF(rating, 0))::numeric, 2)::float AS avg_rating
       FROM sleep_entries
       WHERE user_id = $1
         ${SLEEP_DATE_RANGE_WHERE(hasRange)}
       GROUP BY (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date
       ORDER BY date ASC`,
      SLEEP_DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting sleep-daily:', err);
    res.status(500).json({ error: 'Failed to get sleep daily stats' });
  }
});

// GET /stats/rating-distribution - rounded-star distribution + unrated
sleepEntriesRouter.get('/stats/rating-distribution', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT
         CASE WHEN rating = 0 THEN 0 ELSE GREATEST(1, LEAST(5, ROUND(rating)::int)) END AS stars,
         COUNT(*)::int AS count
       FROM sleep_entries
       WHERE user_id = $1
         ${SLEEP_DATE_RANGE_WHERE(hasRange)}
       GROUP BY stars
       ORDER BY stars ASC`,
      SLEEP_DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting sleep-rating-distribution:', err);
    res.status(500).json({ error: 'Failed to get sleep rating distribution' });
  }
});

// GET /stats/earliest - earliest sleep entry date (profile period selector)
sleepEntriesRouter.get('/stats/earliest', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const result = await query(
      `SELECT MIN(DATE(started_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC')))::text AS date
       FROM sleep_entries WHERE user_id = $1`,
      [user_id]
    );

    res.json({ date: result.rows[0]?.date ?? null });
  } catch (err) {
    console.error('Error getting sleep earliest date:', err);
    res.status(500).json({ error: 'Failed to get sleep earliest date' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/webhook/sleep-as-android
// (moved from server/src/routes/webhook-sleep-as-android.ts; behavior
// unchanged — the webhook URL is user-configured in the Sleep as Android
// app and must stay stable)
// ---------------------------------------------------------------------------

const webhookRouter = Router();

/**
 * Parse a Sleep as Android timestamp value.
 * The app sends UNIX timestamps – sometimes in milliseconds (13-digit),
 * sometimes in seconds (10-digit). We detect which by magnitude.
 */
function parseWebhookTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const date = num > 1e10 ? new Date(num) : new Date(num * 1000);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Infer the user's local timezone at the given reference time by examining:
 *   1. The most recent check-in timezone at or before the reference time.
 *   2. The most recent completed (non-pending) sleep entry timezone (non-UTC).
 *   3. 'UTC' as a last resort.
 */
async function inferSleepTimezone(referenceTime: Date): Promise<string> {
  const checkinResult = await query(
    `SELECT checkin_timezone
     FROM checkins
     WHERE user_id = $1
       AND checkin_timezone IS NOT NULL
       AND checked_in_at <= $2
     ORDER BY checked_in_at DESC
     LIMIT 1`,
    [USER_ID, referenceTime.toISOString()]
  );
  if (checkinResult.rows[0]?.checkin_timezone) {
    return checkinResult.rows[0].checkin_timezone as string;
  }

  const sleepResult = await query(
    `SELECT sleep_timezone
     FROM sleep_entries
     WHERE user_id = $1
       AND is_pending = FALSE
       AND sleep_timezone IS NOT NULL
       AND sleep_timezone != 'UTC'
     ORDER BY ended_at DESC
     LIMIT 1`,
    [USER_ID]
  );
  if (sleepResult.rows[0]?.sleep_timezone) {
    return sleepResult.rows[0].sleep_timezone as string;
  }

  return 'UTC';
}

// POST / - receive a Sleep as Android webhook event
webhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { event, value1, value2, value3 } = body;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid event field' });
    }

    // Log every event so the UI can display a received count.
    await query(
      `INSERT INTO sleep_webhook_events (user_id, event, value1, value2, value3, raw_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [USER_ID, event, value1 ?? null, value2 ?? null, value3 ?? null, body]
    );

    if (event === 'sleep_tracking_started') {
      const startTime = parseWebhookTimestamp(value1) ?? new Date();
      // Use start-time-in-ms as a synthetic sleep_as_android_id.
      // Real CSV-exported IDs are tiny sequential integers; ms timestamps
      // are in the 10^12 range so there is no overlap.
      const androidId = startTime.getTime();

      // Reconciliation: Sleep as Android can re-send sleep_tracking_started
      // mid-session (watch reconnect, app restart, phone unlock). Each start
      // is keyed by its own start-time, so the app's single final
      // sleep_tracking_stopped will only reference the LAST start — abandoning
      // any earlier pending sessions, which would otherwise stay open forever
      // and render as "Slept for 0m" in the timeline. A new start supersedes
      // any still-pending session, so delete the abandoned ones.
      const abandoned = await query(
        `DELETE FROM sleep_entries
         WHERE user_id = $1 AND is_pending = TRUE`,
        [USER_ID]
      );
      if (abandoned.rowCount) {
        console.warn(
          `Sleep webhook: new tracking start at ${startTime.toISOString()} ` +
          `abandoned ${abandoned.rowCount} still-pending session(s); ` +
          `deleting them as superseded.`
        );
      }

      const timezone = await inferSleepTimezone(startTime);

      await query(
        `INSERT INTO sleep_entries
           (user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, is_pending)
         VALUES ($1, $2, $3, $4, $4, TRUE)
         ON CONFLICT (user_id, sleep_as_android_id) DO UPDATE
           SET started_at  = EXCLUDED.started_at,
               ended_at    = EXCLUDED.ended_at,
               sleep_timezone = EXCLUDED.sleep_timezone,
               is_pending  = TRUE,
               updated_at  = NOW()`,
        [USER_ID, androidId, timezone, startTime.toISOString()]
      );
    } else if (event === 'sleep_tracking_stopped') {
      const startTime = parseWebhookTimestamp(value1);
      const endTime = parseWebhookTimestamp(value2) ?? new Date();

      const targeted = startTime
        ? await query(
            `UPDATE sleep_entries
             SET ended_at   = $2,
                 is_pending = FALSE,
                 updated_at = NOW()
             WHERE user_id = $1
               AND sleep_as_android_id = $3
               AND is_pending = TRUE`,
            [USER_ID, endTime.toISOString(), startTime.getTime()]
          )
        : { rowCount: 0 };

      if (targeted.rowCount) {
        // Closed the specific pending session opened by this start time.
      } else {
        // The stop's start-time didn't match any pending session (either the
        // app re-sent starts and abandoned this one, or the start event never
        // arrived). Never let a stop be silently dropped: fall back to
        // closing the most recent open session.
        console.warn(
          `Sleep webhook: stop with start=${startTime ? startTime.toISOString() : 'none'} ` +
          `matched no pending session; falling back to the most recent pending one.`
        );
        const fallback = await query(
          `UPDATE sleep_entries
           SET ended_at   = $2,
               is_pending = FALSE,
               updated_at = NOW()
           WHERE id = (
             SELECT id FROM sleep_entries
             WHERE user_id = $1 AND is_pending = TRUE
             ORDER BY started_at DESC
             LIMIT 1
           )`,
          [USER_ID, endTime.toISOString()]
        );
        if (!fallback.rowCount) {
          console.warn('Sleep webhook: no pending session existed to close at all.');
        }
      }
    }
    // All other events are logged but require no sleep_entry mutation.

    res.json({ ok: true });
  } catch (err) {
    console.error('Sleep as Android webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /stats - count of events received for this user
webhookRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM sleep_webhook_events WHERE user_id = $1',
      [USER_ID]
    );
    res.json({ count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('Sleep webhook stats error:', err);
    res.status(500).json({ error: 'Failed to get webhook stats' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/import/sleep-as-android
// (moved from server/src/routes/import-sleep-as-android.ts; behavior
// unchanged)
// ---------------------------------------------------------------------------

const importRouter = Router();

const csvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-import');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const csvUpload = multer({
  storage: csvStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseOffsetMinutes(offsetToken: string): number {
  if (offsetToken === 'GMT' || offsetToken === 'UTC') return 0;
  const match = offsetToken.match(/^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return sign * (hours * 60 + minutes);
}

function getOffsetMinutesForTimezone(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value || 'UTC';
  return parseOffsetMinutes(tzName);
}

function sleepLocalDateTimeToIso(value: string, timeZone: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMs = baseUtc;

  // Iterate to account for DST transitions around the local wall-clock time.
  for (let i = 0; i < 3; i++) {
    const offsetMinutes = getOffsetMinutesForTimezone(utcMs, timeZone);
    const nextUtc = baseUtc - (offsetMinutes * 60 * 1000);
    if (Math.abs(nextUtc - utcMs) < 1000) {
      utcMs = nextUtc;
      break;
    }
    utcMs = nextUtc;
  }

  return new Date(utcMs).toISOString();
}

function normalizeImportRating(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

// POST / - import Sleep as Android CSV
importRouter.post('/', csvUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No CSV file provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    const lines = content.split('\n');

    let currentHeaders: string[] = [];
    const records: Record<string, string>[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: string[][];
      try {
        parsed = parse(trimmed, { relax_column_count: true, trim: true });
      } catch {
        continue;
      }

      if (!parsed.length || !parsed[0].length) continue;
      const row = parsed[0];

      if (row[0] === 'Id') {
        currentHeaders = row;
        continue;
      }

      // Sleep as Android includes non-record rows that start with an empty Id column.
      if (!currentHeaders.length || !row[0] || !/^\d+$/.test(row[0])) {
        continue;
      }

      const record: Record<string, string> = {};
      for (let i = 0; i < currentHeaders.length && i < row.length; i++) {
        record[currentHeaders[i]] = row[i];
      }
      records.push(record);
    }

    for (const row of records) {
      const sleepAsAndroidId = Number(row['Id']);
      const requestedTimezone = String(row['Tz'] || '').trim();
      const timezone = isValidTimeZone(requestedTimezone) ? requestedTimezone : 'UTC';
      const fromIso = sleepLocalDateTimeToIso(String(row['From'] || ''), timezone);
      const toIso = sleepLocalDateTimeToIso(String(row['To'] || ''), timezone);
      const rating = normalizeImportRating(String(row['Rating'] || '0'));
      const comment = String(row['Comment'] || '').trim() || null;

      if (!Number.isFinite(sleepAsAndroidId) || !fromIso || !toIso) {
        skipped++;
        continue;
      }

      try {
        const insertResult = await query(
          `INSERT INTO sleep_entries (
             user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, rating, comment
           )
           VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
           ON CONFLICT (user_id, sleep_as_android_id) DO NOTHING
           RETURNING id`,
          [USER_ID, sleepAsAndroidId, timezone, fromIso, toIso, rating, comment]
        );

        if (insertResult.rows.length === 0) {
          skipped++;
        } else {
          imported++;
        }
      } catch (rowErr: any) {
        errors.push(`Row error (Id=${row['Id']}): ${rowErr.message || rowErr}`);
        skipped++;
      }
    }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Sleep as Android import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  } finally {
    try {
      fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup failures
    }
  }
});

// ---------------------------------------------------------------------------
// Plugin server half
// ---------------------------------------------------------------------------

function formatSleepDuration(startedAt: string, endedAt: string): string {
  const mins = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/sleep-entries', router: sleepEntriesRouter },
    { mount: '/webhook/sleep-as-android', router: webhookRouter },
    { mount: '/import/sleep-as-android', router: importRouter },
  ],

  // Timeline branch for the unified timeline. Emits the shared legacy
  // column envelope (the same shape the built-in branches and the mood
  // plugin emit) so all UNION branches line up; sleep-specific values are
  // carried in the sleep_* columns AND mirrored into the `data` payload
  // that the plugin's timeline card reads.
  //
  // checked_in_at is the wake-up moment (ended_at), falling back to
  // started_at for pending (webhook-started, not yet ended) sessions. This
  // keeps the timeline day-grouping of overnight sleeps on the day the
  // user woke up, matching the pre-plugin client behavior.
  buildTimelineSelect: () => ({
    sql: `
      SELECT 'sleep' AS type, se.id, se.user_id, NULL AS venue_id, se.comment AS notes,
             COALESCE(se.ended_at, se.started_at) AS checked_in_at, se.created_at,
             NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
             NULL::text AS venue_timezone,
             NULL AS venue_category,
             NULL AS parent_venue_id, NULL AS parent_venue_name,
             NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
             NULL::text AS track_name,
             NULL::numeric AS track_distance_m,
             NULL::text AS track_timezone,
             NULL::timestamptz AS track_started_at,
             NULL::timestamptz AS track_ended_at,
             NULL::bigint AS track_elapsed_time_s,
             NULL::text AS media_type,
             NULL::uuid AS media_item_id,
             NULL::text AS media_title,
             NULL::text AS media_image_url,
             NULL::text AS media_author,
             NULL::smallint AS media_rating,
             NULL::text AS media_checkin_type,
             NULL::int AS media_season_number,
             NULL::int AS media_episode_number,
             NULL::text AS media_episode_title,
             NULL::text AS media_timezone,
             json_build_object(
               'started_at', se.started_at,
               'ended_at', se.ended_at,
               'sleep_timezone', se.sleep_timezone,
               'rating', se.rating,
               'comment', se.comment,
               'sleep_as_android_id', se.sleep_as_android_id
             )::jsonb AS data
      FROM sleep_entries se
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const push = (cond: string, value: unknown) => {
      values.push(value);
      conditions.push(cond.replace('?', `$${values.length}`));
    };

    if (ctx.user_id) {
      push('se.user_id = ?', ctx.user_id);
    }
    if (ctx.from) {
      push(`(se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date >= ?::date`, ctx.from);
    }
    if (ctx.to) {
      push(`(se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date <= ?::date`, ctx.to);
    }
    if (ctx.q) {
      push(`se.comment ILIKE '%' || ? || '%'`, ctx.q);
    }

    const durationFilter = (ctx.filterParams.sleep_duration ?? '').toLowerCase();
    if (durationFilter === 'lte6') {
      conditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) <= 21600`);
    } else if (durationFilter === '6to8') {
      conditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) > 21600`);
      conditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) < 28800`);
    } else if (durationFilter === 'gte8') {
      conditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) >= 28800`);
    }

    return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
  },

  // When a backup carries a plugins.sleep payload the framework restores via
  // backupImport and skips the legacy sleepEntries key. Old backups without
  // a plugins payload keep the legacy import path (restoreLegacyBackup).
  legacyBackupKeys: ['sleepEntries'],

  backupExport: async ({ user_id }) => {
    const result = await query(
      `SELECT id, sleep_as_android_id, sleep_timezone,
              started_at, ended_at, rating, comment,
              is_pending, created_at, updated_at
       FROM sleep_entries
       WHERE user_id = $1
       ORDER BY started_at ASC`,
      [user_id],
    );
    return result.rows;
  },

  backupImport: async ({ user_id, client: txClient }, payload) => {
    const rows = Array.isArray(payload) ? payload : [];
    let inserted = 0;
    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    try {
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || row.sleep_as_android_id == null) continue;
        const result = await client.query(
          `INSERT INTO sleep_entries (
             id, user_id, sleep_as_android_id, sleep_timezone,
             started_at, ended_at, rating, comment,
             is_pending, created_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4,
             COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()),
             $7, $8,
             COALESCE($9, false),
             COALESCE($10::timestamptz, NOW()), COALESCE($11::timestamptz, NOW())
           )
           ON CONFLICT (user_id, sleep_as_android_id) DO NOTHING`,
          [
            row.id,
            user_id,
            row.sleep_as_android_id,
            row.sleep_timezone || 'UTC',
            row.started_at || null,
            row.ended_at || null,
            Number.isFinite(Number(row.rating)) ? Number(row.rating) : 0,
            typeof row.comment === 'string' && row.comment ? row.comment : null,
            typeof row.is_pending === 'boolean' ? row.is_pending : false,
            row.created_at || null,
            row.updated_at || null,
          ],
        );
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }
    return inserted;
  },

  /**
   * Legacy backup restore (backups without a `plugins.sleep` payload keep
   * sleep rows under the top-level `sleepEntries` key). Behavior mirrors the
   * pre-plugin core import loop.
   */
  restoreLegacyBackup: async ({ user_id, client: txClient }, data) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const counts = { sleepEntries: { inserted: 0, skipped: 0 } };
    const rows = Array.isArray(data.sleepEntries) ? (data.sleepEntries as Record<string, unknown>[]) : [];

    for (const row of rows) {
      if (!row?.id || row.sleep_as_android_id == null) {
        counts.sleepEntries.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO sleep_entries (
           id, user_id, sleep_as_android_id, sleep_timezone,
           started_at, ended_at, rating, comment,
           is_pending, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4,
           COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()),
           $7, $8,
           COALESCE($9, false),
           COALESCE($10::timestamptz, NOW()), COALESCE($11::timestamptz, NOW())
         )
         ON CONFLICT (user_id, sleep_as_android_id) DO NOTHING`,
        [
          row.id,
          user_id,
          row.sleep_as_android_id,
          (typeof row.sleep_timezone === 'string' && row.sleep_timezone) || 'UTC',
          row.started_at || null,
          row.ended_at || null,
          Number.isFinite(Number(row.rating)) ? Number(row.rating) : 0,
          typeof row.comment === 'string' && row.comment ? row.comment : null,
          typeof row.is_pending === 'boolean' ? row.is_pending : false,
          row.created_at || null,
          row.updated_at || null,
        ]
      );
      if ((result.rowCount ?? 0) === 1) counts.sleepEntries.inserted += 1;
      else counts.sleepEntries.skipped += 1;
    }

    return counts;
  },

  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const result = await run(
      'DELETE FROM sleep_entries WHERE user_id = $1 RETURNING id',
      [user_id],
    );
    return result.rowCount ?? 0;
  },

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and Maloja enrichment
  // (parity with the other check-in types; sleep entries are currently not
  // photo-attached but may be in future).
  resolveTimestamps: () => ({
    sql: 'SELECT id, started_at AS checked_in_at FROM sleep_entries WHERE id = ANY($1::uuid[])',
  }),

  // "This day in previous years" reflection branch. Emits the shared
  // reflection envelope (matching the core location branch and the mood
  // plugin) so the UNION in /stats/reflections lines up; the sleep payload
  // also lives in `data` for the plugin's reflection card.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'sleep' AS type,
        se.id,
        se.started_at AS checked_in_at,
        se.comment AS note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'started_at', se.started_at,
          'ended_at', se.ended_at,
          'sleep_timezone', se.sleep_timezone,
          'rating', se.rating,
          'comment', se.comment
        )::jsonb AS data
      FROM sleep_entries se
      WHERE se.user_id = $1
        AND TO_CHAR(se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector.
  earliestDate: () => ({
    sql: `SELECT MIN(DATE(started_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC')))::text AS date
          FROM sleep_entries WHERE user_id = $1`,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'sleep entries',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT started_at AS checked_in_at, sleep_timezone AS timezone,
                json_build_object(
                  'started_at', started_at,
                  'ended_at', ended_at,
                  'comment', comment
                )::jsonb AS data
         FROM sleep_entries
         WHERE user_id = $1
           AND (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date >= $2::date
           AND (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date <= $3::date
         ORDER BY ended_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row) => {
      const d = row.data as { started_at: string; ended_at: string; comment: string | null };
      const comment = d.comment ? ` — comment: "${d.comment}"` : '';
      return [`- slept ${formatSleepDuration(d.started_at, d.ended_at)}${comment}`];
    },
  },

  // Timestamp reconciliation participation.
  reconcile: {
    anchorLabel: 'sleep entry',
    scanAll: true,
    detailPath: (id) => `/sleep-entries/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id, started_at AS checked_in_at, sleep_timezone AS original_timezone
         FROM sleep_entries WHERE user_id = $1 ORDER BY started_at ASC`,
        [user_id],
      );
      return result.rows;
    },
    apply: async (id, suggested_timezone) => {
      // Label-only: the stored instant is the true moment; reconciliation
      // only corrects the stored timezone label.
      const result = await query(
        `UPDATE sleep_entries
         SET sleep_timezone = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },

  // Start-over: wipe this plugin's settings rows (entry data is handled by
  // deleteUserData; sleep_webhook_events are per-user event logs that
  // reference nothing persistent).
  resetSettings: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    let deleted = 0;
    const eventsResult = await run(
      'DELETE FROM sleep_webhook_events WHERE user_id = $1 RETURNING id',
      [user_id],
    );
    deleted += eventsResult.rowCount ?? 0;
    const settingsResult = await run(
      'DELETE FROM plugin_settings WHERE user_id = $1 AND plugin_id = $2',
      [user_id, 'sleep'],
    );
    deleted += settingsResult.rowCount ?? 0;
    return deleted;
  },
};
