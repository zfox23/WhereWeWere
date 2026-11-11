/**
 * Notification helpers shared by the client and server.
 *
 * Plugins declare notification triggers in their manifest; the core owns
 * delivery (Web Push), the user's toggles, and de-duplication. Scheduled
 * triggers return occurrences from `dueOccurrences`; helpers here turn
 * wall-clock schedules into UTC instants.
 */

import { localDateInZone, wallTimeToUtcMs } from './timezones';

/** What a notification shows and where tapping it goes. */
export interface NotificationPayload {
  title: string;
  body?: string;
  /** Same-origin, app-relative path opened on tap, e.g. '/mood-check-in'. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

/** A notification trigger a plugin offers (shown in Settings > Notifications). */
export interface PluginNotificationTrigger {
  /** Stable key, unique within the plugin, e.g. 'checkin_reminder'. */
  key: string;
  label: string;
  description?: string;
}

/** The plugin_settings key core uses for a plugin's notifications toggle. */
export const NOTIFICATIONS_ENABLED_KEY = 'notifications_enabled';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a 24-hour 'HH:MM' wall-clock time. */
export function isValidWallTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/**
 * Validate a list of daily reminder times: unique 24-hour 'HH:MM' strings,
 * at most `max`. Returns an error message, or null when valid.
 */
export function validateDailyTimes(value: unknown, max = 12): string | null {
  if (!Array.isArray(value)) return 'Reminder times must be a list';
  if (value.length > max) return `At most ${max} reminder times`;
  const seen = new Set<string>();
  for (const t of value) {
    if (!isValidWallTime(t)) return `Invalid time: ${String(t)} (use HH:MM)`;
    if (seen.has(t)) return `Duplicate time: ${t}`;
    seen.add(t);
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC instants (ms) of every daily `times` occurrence on the wall clock of
 * `timeZone` that falls in the half-open window (since, now].
 *
 * Each local date yields exactly one instant per time, so a time repeated by
 * a DST fall-back fires once, and a time skipped by spring-forward fires at
 * the shifted instant. Results are sorted ascending.
 */
export function dailyTimeOccurrences(
  times: readonly string[],
  timeZone: string,
  since: number,
  now: number,
): number[] {
  if (times.length === 0 || now <= since) return [];
  // Local dates covering the window, padded by a day on each side so zone
  // offsets (up to ±14h) can't drop an occurrence at the edges.
  const dates = new Set<string>();
  for (let t = since - DAY_MS; t <= now + DAY_MS; t += DAY_MS) {
    dates.add(localDateInZone(t, timeZone));
  }
  dates.add(localDateInZone(now + DAY_MS, timeZone));
  const out = new Set<number>();
  for (const date of dates) {
    const [y, mo, d] = date.split('-').map(Number);
    for (const time of times) {
      const m = TIME_PATTERN.exec(time);
      if (!m) continue;
      const at = wallTimeToUtcMs(y, mo, d, Number(m[1]), Number(m[2]), 0, 0, timeZone);
      if (at > since && at <= now) out.add(at);
    }
  }
  return [...out].sort((a, b) => a - b);
}
