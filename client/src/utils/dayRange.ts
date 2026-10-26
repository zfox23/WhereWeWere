/**
 * Helpers for "the whole local day X in zone Z" ranges, used to build links
 * into external tools (Immich, Dawarich) for a check-in's day.
 */

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function resolveZone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch {
      // fall through to the device zone
    }
  }
  return deviceTimeZone();
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

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface ZonedDayBounds {
  startIso: string;
  endIso: string;
  /** UTC offset (`+HH:MM`) in effect at the start / end of the day. */
  startOffset: string;
  endOffset: string;
}

/**
 * Bounds of the local calendar day `date` (YYYY-MM-DD) in `timeZone`
 * (the device zone when null/invalid). DST-aware: a 23- or 25-hour day gets
 * the right end instant and offsets.
 */
export function zonedDayBounds(date: string, timeZone: string | null | undefined): ZonedDayBounds {
  const zone = resolveZone(timeZone);
  const [y, mo, d] = date.split('-').map(Number);
  const startMs = wallTimeToUtcMs(y, mo, d, 0, 0, 0, 0, zone);
  const endMs = wallTimeToUtcMs(y, mo, d, 23, 59, 59, 999, zone);
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    startOffset: formatOffset(zoneOffsetMinutes(startMs, zone)),
    endOffset: formatOffset(zoneOffsetMinutes(endMs, zone)),
  };
}
