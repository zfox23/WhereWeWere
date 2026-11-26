/**
 * Music plugin — a WhereWeWere list as a Spotify playlist.
 *
 * The first export creates a private playlist in the user's Spotify library
 * and remembers it (`music_spotify_exports`); later exports replace its tracks
 * with the list's current ones, in list order (ranked first). Songs become
 * their Spotify track; albums become every track of the Spotify album. Items
 * with no confident match are reported and left out. A remembered playlist
 * the user has since removed from their library is replaced by a new one.
 */

import { query } from '../../../server/src/db';
import { getListItems } from './lists';
import { describeItem, resolveSpotifyId, spotifyUri, type LinkKind } from './spotifyLinks';
import { spotifyApi, SpotifyError, userAccessToken } from './spotifyApi';

const WRITE_BATCH = 100; // Spotify's limit per add/replace call
const PAGE = 50;

export interface UnmatchedItem {
  kind: 'song' | 'album';
  title: string;
  artists: string[];
}

export interface SpotifyExport {
  list_id: string;
  spotify_playlist_id: string;
  url: string;
  exported_at: string;
  track_count: number;
  unmatched: UnmatchedItem[];
}

const playlistUrl = (id: string) => `https://open.spotify.com/playlist/${encodeURIComponent(id)}`;

/** The Spotify playlist a list was exported to, or null. */
export async function getExport(userId: string, listId: string): Promise<SpotifyExport | null> {
  const r = await query(
    `SELECT list_id, spotify_playlist_id, exported_at, track_count, unmatched FROM music_spotify_exports
     WHERE list_id = $1 AND user_id = $2`,
    [listId, userId],
  );
  const row = r.rows[0];
  return row ? { ...row, url: playlistUrl(row.spotify_playlist_id) } : null;
}

/** Track URIs of a Spotify album, in order. */
async function albumTrackUris(token: string, albumId: string): Promise<string[]> {
  const uris: string[] = [];
  let next: string | null = `/albums/${encodeURIComponent(albumId)}/tracks?limit=${PAGE}`;
  while (next) {
    const page: { items?: { id?: unknown; uri?: unknown }[]; next?: string | null } = await spotifyApi(token, next);
    for (const t of page?.items ?? []) {
      if (typeof t?.uri === 'string' && t.uri.startsWith('spotify:track:')) uris.push(t.uri);
      else if (typeof t?.id === 'string') uris.push(spotifyUri('song', t.id));
    }
    next = typeof page?.next === 'string' ? page.next : null;
  }
  return uris;
}

/** Is the playlist still in the user's library? Unknown (an error) counts as yes. */
async function stillInLibrary(token: string, playlistId: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ uris: `spotify:playlist:${playlistId}` });
    const answer = await spotifyApi<unknown>(token, `/me/library/contains?${params}`);
    return !(Array.isArray(answer) && answer[0] === false);
  } catch (err) {
    if (err instanceof SpotifyError && err.upstream === 404) return false;
    return true;
  }
}

async function writeTracks(token: string, playlistId: string, uris: string[]): Promise<void> {
  const path = `/playlists/${encodeURIComponent(playlistId)}/items`;
  // The first call replaces everything (an empty list clears the playlist); the rest append.
  await spotifyApi(token, path, { method: 'PUT', body: { uris: uris.slice(0, WRITE_BATCH) } });
  for (let i = WRITE_BATCH; i < uris.length; i += WRITE_BATCH) {
    await spotifyApi(token, path, { method: 'POST', body: { uris: uris.slice(i, i + WRITE_BATCH) } });
  }
}

/**
 * Export a list to Spotify (create or update its playlist). Null when the list
 * doesn't exist. Throws SpotifyError for anything the user should be told.
 */
