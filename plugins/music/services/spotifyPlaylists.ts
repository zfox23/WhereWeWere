/**
 * Music plugin — the synced Spotify playlists with the user's plays of their
 * tracks (Profile → Music → Playlists). A track's plays are every play of the
 * same song (song key: title without credits or remaster tags, and first
 * artist), however it was scrobbled.
 */

import { query } from '../../../server/src/db';
import { albumRefSql } from './identity';
import type { DayCount } from './detail';

export interface SpotifyPlaylistRow {
  spotify_id: string;
  /** Place in the user's Spotify library (0 = first). */
  position: number;
  name: string;
  description: string | null;
  owner_name: string | null;
  /** The user's own (or collaborative) playlist. */
  mine: boolean;
  has_cover: boolean;
  total_tracks: number | null;
  tracks_available: boolean;
  /** Newest "date added" of its tracks; null when unknown. */
  last_modified_at: string | null;
  url: string;
  /** All-time plays of its songs (each song once, however often it's on the playlist). */
  plays: number;
  /** Its songs the user has played, and never played. */
  played_songs: number;
  unplayed_songs: number;
  last_played_at: string | null;
}

const playlistUrl = (id: string) => `https://open.spotify.com/playlist/${encodeURIComponent(id)}`;

const PLAYLIST_COLUMNS = `p.spotify_id, p.position, p.name, p.description, p.owner_name,
  (p.collaborative OR p.owner_id IS NOT DISTINCT FROM acc.spotify_user_id) AS mine,
  p.image_url IS NOT NULL AS has_cover, p.total_tracks, p.tracks_available, p.last_modified_at`;

/** Every synced playlist in Spotify's order, with play totals. */
export async function listPlaylists(userId: string): Promise<SpotifyPlaylistRow[]> {
  const r = await query(
    `WITH songs AS (
       SELECT DISTINCT playlist_id, song_key FROM music_spotify_playlist_tracks WHERE user_id = $1
     ),
     played AS (
       SELECT song_key, COUNT(*)::int AS plays, MAX(played_at) AS last_played_at
       FROM music_scrobbles
       WHERE user_id = $1 AND song_key IN (SELECT song_key FROM songs)
       GROUP BY song_key
     )
     SELECT ${PLAYLIST_COLUMNS},
            COALESCE(SUM(pl.plays), 0)::int AS plays,
            COUNT(pl.song_key)::int AS played_songs,
            (COUNT(s.song_key) - COUNT(pl.song_key))::int AS unplayed_songs,
            MAX(pl.last_played_at) AS last_played_at
     FROM music_spotify_playlists p
     JOIN music_spotify_accounts acc ON acc.user_id = p.user_id
     LEFT JOIN songs s ON s.playlist_id = p.spotify_id
     LEFT JOIN played pl ON pl.song_key = s.song_key
     WHERE p.user_id = $1
     GROUP BY p.user_id, p.spotify_id, acc.spotify_user_id
     ORDER BY p.position`,
    [userId],
  );
  return r.rows.map((row) => ({ ...row, url: playlistUrl(row.spotify_id) }));
}

export interface SpotifyPlaylistTrack {
  position: number;
  spotify_id: string | null;
  url: string | null;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number | null;
  added_at: string | null;
  is_local: boolean;
  song_key: string;
  plays: number;
  first_played_at: string | null;
  last_played_at: string | null;
  /** The album of the user's latest play of the song, for its cover. */
  album_ref: string | null;
  art_id: string | null;
}

export interface SpotifyPlaylistDetail extends Omit<SpotifyPlaylistRow, 'plays' | 'played_songs' | 'unplayed_songs' | 'last_played_at'> {
  tracks: SpotifyPlaylistTrack[];
  /** Plays of its songs per local day, oldest first. */
  daily: DayCount[];
}

export async function getPlaylist(userId: string, playlistId: string): Promise<SpotifyPlaylistDetail | null> {
  const head = await query(
    `SELECT ${PLAYLIST_COLUMNS}
     FROM music_spotify_playlists p JOIN music_spotify_accounts acc ON acc.user_id = p.user_id
     WHERE p.user_id = $1 AND p.spotify_id = $2`,
    [userId, playlistId],
  );
  if (!head.rows[0]) return null;
  const [tracks, daily] = await Promise.all([
    query(
      `SELECT t.position, t.spotify_id, t.title, t.artists, t.album, t.duration_ms, t.added_at, t.is_local, t.song_key,
              COALESCE(st.plays, 0)::int AS plays, st.first_played_at, st.last_played_at, st.album_ref, a.id AS art_id
       FROM music_spotify_playlist_tracks t
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS plays, MIN(m.played_at) AS first_played_at, MAX(m.played_at) AS last_played_at,
                (ARRAY_AGG(${albumRefSql('m.')} ORDER BY m.played_at DESC))[1] AS album_ref
         FROM music_scrobbles m WHERE m.user_id = t.user_id AND m.song_key = t.song_key
       ) st ON true
       LEFT JOIN music_albums a ON a.user_id = t.user_id AND a.album_key = st.album_ref AND a.thumb_file IS NOT NULL
       WHERE t.user_id = $1 AND t.playlist_id = $2
       ORDER BY t.position`,
      [userId, playlistId],
    ),
    query(
      `SELECT (played_at AT TIME ZONE timezone)::date::text AS date, COUNT(*)::int AS plays
       FROM music_scrobbles
       WHERE user_id = $1
         AND song_key IN (SELECT song_key FROM music_spotify_playlist_tracks WHERE user_id = $1 AND playlist_id = $2)
       GROUP BY 1 ORDER BY 1`,
      [userId, playlistId],
    ),
  ]);
  const row = head.rows[0];
  return {
    ...row,
    url: playlistUrl(row.spotify_id),
    tracks: tracks.rows.map((t) => ({
      ...t,
      url: t.spotify_id ? `https://open.spotify.com/track/${encodeURIComponent(t.spotify_id)}` : null,
    })),
    daily: daily.rows,
  };
}
