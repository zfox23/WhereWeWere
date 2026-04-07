/**
 * Map Etc/GMT±N timezones (which don't have nice abbreviations) to representative
 * IANA timezones for display. This allows showing "PDT" instead of "GMT-7".
 */
const ETC_GMT_DISPLAY_MAP: Record<string, string> = {
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

/**
 * Convert Etc/GMT±N timezone to a representative IANA timezone for nice display names.
 * Falls back to the input timezone if not in the map.
 */
export function normalizeTimezoneForDisplay(tz: string | null | undefined): string | null | undefined {
  if (!tz) return tz;
  return ETC_GMT_DISPLAY_MAP[tz] || tz;
}

export function formatDate(dateStr: string, timeZone?: string | null): string {
  const date = new Date(dateStr);
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatTime(dateStr: string, timeZone?: string | null): string {
  const date = new Date(dateStr);
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatMalojaDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function buildImmichTimeUrl(immichUrl: string, checkedInAt: string): string {
  const t = new Date(checkedInAt);
  const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
  const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const query = JSON.stringify({ takenAfter, takenBefore });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

export function buildImmichMapUrl(immichUrl: string, lat: number, lng: number): string {
  return `${immichUrl}/map#15/${lat}/${lng}`;
}

export function buildMalojaTrackUrl(malojaUrl: string, artists: string[], title?: string): string {
  const params = new URLSearchParams();
  for (const artist of artists) {
    params.append('trackartist', artist);
  }
  if (title) params.append('title', title);
  return `${malojaUrl}/track?${params.toString()}`;
}
