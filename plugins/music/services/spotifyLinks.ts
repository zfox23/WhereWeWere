/**
 * Music plugin — "Open in Spotify" for a song, album or artist.
 *
 * The first time an item is asked for, Spotify's catalog is searched with the
 * name the user's plays use and the result is kept in `music_spotify_links`
 * (a match, or "no confident match", which is retried after a while). With a
 * match the button opens the item itself; without one, a Spotify search.
 */

import { query } from '../../../server/src/db';
import { pickAlbum, pickArtist, pickTrack, searchTerm, type AlbumCandidate, type ArtistCandidate, type TrackCandidate } from './spotifyMatch';
import { searchToken, spotifyApi, SpotifyError } from './spotifyApi';

export type LinkKind = 'song' | 'album' | 'artist';

const SPOTIFY_TYPE: Record<LinkKind, 'track' | 'album' | 'artist'> = { song: 'track', album: 'album', artist: 'artist' };

/** "No match" is asked again after this long (the catalog grows). */
const RETRY_MISSING_MS = 30 * 24 * 3600 * 1000;
const SEARCH_LIMIT = 10; // Spotify's maximum since February 2026

export const openUrl = (kind: LinkKind, id: string) => `https://open.spotify.com/${SPOTIFY_TYPE[kind]}/${encodeURIComponent(id)}`;
export const searchUrl = (text: string) => `https://open.spotify.com/search/${encodeURIComponent(text)}`;
export const spotifyUri = (kind: LinkKind, id: string) => `spotify:${SPOTIFY_TYPE[kind]}:${id}`;

/** What the user's plays call an item: enough to search for it. */
export interface ItemDescription {
  title: string | null;
  artist: string;
  album: string | null;
}

/** The names the user's plays give a song, an album (by album_key) or an artist; null when they have no such plays. */
export async function describeItem(userId: string, kind: LinkKind, ref: string): Promise<ItemDescription | null> {
  if (kind === 'song') {
    const r = await query(
      `SELECT (ARRAY_AGG(title ORDER BY played_at DESC))[1] AS title,
              (ARRAY_AGG(artists[1] ORDER BY played_at DESC))[1] AS artist,
              (ARRAY_AGG(album ORDER BY played_at DESC) FILTER (WHERE album IS NOT NULL AND btrim(album) <> ''))[1] AS album
       FROM music_scrobbles WHERE user_id = $1 AND song_key = $2`,
      [userId, ref],
    );
    const row = r.rows[0];
    return row?.title ? { title: row.title, artist: row.artist ?? '', album: row.album ?? null } : null;
  }
  if (kind === 'album') {
    const r = await query(
      `SELECT (ARRAY_AGG(album ORDER BY played_at DESC))[1] AS album,
              (ARRAY_AGG(COALESCE(album_artists[1], artists[1]) ORDER BY played_at DESC))[1] AS artist
       FROM music_scrobbles WHERE user_id = $1 AND album_key = $2`,
      [userId, ref],
    );
    const row = r.rows[0];
    return row?.album ? { title: null, artist: row.artist ?? '', album: row.album } : null;
  }
  // As the artist page counts them: any play crediting exactly this name.
  const r = await query(`SELECT 1 FROM music_scrobbles WHERE user_id = $1 AND $2::text = ANY(artists) LIMIT 1`, [userId, ref]);
  return r.rows.length > 0 ? { title: null, artist: ref, album: null } : null;
}

/** The cache key of an item: song_key, album_key, or the artist's name lower-cased. */
export const linkKey = (kind: LinkKind, ref: string) => (kind === 'artist' ? ref.trim().toLowerCase() : ref);

/** What to search Spotify for when there's no match (also the query of the search link). */
export function searchText(kind: LinkKind, d: ItemDescription): string {
  if (kind === 'song') return `${d.artist} ${searchTerm(d.title ?? '')}`.trim();
  if (kind === 'album') return `${d.artist} ${searchTerm(d.album ?? '')}`.trim();
  return d.artist;
}

