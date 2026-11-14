import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Clock time in `timeZone`, optionally followed by its abbreviation (e.g. "3:05 PM CDT"). */
export function formatClock(iso: string, timeZone?: string | null, withZone = false): string {
  const zone = normalizeTimezoneForDisplay(timeZone);
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

/** The calendar day of `iso`, in `timeZone` when given (else the browser's). */
export function formatDay(iso: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const zone = normalizeTimezoneForDisplay(timeZone);
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(zone ? { timeZone: zone } : {}) }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

/** A plain local date ("2024-03-01") as "Mar 1, 2024", with no timezone shift. */
export function formatDateKey(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
}

export function joinArtists(artists: string[] | undefined | null): string {
  return (artists ?? []).join(', ');
}
export const UNKNOWN_ALBUM = 'Unknown album';

/** "3:21" or "201" (seconds) -> seconds; null when it isn't a length. */
export function parseLength(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const plain = /^\d{1,5}$/.exec(t);
  return plain && Number(t) > 0 && Number(t) <= 86_400 ? Number(t) : null;
}

/** Seconds -> "3:21". */
export function formatLength(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Where a play came from, in words. */
export function sourceLabel(source: string | null): string {
  switch (source) {
    case 'manual':
      return 'Written down by hand';
    case 'multi-scrobbler':
      return 'Scrobbled by multi-scrobbler';
    case 'lastfm':
      return 'Imported from Last.fm';
    case 'import':
      return 'Imported';
    default:
      return 'Scrobbled';
  }
}
