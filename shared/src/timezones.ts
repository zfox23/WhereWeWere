/**
 * IANA timezone helpers shared by client and server. Uses the standard
 * `Intl.DateTimeFormat` API, which is available in both environments.
 */

/** True when `timeZone` is a valid IANA timezone identifier (e.g. 'America/New_York'). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (minutes east of UTC) of `timeZone` at the instant `utcMs`. */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wallMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wallMs - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** UTC instant (ms) at which the wall clock in `timeZone` reads the given local time. */
export function wallTimeToUtcMs(
  y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, timeZone: string,
): number {
  const baseMs = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let utcMs = baseMs;
  for (let i = 0; i < 3; i++) {
    const next = baseMs - zoneOffsetMinutes(utcMs, timeZone) * 60000;
    if (next === utcMs) break;
    utcMs = next;
  }
  return utcMs;
}

/** The calendar date (YYYY-MM-DD) on the wall clock of `timeZone` at the instant `utcMs`. */
export function localDateInZone(utcMs: number, timeZone: string): string {
  return new Date(utcMs + zoneOffsetMinutes(utcMs, timeZone) * 60000).toISOString().slice(0, 10);
}
