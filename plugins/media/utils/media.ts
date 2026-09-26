import type { MediaSubtype } from '../../../client/src/types';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';

export interface MediaSubtypeConfig {
  subtype: MediaSubtype;
  label: string; // e.g. "Movie"
  plural: string; // e.g. "Movies"
  /** Base path for search screen, e.g. /media-check-in/movie */
  searchPath: string;
  /** Base path for detail pages, e.g. /media/movie */
  detailBase: string;
  /** Human name of the external API, or null if local-only. */
  apiName: string | null;
  icon: string; // emoji fallback
  /** Detail route param segment, e.g. movie, tv, game, book, board-game */
  routeSegment: string;
}

export const MEDIA_SUBTYPES: Record<MediaSubtype, MediaSubtypeConfig> = {
  movie: {
    subtype: 'movie',
    label: 'Movie',
    plural: 'Movies',
    searchPath: '/media-check-in/movie',
    detailBase: '/media/movie',
    apiName: 'TMDB',
    icon: '🎬',
    routeSegment: 'movie',
  },
  tv_show: {
    subtype: 'tv_show',
    label: 'TV Show',
    plural: 'TV Shows',
    searchPath: '/media-check-in/tv-episode',
    detailBase: '/media/tv',
    apiName: 'TMDB',
    icon: '📺',
    routeSegment: 'tv',
  },
  game: {
    subtype: 'game',
    label: 'Game',
    plural: 'Games',
    searchPath: '/media-check-in/game',
    detailBase: '/media/game',
    apiName: 'IGDB',
    icon: '🎮',
    routeSegment: 'game',
  },
  book: {
    subtype: 'book',
    label: 'Book',
    plural: 'Books',
    searchPath: '/media-check-in/book',
    detailBase: '/media/book',
    apiName: 'Hardcover',
    icon: '📖',
    routeSegment: 'book',
  },
  board_game: {
    subtype: 'board_game',
    label: 'Board Game',
    plural: 'Board Games',
    searchPath: '/media-check-in/board-game',
    detailBase: '/media/board-game',
    apiName: null,
    icon: '🎲',
    routeSegment: 'board-game',
  },
};

export const MEDIA_SUBTYPE_LIST: MediaSubtype[] = ['movie', 'tv_show', 'game', 'book', 'board_game'];

/**
 * Human provider name for a specific item. Games are always labeled IGDB
 * (the single game metadata provider); everything else uses the subtype's
 * primary API name.
 */
export function providerNameForItem(
  subtype: MediaSubtype,
  _externalSource: string | null | undefined,
  fallback: string | null
): string | null {
  if (subtype === 'game') return 'IGDB';
  return fallback;
}

export function subtypeFromSegment(segment: string | undefined): MediaSubtype | null {
  if (!segment) return null;
  const found = MEDIA_SUBTYPE_LIST.find((s) => MEDIA_SUBTYPES[s].routeSegment === segment);
  return found || null;
}

export function detailPath(subtype: MediaSubtype, id: string, slug: string): string {
  return `${MEDIA_SUBTYPES[subtype].detailBase}/${id}/${slug}`;
}

export const CHECKIN_TYPE_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In-Progress',
  started: 'Started',
  dropped: 'Dropped',
};

/** Format total minutes as e.g. "5h 26m", "3h", "45m"; null/0 -> null. */
export function formatTimePlayed(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatCheckinDate(iso: string, timezone?: string | null): string {
  const d = new Date(iso);
  const displayTimeZone = normalizeTimezoneForDisplay(timezone);
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
    });
  } catch {
    return d.toLocaleString('en-US');
  }
}

/** Calendar date (YYYY-MM-DD) of an instant in a given timezone. */
export function dateInTimezone(iso: string, timezone?: string | null): string {
  const d = new Date(iso);
  try {
    return d.toLocaleDateString('en-CA', { ...(timezone ? { timeZone: timezone } : {}) });
  } catch {
    return d.toLocaleDateString('en-CA');
  }
}

/**
 * `<input type="datetime-local">` value (YYYY-MM-DDTHH:mm) for the instant
 * `iso` as displayed in `timezone` (falls back to device time).
 */
export function isoToDatetimeValue(iso: string, timezone?: string | null): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

/**
 * ISO string for the wall-clock `value` (YYYY-MM-DDTHH:mm from a
 * datetime-local input) interpreted in `timezone` — i.e. the absolute
 * instant that instant in `timezone` represents. The offset probe via
 * formatToParts keeps this correct even when `timezone` differs from the
 * device timezone.
 */
export function datetimeValueToIso(value: string, timezone: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const wallUtcMs = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(wallUtcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const tzInterpretedMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const offsetMs = tzInterpretedMs - wallUtcMs;
    return new Date(wallUtcMs - offsetMs).toISOString();
  } catch {
    return null;
  }
}
