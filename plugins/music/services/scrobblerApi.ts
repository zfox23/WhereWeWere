/**
 * Music plugin — multi-scrobbler wire protocol.
 *
 * Multi-scrobbler has no plugin mechanism: its client types are a fixed list.
 * The one it can be pointed at with nothing but a URL and a key is its
 * "Maloja" client, so WhereWeWere implements that small HTTP contract. This is
 * the only place the protocol (and its name) is spoken; everything past these
 * mappers is plain WhereWeWere data.
 *
 * Pure functions only — the router in `../server.ts` does the I/O.
 */

import type { ScrobbleInput, StoredScrobble } from './scrobbles';

export const API_MOUNT = '/apis/mlj_1';

/** Reported to multi-scrobbler; it requires a version of at least 3.0.0. */
export const SERVER_INFO = {
  name: 'WhereWeWere',
  version: ['3', '2', '9'],
  versionstring: '3.2.9',
  db_status: { healthy: true, rebuildinprogress: false, complete: true },
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanStringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.map(cleanString).filter((v): v is string => v !== null);
}

function wholeSeconds(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export type ParsedScrobble =
  | { ok: true; scrobble: ScrobbleInput }
  | { ok: false; reason: string };

/** Map a `newscrobble` request body to a scrobble row. */
export function parseNewScrobble(body: unknown, now: Date = new Date()): ParsedScrobble {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = cleanString(b.title);
  if (!title) return { ok: false, reason: 'Missing title' };
  const artists = cleanStringList(b.artists ?? b.artist);
  if (artists.length === 0) return { ok: false, reason: 'Missing artists' };

  let playedAt = now;
  if (b.time !== undefined && b.time !== null) {
    const seconds = Number(b.time);
    if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: 'Invalid time' };
    playedAt = new Date(seconds * 1000);
  }

  return {
    ok: true,
    scrobble: {
      playedAt,
      title,
      artists,
      album: cleanString(b.album),
      albumArtists: cleanStringList(b.albumartists),
      trackLength: wholeSeconds(b.length),
      listenedFor: wholeSeconds(b.duration),
      source: 'multi-scrobbler',
    },
  };
}

export function newScrobbleSuccess(s: ScrobbleInput) {
  return {
    status: 'success',
    track: {
      title: s.title,
      artists: s.artists,
      ...(s.album ? { album: { albumtitle: s.album, artists: s.albumArtists?.length ? s.albumArtists : s.artists } } : {}),
    },
    desc: `Scrobbled ${s.title} by ${s.artists.join(', ')}`,
    warnings: [],
  };
}

export function failure(type: string, desc: string) {
  return { status: 'failure', error: { type, desc } };
}

/** One entry of the `scrobbles` list response. */
export function toScrobbleListEntry(row: StoredScrobble) {
  return {
    time: Math.floor(new Date(row.played_at).getTime() / 1000),
    track: {
      artists: row.artists,
      title: row.title,
      ...(row.album
        ? { album: { albumtitle: row.album, artists: row.album_artists.length ? row.album_artists : row.artists } }
        : {}),
      ...(row.track_length != null ? { length: row.track_length } : {}),
    },
    ...(row.listened_for != null ? { duration: row.listened_for } : {}),
  };
}

export function scrobbleListResponse(
  rows: StoredScrobble[],
  page: number,
  perPage: number,
  hasMore: boolean,
  query: URLSearchParams,
) {
  const link = (p: number) => {
    const q = new URLSearchParams(query);
    q.set('page', String(p));
    q.set('perpage', String(perPage));
    return `${API_MOUNT}/scrobbles?${q.toString()}`;
  };
  return {
    status: 'ok',
    list: rows.map(toScrobbleListEntry),
    pagination: {
      page,
      perpage: perPage,
      next_page: hasMore ? link(page + 1) : null,
      prev_page: page > 0 ? link(page - 1) : null,
    },
  };
}

/**
 * Parse a `YYYY`, `YYYY/MM` or `YYYY/MM/DD` (or dash-separated) date into a
 * half-open UTC range. Returns null for anything else.
 */
export function parseDateRange(raw: unknown): { from: Date; until: Date } | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})(?:[/-](\d{1,2})(?:[/-](\d{1,2}))?)?$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  const day = m[3] ? Number(m[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && (day < 1 || day > 31)) return null;
  const from = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const until = day !== null
    ? new Date(Date.UTC(year, month! - 1, day + 1))
    : month !== null
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year + 1, 0, 1));
  if (Number.isNaN(from.getTime())) return null;
  return { from, until };
}
