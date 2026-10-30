/**
 * Wall-clock times in a named timezone: what a check-in's own timezone says
 * the time was, rather than the device's.
 */

import { wallTimeToUtcMs, zoneOffsetMinutes } from 'wwp-shared';

/** A UTC instant as "YYYY-MM-DDTHH:mm" on the wall clock of `timeZone` (for a datetime-local input). */
export function utcToZonedLocalValue(iso: string, timeZone: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms + zoneOffsetMinutes(ms, timeZone) * 60_000).toISOString().slice(0, 16);
}

/** The inverse: a datetime-local value read on the wall clock of `timeZone`, as an ISO instant (null when unreadable). */
export function zonedLocalToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = wallTimeToUtcMs(y, mo, d, h, mi, 0, 0, timeZone);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