/** Search Spotify's catalog for the item; its Spotify id or null. */
async function searchCatalog(token: string, kind: LinkKind, d: ItemDescription): Promise<string | null> {
  const artist = searchTerm(d.artist);
  const q =
    kind === 'song'
      ? `track:"${searchTerm(d.title ?? '')}" artist:"${artist}"`
      : kind === 'album'
        ? `album:"${searchTerm(d.album ?? '')}" artist:"${artist}"`
        : `artist:"${artist}"`;
  const type = SPOTIFY_TYPE[kind];
  const params = new URLSearchParams({ q, type, limit: String(SEARCH_LIMIT) });
  const result = await spotifyApi<Record<string, { items?: unknown[] } | undefined>>(token, `/search?${params}`);
  const items = (result?.[`${type}s`]?.items ?? []).filter((i): i is object => !!i && typeof i === 'object');
  if (kind === 'song') return pickTrack(items as TrackCandidate[], { title: d.title ?? '', artist: d.artist, album: d.album });
  if (kind === 'album') return pickAlbum(items as AlbumCandidate[], { album: d.album ?? '', artist: d.artist });
  return pickArtist(items as ArtistCandidate[], d.artist);
}

/**
 * The Spotify id of an item (cached), or null when Spotify has no confident
 * match. Throws SpotifyError when Spotify can't be asked (not configured,
 * unavailable); nothing is cached then.
 */
export async function resolveSpotifyId(
  userId: string,
  kind: LinkKind,
  ref: string,
  d: ItemDescription,
  token?: string,
): Promise<string | null> {
  const key = linkKey(kind, ref);
  const cached = await query(
    `SELECT spotify_id, looked_up_at FROM music_spotify_links WHERE user_id = $1 AND kind = $2 AND item_key = $3`,
    [userId, kind, key],
  );
  const row = cached.rows[0];
  if (row && (row.spotify_id || Date.now() - new Date(row.looked_up_at).getTime() < RETRY_MISSING_MS)) {
    return row.spotify_id ?? null;
  }
  const id = await searchCatalog(token ?? (await searchToken(userId)), kind, d);
  await query(
    `INSERT INTO music_spotify_links (user_id, kind, item_key, spotify_id, looked_up_at) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, kind, item_key) DO UPDATE SET spotify_id = EXCLUDED.spotify_id, looked_up_at = NOW()`,
    [userId, kind, key, id],
  );
  return id;
}

export interface SpotifyLink {
  url: string;
  /** True: opens the item itself. False: opens a Spotify search for it. */
  matched: boolean;
}

/** Where "Open in Spotify" goes for an item, or null when the user has no plays of it. */
export async function getSpotifyLink(userId: string, kind: LinkKind, ref: string): Promise<SpotifyLink | null> {
  const d = await describeItem(userId, kind, ref);
  if (!d) return null;
  try {
    const id = await resolveSpotifyId(userId, kind, ref, d);
    if (id) return { url: openUrl(kind, id), matched: true };
  } catch (err) {
    // Not set up is the caller's to report; an unreachable Spotify still gets a search link.
    if (!(err instanceof SpotifyError) || err.status === 404) throw err;
  }
  return { url: searchUrl(searchText(kind, d)), matched: false };
}

export interface LinkBackupRow {
  kind: LinkKind;
  item_key: string;
  spotify_id: string | null;
  looked_up_at: string;
}

export async function exportLinks(userId: string): Promise<LinkBackupRow[]> {
  const r = await query(
    `SELECT kind, item_key, spotify_id, looked_up_at FROM music_spotify_links WHERE user_id = $1 ORDER BY kind, item_key`,
    [userId],
  );
  return r.rows;
}

/** Restore matches this server doesn't have yet. */
export async function importLinks(db: { query: typeof query }, userId: string, rows: unknown): Promise<number> {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows as Partial<LinkBackupRow>[]) {
    if (!r || !['song', 'album', 'artist'].includes(r.kind as string) || typeof r.item_key !== 'string' || !r.item_key) continue;
    const id = typeof r.spotify_id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(r.spotify_id) ? r.spotify_id : null;
    const at = r.looked_up_at && !Number.isNaN(new Date(r.looked_up_at).getTime()) ? new Date(r.looked_up_at) : new Date();
    const res = await db.query(
      `INSERT INTO music_spotify_links (user_id, kind, item_key, spotify_id, looked_up_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [userId, r.kind, r.item_key.slice(0, 4000), id, at],
    );
    n += res.rowCount ?? 0;
  }
  return n;
}
