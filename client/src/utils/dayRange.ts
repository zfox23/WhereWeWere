/**
 * Helpers for "the whole local day X in zone Z" ranges, used to build links
 * into external tools (Immich, Dawarich) for a check-in's day.
 */

import { wallTimeToUtcMs, zoneOffsetMinutes } from 'wwp-shared';

export { wallTimeToUtcMs, zoneOffsetMinutes };

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
