/**
 * Music plugin — the song, artist and album pages: plays per local day (the
 * page draws its own weeks, months and years from them, and its streaks and
 * peaks), plays by hour and weekday, and the companions, places and moods a
 * song or artist is tied to.
 *
 * Each query is bounded to one scope: a song (`song_key`), an artist (one of a
 * play's credited artists, as the library's Artists view counts them) or an
 * album (every local key resolved to it). Days and hours are read in the zone
 * each play happened in, like the rest of Profile → Music.
 */

import { query } from '../../../server/src/db';
import { albumRefSql, fullestArtistsSql, latestTitleSql, songKeySql } from './identity';
import { ANCHORS, LIFE_BY, type LifeBy } from './life';
import { getMusicSettings } from './scrobbles';
import { genresOfPlays, getItemGenres, listGenres, type GenreCount, type ItemGenres } from './genres';
import { inGenreSql } from './genreSql';

export type Scope =
  | { kind: 'song'; songKey: string }
  | { kind: 'artist'; name: string }
  | { kind: 'album'; refs: string[] }
  | { kind: 'genre'; name: string };

/** The scope as a condition on `alias`'s plays, its value bound to `param` (e.g. "$2"). */
function scopeWhere(scope: Scope, alias: string, param: string): { sql: string; value: unknown } {
  switch (scope.kind) {
    case 'song':
      return { sql: `${songKeySql(alias)} = ${param}`, value: scope.songKey };
    case 'artist':
      return { sql: `${param}::text = ANY(${alias}artists)`, value: scope.name };
    case 'album':
      return { sql: `${albumRefSql(alias)} = ANY(${param}::text[])`, value: scope.refs };
    case 'genre':
      return { sql: inGenreSql(alias, param), value: scope.name };
  }
}

const SECONDS = `COALESCE(listened_for, track_length, 0)`;
const LOCAL_DAY = `(played_at AT TIME ZONE timezone)::date`;

export interface DayCount {
  date: string;
  plays: number;
}

/** Plays per local day, days without plays omitted, oldest first. */
export async function getScopedDaily(userId: string, scope: Scope): Promise<DayCount[]> {
  const w = scopeWhere(scope, '', '$2');
  const r = await query(
    `SELECT ${LOCAL_DAY}::text AS date, COUNT(*)::int AS plays
     FROM music_scrobbles WHERE user_id = $1 AND ${w.sql}
     GROUP BY 1 ORDER BY 1`,
    [userId, w.value],
  );
  return r.rows;
}

