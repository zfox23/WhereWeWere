/**
 * Resolve an IANA timezone from coordinates (geo-tz).
 *
 * Shared by the location plugin (check-in timezone inference, timeline
 * post-processing, reconciliation anchors) and by the tracks plugin, which
 * anchors track timezones to nearby venue coordinates. Lives in the location
 * plugin because venue coordinates are location-domain data.
 */

import { find as findTimezone } from 'geo-tz';

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getVenueTimezone(latitude: number | string | null, longitude: number | string | null): string | null {
  if (latitude == null || longitude == null) {
    return null;
  }

  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);

  if (!Number.isFinite(numericLatitude) || !Number.isFinite(numericLongitude)) {
    return null;
  }

  const result = findTimezone(numericLatitude, numericLongitude);
  const timeZone = result[0] || null;
  return timeZone && isValidTimeZone(timeZone) ? timeZone : null;
}

/**
 * Mirror of the client-side ETC_GMT_DISPLAY_MAP (client/src/utils/checkin.ts)
 * and the core reconciliation map. Etc/GMT±N zones (inverted POSIX sign) are
 * fixed-offset zones written by imports that only captured a UTC offset. Map
 * them to the representative DST-aware IANA zone so reconciliation
 * suggestions match what the app displays.
 */
const ETC_GMT_IANA_MAP: Record<string, string> = {
  'Etc/GMT+1': 'Atlantic/Azores',       // UTC-1
  'Etc/GMT+2': 'Atlantic/South_Georgia', // UTC-2
  'Etc/GMT+3': 'America/Godthab',       // UTC-3
  'Etc/GMT+4': 'America/New_York',      // UTC-4 (EDT)
  'Etc/GMT+5': 'America/New_York',      // UTC-5 (EST)
  'Etc/GMT+6': 'America/Chicago',       // UTC-6 (CST)
  'Etc/GMT+7': 'America/Denver',        // UTC-7 (MST/PDT)
  'Etc/GMT+8': 'America/Los_Angeles',   // UTC-8 (PST)
  'Etc/GMT+9': 'America/Anchorage',     // UTC-9 (AKST)
  'Etc/GMT+10': 'Pacific/Honolulu',     // UTC-10 (HST)
  'Etc/GMT+11': 'Pacific/Pago_Pago',    // UTC-11
  'Etc/GMT+12': 'Etc/GMT+12',           // UTC-12 (no better representative)
  'Etc/GMT-1': 'Europe/Paris',          // UTC+1 (CET)
  'Etc/GMT-2': 'Europe/Paris',          // UTC+2 (CEST)
  'Etc/GMT-3': 'Europe/Moscow',         // UTC+3 (MSK)
  'Etc/GMT-4': 'Asia/Dubai',            // UTC+4 (GST)
  'Etc/GMT-5': 'Asia/Karachi',          // UTC+5 (PKT)
  'Etc/GMT-6': 'Asia/Bangkok',          // UTC+6 (ICT)
  'Etc/GMT-7': 'Asia/Jakarta',          // UTC+7 (WIB)
  'Etc/GMT-8': 'Asia/Shanghai',         // UTC+8 (CST)
  'Etc/GMT-9': 'Asia/Tokyo',            // UTC+9 (JST)
  'Etc/GMT-10': 'Australia/Sydney',     // UTC+10 (AEDT)
  'Etc/GMT-11': 'Pacific/Noumea',       // UTC+11
  'Etc/GMT-12': 'Pacific/Fiji',         // UTC+12 (FJT)
};

/** Etc/GMT±N → representative IANA zone (other zones pass through). */
export function normalizeEtcGmt(timeZone: string): string {
  return ETC_GMT_IANA_MAP[timeZone] || timeZone;
}
