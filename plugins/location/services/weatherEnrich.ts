// ============================================================================
// Fetch the weather for a local day and store it in daily_weather. Runs
// fire-and-forget after a check-in save and from the backfill job: it never
// throws, failures are stored on the row.
// ============================================================================

import { query } from '../../../server/src/db';
import { resolveNoonLocation } from './noonLocation';
import { ARCHIVE_LAG_DAYS, OpenMeteoError, fetchDayWeather } from './openMeteo';

/** Weather is opt-in: nothing is sent to Open-Meteo until the user enables it. */
export async function isWeatherEnabled(userId: string): Promise<boolean> {
  const result = await query(
    `SELECT value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'location' AND key = 'weather_enabled'`,
    [userId],
  );
  return result.rows[0]?.value === true;
}

/** The check-in's local calendar day (YYYY-MM-DD), as the timeline groups it. */
export async function checkinLocalDate(checkinId: string): Promise<string | null> {
  const result = await query(
    `SELECT TO_CHAR((checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date, 'YYYY-MM-DD') AS date
       FROM checkins WHERE id = $1`,
    [checkinId],
  );
  return result.rows[0]?.date ?? null;
}

/**
 * Look up and store the weather for one local day. Resolves to `{ fatal }`
 * when the service is rate limiting, so the backfill can stop.
 */
export async function enrichWeatherForDate(
  userId: string,
  date: string,
  options: { patient?: boolean } = {},
): Promise<{ fatal?: string }> {
  try {
    const where = await resolveNoonLocation(userId, date);
    if (!where) return {};
    try {
      const data = await fetchDayWeather(where.latitude, where.longitude, date, where.timezone, {
        maxRetries: options.patient ? 2 : 0,
      });
      await query(
        `INSERT INTO daily_weather (user_id, local_date, status, latitude, longitude, timezone, data, error, fetched_at)
         VALUES ($1, $2::date, 'ok', $3, $4, $5, $6::jsonb, NULL, NOW())
         ON CONFLICT (user_id, local_date) DO UPDATE SET
           status = 'ok', latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           timezone = EXCLUDED.timezone, data = EXCLUDED.data, error = NULL, fetched_at = NOW()`,
        [userId, date, where.latitude, where.longitude, where.timezone, JSON.stringify(data)],
      );
      return {};
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Weather lookup failed';
      console.error(`Weather lookup failed for ${date} (non-fatal):`, err);
      await query(
        `INSERT INTO daily_weather (user_id, local_date, status, latitude, longitude, timezone, error, fetched_at)
         VALUES ($1, $2::date, 'error', $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, local_date) DO UPDATE SET
           status = CASE WHEN daily_weather.status = 'ok' THEN daily_weather.status ELSE 'error' END,
           error = EXCLUDED.error`,
        [userId, date, where.latitude, where.longitude, where.timezone, message],
      );
      return err instanceof OpenMeteoError && err.status === 429 ? { fatal: message } : {};
    }
  } catch (err) {
    console.error('Weather enrichment failed (non-fatal):', err);
    return {};
  }
}

/** Fire-and-forget refresh for a day after its check-ins changed (when enabled). */
export function scheduleWeatherForDate(userId: string, date: string | null): void {
  if (!date) return;
  isWeatherEnabled(userId)
    .then((on) => (on ? enrichWeatherForDate(userId, date) : undefined))
    .catch((err) => console.error('Weather scheduling failed (non-fatal):', err));
}

/** Pause between lookups: well under Open-Meteo's 600 calls a minute. */
export const BACKFILL_DELAY_MS = 250;

/**
 * Days with check-ins that have no weather yet, whose last lookup failed, or
 * that were stored from the forecast API and are now old enough for the archive.
 */
export async function pendingWeatherDates(userId: string): Promise<string[]> {
  const result = await query(
    `WITH days AS (
       SELECT DISTINCT (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date AS d
         FROM checkins WHERE user_id = $1
     )
     SELECT TO_CHAR(days.d, 'YYYY-MM-DD') AS date
       FROM days
       LEFT JOIN daily_weather w ON w.user_id = $1 AND w.local_date = days.d
      WHERE w.local_date IS NULL
         OR w.status = 'error'
         OR (COALESCE((w.data->>'final')::boolean, false) = false
             AND days.d <= CURRENT_DATE - $2::int)
      ORDER BY days.d DESC`,
    [userId, ARCHIVE_LAG_DAYS],
  );
  return result.rows.map((r: { date: string }) => r.date);
}

/** Look the days up one at a time, stopping when Open-Meteo rate limits us. */
export async function runWeatherBackfill(
  dates: string[],
  userId: string,
  hooks: {
    delayMs?: number;
    isCancelled?: () => boolean;
    onProgress?: (done: number, total: number) => Promise<void> | void;
  } = {},
): Promise<void> {
  const delayMs = hooks.delayMs ?? BACKFILL_DELAY_MS;
  for (let i = 0; i < dates.length; i++) {
    if (hooks.isCancelled?.()) throw new Error('cancelled');
    const started = Date.now();
    const result = await enrichWeatherForDate(userId, dates[i], { patient: true });
    if (result.fatal) throw new Error(result.fatal);
    await hooks.onProgress?.(i + 1, dates.length);
    const wait = delayMs - (Date.now() - started);
    if (i < dates.length - 1 && wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