/** Plays and time per local day of week (0 = Sunday) and hour; cells without plays omitted. */
export async function getScopedClock(userId: string, scope: Scope) {
  const w = scopeWhere(scope, '', '$2');
  const r = await query(
    `SELECT extract(dow FROM played_at AT TIME ZONE timezone)::int AS dow,
            extract(hour FROM played_at AT TIME ZONE timezone)::int AS hour,
            COUNT(*)::int AS plays, COALESCE(SUM(${SECONDS}), 0)::int AS seconds
     FROM music_scrobbles WHERE user_id = $1 AND ${w.sql}
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [userId, w.value],
  );
  return r.rows as { dow: number; hour: number; plays: number; seconds: number }[];
}

export interface Tie {
  key: string;
  label: string;
  /** Plays in scope around the group's check-ins (each counted once). */
  plays: number;
  /** The group's check-ins with at least one of those plays around them. */
  checkins: number;
}

export type Ties = Record<LifeBy, Tie[]> & { gap_minutes: number };

/** Groups returned per kind, most plays first. */
const MAX_TIES = 6;

/**
 * The companions, place categories and moods whose check-ins the scope's
 * plays fall around: within the listening-session gap either side, the same
 * rule as "Soundtrack of your life", over the whole history.
 */
export async function getScopedTies(userId: string, scope: Scope): Promise<Ties> {
  const { session_gap_minutes: gap } = await getMusicSettings(userId);
  const w = scopeWhere(scope, 'm.', '$5');
  const kinds = await Promise.all(
    LIFE_BY.map(async (by): Promise<Tie[]> => {
      const anchors = await ANCHORS[by](userId, null, null);
      if (anchors.length === 0) return [];
      const labels = new Map(anchors.map((a) => [a.key, a.label]));
      // $1 user, $2 anchor moments, $3 anchor groups, $4 gap minutes, $5 scope.
      const r = await query(
        `WITH anc AS (SELECT ord, t, grp FROM unnest($2::timestamptz[], $3::text[]) WITH ORDINALITY AS a(t, grp, ord))
         SELECT a.grp, COUNT(DISTINCT m.id)::int AS plays, COUNT(DISTINCT a.ord)::int AS checkins
         FROM anc a
         JOIN music_scrobbles m
           ON m.user_id = $1
          AND m.played_at BETWEEN a.t - make_interval(mins => $4::int) AND a.t + make_interval(mins => $4::int)
         WHERE ${w.sql}
         GROUP BY a.grp
         ORDER BY plays DESC, checkins DESC, a.grp
         LIMIT ${MAX_TIES}`,
        [userId, anchors.map((a) => a.t), anchors.map((a) => a.key), gap, w.value],
      );
      return r.rows.map((row: { grp: string; plays: number; checkins: number }) => ({
        key: row.grp,
        label: labels.get(row.grp) ?? row.grp,
        plays: row.plays,
        checkins: row.checkins,
      }));
    }),
  );
  return { gap_minutes: gap, companion: kinds[0], place: kinds[1], mood: kinds[2] };
}

// ---- Song --------------------------------------------------------------

export interface SongDetail {
  name: string;
  artists: string[];
  album_ref: string | null;
  art_id: string | null;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  /** Place among every song played, by plays (1 = most played); ties share a place. */
  rank: number;
  songs_total: number;
  daily: DayCount[];
  clock: Awaited<ReturnType<typeof getScopedClock>>;
  /** The albums its plays were credited to, most plays first. */
  albums: { album_ref: string; album: string | null; art_id: string | null; plays: number }[];
  /** The genres of its plays, most plays first. */
  genres: GenreCount[];
}

/** Everything the song page shows above its plays; null for a song never played. */
export async function getSongDetail(userId: string, songKey: string): Promise<SongDetail | null> {
  const head = await query(
    `SELECT ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists,
            MODE() WITHIN GROUP (ORDER BY ${albumRefSql()}) AS album_ref,
            COUNT(*)::int AS plays, COALESCE(SUM(${SECONDS}), 0)::int AS listened_seconds,
            MIN(played_at) AS first_played_at, MAX(played_at) AS last_played_at
     FROM music_scrobbles
     WHERE user_id = $1 AND ${songKeySql()} = $2
     HAVING COUNT(*) > 0`,
    [userId, songKey],
  );
  const row = head.rows[0];
  if (!row) return null;
  const scope: Scope = { kind: 'song', songKey };
  const [art, rank, daily, clock, albums, genres] = await Promise.all([
    query(`SELECT id FROM music_albums WHERE user_id = $1 AND album_key = $2 AND thumb_file IS NOT NULL`, [userId, row.album_ref]),
    query(
      `SELECT COUNT(*) FILTER (WHERE n > $2)::int + 1 AS rank, COUNT(*)::int AS total
       FROM (SELECT COUNT(*) AS n FROM music_scrobbles WHERE user_id = $1 GROUP BY ${songKeySql()}) s`,
      [userId, row.plays],
    ),
    getScopedDaily(userId, scope),
    getScopedClock(userId, scope),
    query(
      `SELECT g.album_ref, g.album, g.plays, a.id AS art_id
       FROM (
         SELECT ${albumRefSql()} AS album_ref, (ARRAY_AGG(album ORDER BY played_at DESC))[1] AS album, COUNT(*)::int AS plays
         FROM music_scrobbles WHERE user_id = $1 AND ${songKeySql()} = $2
         GROUP BY 1
       ) g
       LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
       ORDER BY g.plays DESC, g.album`,
      [userId, songKey],
    ),
    genresOfPlays(userId, `${songKeySql('m.')} = $2`, [songKey]),
  ]);
  return {
    ...row,
    art_id: art.rows[0]?.id ?? null,
    rank: rank.rows[0].rank,
    songs_total: rank.rows[0].total,
    daily,
    clock,
    albums: albums.rows,
    genres,
  };
}

// ---- Artist ------------------------------------------------------------

export interface ArtistSong {
  song_key: string;
  name: string;
  artists: string[];
  album_ref: string | null;
  art_id: string | null;
  plays: number;
  last_played_at: string;
}

export interface ArtistAlbum {
  album_ref: string;
  name: string;
  art_id: string | null;
  plays: number;
  unique_tracks: number;
  last_played_at: string;
}

export interface ArtistDetail {
  name: string;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  unique_songs: number;
  /** Place among every artist played, by plays (1 = most played). */
  rank: number;
  artists_total: number;
  daily: DayCount[];
  clock: Awaited<ReturnType<typeof getScopedClock>>;
  songs: ArtistSong[];
  albums: ArtistAlbum[];
  /** The artist's own genres (which their plays fall back to when an album has none). */
  genres: ItemGenres;
  /** The genres their plays have, most plays first. */
  play_genres: GenreCount[];
}

/** Songs returned on the artist page, most played first. */
const ARTIST_SONGS = 500;

/**
 * An artist as the library's Artists view counts them: every play crediting
 * them (exact name), features included. Null for an artist never played.
 */
export async function getArtistDetail(userId: string, name: string): Promise<ArtistDetail | null> {
  const head = await query(
    `SELECT COUNT(*)::int AS plays, COALESCE(SUM(${SECONDS}), 0)::int AS listened_seconds,
            MIN(played_at) AS first_played_at, MAX(played_at) AS last_played_at,
            COUNT(DISTINCT ${songKeySql()})::int AS unique_songs
     FROM music_scrobbles
     WHERE user_id = $1 AND $2::text = ANY(artists)
     HAVING COUNT(*) > 0`,
    [userId, name],
  );
  const row = head.rows[0];
  if (!row) return null;
  const scope: Scope = { kind: 'artist', name };
  const [rank, daily, clock, songs, albums, genres, playGenres] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE n > $2)::int + 1 AS rank, COUNT(*)::int AS total
       FROM (SELECT COUNT(*) AS n FROM music_scrobbles m, unnest(m.artists) AS a(artist) WHERE m.user_id = $1 GROUP BY a.artist) s`,
      [userId, row.plays],
    ),
    getScopedDaily(userId, scope),
    getScopedClock(userId, scope),
    query(
      `SELECT g.*, a.id AS art_id
       FROM (
         SELECT ${songKeySql()} AS song_key, ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists,
                MODE() WITHIN GROUP (ORDER BY ${albumRefSql()}) AS album_ref,
                COUNT(*)::int AS plays, MAX(played_at) AS last_played_at
         FROM music_scrobbles WHERE user_id = $1 AND $2::text = ANY(artists)
         GROUP BY ${songKeySql()}
       ) g
       LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
       ORDER BY g.plays DESC, g.last_played_at DESC
       LIMIT ${ARTIST_SONGS}`,
      [userId, name],
    ),
    query(
      `SELECT g.*, a.id AS art_id
       FROM (
         SELECT album_key AS album_ref, (ARRAY_AGG(album ORDER BY played_at DESC))[1] AS name,
                COUNT(*)::int AS plays, COUNT(DISTINCT ${songKeySql()})::int AS unique_tracks, MAX(played_at) AS last_played_at
         FROM music_scrobbles WHERE user_id = $1 AND $2::text = ANY(artists) AND album_key IS NOT NULL
         GROUP BY album_key
       ) g
       LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
       ORDER BY g.plays DESC, g.last_played_at DESC`,
      [userId, name],
    ),
    getItemGenres(userId, 'artist', name),
    genresOfPlays(userId, '$2::text = ANY(m.artists)', [name]),
  ]);
  return {
    name,
    ...row,
    rank: rank.rows[0].rank,
    artists_total: rank.rows[0].total,
    daily,
    clock,
    songs: songs.rows,
    albums: albums.rows,
    genres,
    play_genres: playGenres,
  };
}

