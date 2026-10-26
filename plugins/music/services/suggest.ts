/**
 * Music plugin — autocomplete for the hand-entry form.
 *
 * Songs the user already plays come first (their own spelling, album and
 * length), then Deezer's catalog. The catalog fetch is injectable and off
 * under test, like album lookups.
 */

import { query } from '../../../server/src/db';
import { escapeLike } from '../../../server/src/services/queryParams';
import { normalizeTitle, sameArtist } from './albumMatch';
import { fullestArtistsSql, latestTitleSql } from './identity';
import { ProviderUnavailableError, type FetchLike } from './albumProviders';

export interface Suggestion {
  source: 'library' | 'deezer';
  title: string;
  artists: string[];
  album: string | null;
  album_artist: string | null;
  /** Seconds. */
  length: number | null;
  /** A small cover, from the catalog. */
  cover_url: string | null;
  /** Your plays of it (library only). */
  plays: number | null;
}

export interface SuggestQuery {
  artist: string;
  title: string;
}

const MIN_QUERY_CHARS = 2;

export async function searchLibrary(userId: string, q: SuggestQuery, limit: number): Promise<Suggestion[]> {
  const result = await query(
    `SELECT ${latestTitleSql()} AS title, ${fullestArtistsSql()} AS artists,
            (ARRAY_AGG(album ORDER BY played_at DESC) FILTER (WHERE album IS NOT NULL))[1] AS album,
            (ARRAY_AGG(COALESCE(album_artists[1], artists[1]) ORDER BY played_at DESC) FILTER (WHERE album IS NOT NULL))[1] AS album_artist,
            MAX(track_length) AS length, COUNT(*)::int AS plays, MAX(played_at) AS last_played
     FROM music_scrobbles
     WHERE user_id = $1
       AND ($2 = '' OR lower(title) LIKE '%' || lower($2) || '%' ESCAPE '\\')
       AND ($3 = '' OR lower(array_to_string(artists, ' ')) LIKE '%' || lower($3) || '%' ESCAPE '\\')
     GROUP BY song_key
     ORDER BY plays DESC, last_played DESC
     LIMIT $4`,
    [userId, escapeLike(q.title.trim()), escapeLike(q.artist.trim()), limit],
  );
  return result.rows.map((r: any) => ({
    source: 'library' as const,
    title: r.title,
    artists: r.artists,
    album: r.album,
    album_artist: r.album_artist,
    length: r.length,
    cover_url: null,
    plays: r.plays,
  }));
}

// ---- Deezer ---------------------------------------------------------------

let lastRequest = 0;
const GAP_MS = 150;

export async function searchCatalog(fetchImpl: FetchLike, q: SuggestQuery, limit: number): Promise<Suggestion[]> {
  const artist = q.artist.trim();
  const title = q.title.trim();
  const quote = (s: string) => s.replace(/"/g, ' ');
  const search =
    artist && title ? `artist:"${quote(artist)}" track:"${quote(title)}"` : `${artist} ${title}`.trim();
  const wait = lastRequest + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  let res;
  try {
    res = await fetchImpl(`https://api.deezer.com/search/track?${new URLSearchParams({ q: search, limit: String(limit * 2) })}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ProviderUnavailableError(`Couldn't reach Deezer: ${err instanceof Error ? err.message : 'network error'}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new ProviderUnavailableError('Deezer is unavailable');
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const t of Array.isArray(body?.data) ? body.data : []) {
    const name = String(t.title ?? '').trim();
    const by = String(t.artist?.name ?? '').trim();
    if (!name || !by) continue;
    const key = `${normalizeTitle(name)}|${normalizeTitle(by)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: 'deezer',
      title: name,
      artists: [by],
      album: t.album?.title ? String(t.album.title) : null,
      album_artist: t.album?.title ? by : null,
      length: Number(t.duration) > 0 ? Number(t.duration) : null,
      cover_url: t.album?.cover_small ?? null,
      plays: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Tests never reach the network: they inject a fetch with `setSuggestFetch`.
let fetchImpl: FetchLike | null = process.env.NODE_ENV === 'test' ? null : (url, init) => fetch(url, init);

export function setSuggestFetch(next: FetchLike | null): void {
  fetchImpl = next;
}

/** Library matches first, then catalog matches the library didn't already offer. */
export async function suggest(
  userId: string,
  q: SuggestQuery,
  limit = 8,
): Promise<{ suggestions: Suggestion[]; catalog_unavailable: boolean }> {
  if (`${q.artist}${q.title}`.trim().length < MIN_QUERY_CHARS) return { suggestions: [], catalog_unavailable: false };
  const library = await searchLibrary(userId, q, Math.ceil(limit / 2));
  let catalog: Suggestion[] = [];
  let unavailable = false;
  if (fetchImpl) {
    try {
      catalog = await searchCatalog(fetchImpl, q, limit);
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      unavailable = true;
    }
  }
  const known = library.map((s) => ({ t: normalizeTitle(s.title), a: s.artists[0] ?? '' }));
  const fresh = catalog.filter((c) => !known.some((k) => k.t === normalizeTitle(c.title) && sameArtist(k.a, c.artists[0])));
  return { suggestions: [...library, ...fresh].slice(0, limit), catalog_unavailable: unavailable };
}