export async function exportList(userId: string, listId: string): Promise<(SpotifyExport & { created: boolean }) | null> {
  const list = await query(`SELECT name FROM music_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if (!list.rows[0]) return null;
  const name = list.rows[0].name as string;
  const items = (await getListItems(userId, listId)) ?? [];
  const token = await userAccessToken(userId);

  const uris: string[] = [];
  const unmatched: UnmatchedItem[] = [];
  for (const item of items) {
    const kind: LinkKind = item.kind;
    const ref = kind === 'song' ? item.item_key.slice('song:'.length) : item.album_ref;
    const d = ref && !(kind === 'album' && ref.startsWith('|')) ? await describeItem(userId, kind, ref) : null;
    const id = d && ref ? await resolveSpotifyId(userId, kind, ref, d, token) : null;
    if (!id) {
      unmatched.push({ kind: item.kind, title: item.title, artists: item.artists });
      continue;
    }
    if (kind === 'song') uris.push(spotifyUri('song', id));
    else uris.push(...(await albumTrackUris(token, id)));
  }
  const unique = [...new Set(uris)];

  const previous = await getExport(userId, listId);
  let playlistId = previous?.spotify_playlist_id ?? null;
  if (playlistId && !(await stillInLibrary(token, playlistId))) playlistId = null;
  let created = false;
  if (playlistId) {
    try {
      await writeTracks(token, playlistId, unique);
    } catch (err) {
      // Deleted, or no longer the user's to change: start a new playlist.
      if (!(err instanceof SpotifyError) || (err.upstream !== 403 && err.upstream !== 404)) throw err;
      playlistId = null;
    }
  }
  if (!playlistId) {
    const made = await spotifyApi<{ id?: string }>(token, '/me/playlists', {
      method: 'POST',
      body: { name, public: false, description: `Exported from the WhereWeWere list “${name}”.` },
    });
    if (typeof made?.id !== 'string') throw new SpotifyError('Spotify did not create the playlist.', 502);
    playlistId = made.id;
    created = true;
    await writeTracks(token, playlistId, unique);
  }

  const saved = await query(
    `INSERT INTO music_spotify_exports (list_id, user_id, spotify_playlist_id, exported_at, track_count, unmatched)
     VALUES ($1, $2, $3, NOW(), $4, $5)
     ON CONFLICT (list_id) DO UPDATE SET spotify_playlist_id = EXCLUDED.spotify_playlist_id, exported_at = NOW(),
       track_count = EXCLUDED.track_count, unmatched = EXCLUDED.unmatched
     RETURNING exported_at`,
    [listId, userId, playlistId, unique.length, JSON.stringify(unmatched)],
  );
  return {
    list_id: listId,
    spotify_playlist_id: playlistId,
    url: playlistUrl(playlistId),
    exported_at: saved.rows[0].exported_at,
    track_count: unique.length,
    unmatched,
    created,
  };
}

export interface ExportBackupRow {
  list_name: string;
  spotify_playlist_id: string;
  exported_at: string;
  track_count: number;
  unmatched: UnmatchedItem[];
}

export async function exportExports(userId: string): Promise<ExportBackupRow[]> {
  const r = await query(
    `SELECT l.name AS list_name, e.spotify_playlist_id, e.exported_at, e.track_count, e.unmatched
     FROM music_spotify_exports e JOIN music_lists l ON l.id = e.list_id
     WHERE e.user_id = $1 ORDER BY l.created_at, l.id`,
    [userId],
  );
  return r.rows;
}

/** Re-link restored lists (matched by name) to their Spotify playlists; lists already linked keep theirs. */
export async function importExports(db: { query: typeof query }, userId: string, rows: unknown): Promise<number> {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows as Partial<ExportBackupRow>[]) {
    if (typeof r?.list_name !== 'string' || typeof r.spotify_playlist_id !== 'string') continue;
    if (!/^[A-Za-z0-9]{1,64}$/.test(r.spotify_playlist_id)) continue;
    const at = r.exported_at && !Number.isNaN(new Date(r.exported_at).getTime()) ? new Date(r.exported_at) : new Date();
    const res = await db.query(
      `INSERT INTO music_spotify_exports (list_id, user_id, spotify_playlist_id, exported_at, track_count, unmatched)
       SELECT l.id, l.user_id, $3, $4, $5, $6 FROM music_lists l WHERE l.user_id = $1 AND lower(l.name) = lower($2)
       ON CONFLICT (list_id) DO NOTHING`,
      [
        userId,
        r.list_name,
        r.spotify_playlist_id,
        at,
        Number.isInteger(r.track_count) ? r.track_count : 0,
        JSON.stringify(Array.isArray(r.unmatched) ? r.unmatched : []),
      ],
    );
    n += res.rowCount ?? 0;
  }
  return n;
}