// ---- Album -------------------------------------------------------------

/** Other albums shown on an album page. */
const OTHER_ALBUMS = 24;

/**
 * Albums by `artist` (their first album artist, as album keys are built)
 * other than `refs`, most played first.
 */
export async function getOtherAlbums(userId: string, artist: string, refs: string[]): Promise<ArtistAlbum[]> {
  if (!artist.trim()) return [];
  const r = await query(
    `SELECT g.*, a.id AS art_id
     FROM (
       SELECT album_key AS album_ref, (ARRAY_AGG(album ORDER BY played_at DESC))[1] AS name,
              COUNT(*)::int AS plays, COUNT(DISTINCT ${songKeySql()})::int AS unique_tracks, MAX(played_at) AS last_played_at
       FROM music_scrobbles
       WHERE user_id = $1 AND album_key IS NOT NULL AND NOT (album_key = ANY($3::text[]))
         AND lower(btrim(COALESCE(album_artists[1], artists[1], ''))) = lower(btrim($2))
       GROUP BY album_key
     ) g
     LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
     ORDER BY g.plays DESC, g.last_played_at DESC
     LIMIT ${OTHER_ALBUMS}`,
    [userId, artist, refs],
  );
  return r.rows;
}

// ---- Genre -------------------------------------------------------------

