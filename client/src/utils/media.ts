import type { MediaSubtype } from '../types';
import { normalizeTimezoneForDisplay } from './checkin';

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
    apiName: 'TGDB',
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

export function subtypeFromSegment(segment: string | undefined): MediaSubtype | null {
  if (!segment) return null;
  const found = MEDIA_SUBTYPE_LIST.find((s) => MEDIA_SUBTYPES[s].routeSegment === segment);
  return found || null;
}

export function detailPath(subtype: MediaSubtype, id: string, slug: string): string {
  return `${MEDIA_SUBTYPES[subtype].detailBase}/${id}/${slug}`;
}

export function checkinFormPath(subtype: MediaSubtype, id: string, slug: string): string {
  if (subtype === 'tv_show') {
    // TV check-in form requires season/episode: /media-check-in/tv/<id>/<slug>/<s>/<e>
    return `${MEDIA_SUBTYPES.tv_show.searchPath.replace('/tv-episode', '/tv')}/${id}/${slug}`;
  }
  return `${MEDIA_SUBTYPES[subtype].searchPath}/${id}/${slug}`;
}

export const CHECKIN_TYPE_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In-Progress',
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