export interface GenreDetail {
  name: string;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  unique_songs: number;
  unique_artists: number;
  /** Place among every genre played, by plays (1 = most played). */
  rank: number;
  genres_total: number;
  daily: DayCount[];
  clock: Awaited<ReturnType<typeof getScopedClock>>;
  artists: { name: string; plays: number }[];
  songs: ArtistSong[];
  albums: ArtistAlbum[];
  /** Other genres on the same plays, most shared plays first. */
  related: GenreCount[];
}

const GENRE_ARTISTS = 30;
const GENRE_SONGS = 200;
const GENRE_ALBUMS = 24;
const RELATED_GENRES = 12;

/**
 * A genre's page: every play that has it (see genreSql.ts for which genres a
 * play has). Null for a genre no play has.
 */
export async function getGenreDetail(userId: string, name: string): Promise<GenreDetail | null> {
  const w = scopeWhere({ kind: 'genre', name }, '', '$2');
  const head = await query(
    `SELECT COUNT(*)::int AS plays, COALESCE(SUM(${SECONDS}), 0)::int AS listened_seconds,
            MIN(played_at) AS first_played_at, MAX(played_at) AS last_played_at,
            COUNT(DISTINCT ${songKeySql()})::int AS unique_songs
     FROM music_scrobbles
     WHERE user_id = $1 AND ${w.sql}
     HAVING COUNT(*) > 0`,
    [userId, name],
  );
  const row = head.rows[0];
  if (!row) return null;
  const scope: Scope = { kind: 'genre', name };
  const wm = scopeWhere(scope, 'm.', '$2');
  const [all, daily, clock, artists, songs, albums, together] = await Promise.all([
    listGenres(userId),
    getScopedDaily(userId, scope),
    getScopedClock(userId, scope),
    query(
      `SELECT a.artist AS name, COUNT(*)::int AS plays
       FROM music_scrobbles m, unnest(m.artists) AS a(artist)
       WHERE m.user_id = $1 AND ${wm.sql}
       GROUP BY a.artist ORDER BY plays DESC, a.artist`,
      [userId, name],
    ),
    query(
      `SELECT g.*, a.id AS art_id
       FROM (
         SELECT ${songKeySql()} AS song_key, ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists,
                MODE() WITHIN GROUP (ORDER BY ${albumRefSql()}) AS album_ref,
                COUNT(*)::int AS plays, MAX(played_at) AS last_played_at
         FROM music_scrobbles WHERE user_id = $1 AND ${w.sql}
         GROUP BY ${songKeySql()}
       ) g
       LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
       ORDER BY g.plays DESC, g.last_played_at DESC
       LIMIT ${GENRE_SONGS}`,
      [userId, name],
    ),
    query(
      `SELECT g.*, a.id AS art_id
       FROM (
         SELECT album_key AS album_ref, (ARRAY_AGG(album ORDER BY played_at DESC))[1] AS name,
                COUNT(*)::int AS plays, COUNT(DISTINCT ${songKeySql()})::int AS unique_tracks, MAX(played_at) AS last_played_at
         FROM music_scrobbles WHERE user_id = $1 AND ${w.sql} AND album_key IS NOT NULL
         GROUP BY album_key
       ) g
       LEFT JOIN music_albums a ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
       ORDER BY g.plays DESC, g.last_played_at DESC
       LIMIT ${GENRE_ALBUMS}`,
      [userId, name],
    ),
    genresOfPlays(userId, wm.sql, [name]),
  ]);
  return {
    name,
    ...row,
    unique_artists: artists.rows.length,
    rank: all.filter((g) => g.plays > row.plays).length + 1,
    genres_total: all.length,
    daily,
    clock,
    artists: artists.rows.slice(0, GENRE_ARTISTS),
    songs: songs.rows,
    albums: albums.rows,
    related: together.filter((g) => g.name !== name).slice(0, RELATED_GENRES),
  };
}
