/**
 * Music plugin — finding and removing plays that can't have happened.
 *
 * Some Last.fm histories contain bursts of one song scrobbled dozens of times
 * seconds apart. The unique index only stops plays at the exact same second,
 * so imports keep them all.
 *
 * A play is impossible when it starts too soon after the previous play of the
 * same song to be a second listen. Last.fm (and scrobblers that follow its
 * rule) count a play once half the song, or four minutes, has been heard, so a
 * genuine repeat is at least that far from the one before. Without a known
 * length only plays under 30 seconds apart are flagged (Last.fm doesn't count
 * anything shorter).
 *
 * Plays chained by impossible gaps form one burst, which keeps one play. Hand
 * entries and plays carrying a note, a place or companions are never removed.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../server/src/db';
import { deleteCompanionsForCheckins } from '../../../server/src/services/companions';
import { PLUGIN_ID } from './constants';
import { getMusicSettings, rebuildSessionsInTransaction } from './scrobbles';

/** Seconds below which a repeat is impossible whatever the song's length. */
export const UNKNOWN_LENGTH_GAP_SECONDS = 30;
/** Last.fm counts a play after half the song, or this many seconds. */
export const MAX_REQUIRED_SECONDS = 240;

export interface DuplicatePlay {
  id: string;
  played_at: string;
  /** As stored on this play (a burst can mix spellings of one song). */
  title: string;
  artists: string[];
  album_artists: string[];
  timezone: string | null;
  source: string | null;
  album: string | null;
  track_length: number | null;
  listened_for: number | null;
  /** A hand entry, or a play with a note, place or companions: never removed. */
  protected: boolean;
}

export interface DuplicateBurst {
  /** The kept play's id, which identifies the burst. */
  id: string;
  song_key: string;
  title: string;
  artists: string[];
  /** Seconds; null when the song's length is unknown. */
  length: number | null;
  /** Gaps shorter than this (seconds) chained the burst. */
  threshold: number;
  keep: DuplicatePlay[];
  remove: DuplicatePlay[];
}

export interface DuplicateScan {
  bursts: DuplicateBurst[];
  /** Plays that would be removed across every burst. */
  removable: number;
}

/** The full stored play, as handed back for the "removed plays" download. */
export interface RemovedPlay {
  id: string;
  played_at: string;
  title: string;
  artists: string[];
  album: string | null;
  album_artists: string[];
  track_length: number | null;
  listened_for: number | null;
  source: string | null;
  timezone: string | null;
}

type Queryable = Pick<PoolClient, 'query'>;

interface Row extends DuplicatePlay {
  song_key: string;
  song_length: number | string | null;
  threshold: number | string;
  burst: string;
}

/**
 * Every burst of the user's plays chained by impossible gaps, in song order.
 * Only plays that belong to a burst of two or more come back.
 */
async function loadBursts(db: Queryable, userId: string): Promise<Row[]> {
  const result = await db.query(
    `WITH lengths AS (
       SELECT song_key, percentile_cont(0.5) WITHIN GROUP (ORDER BY track_length) AS len
       FROM music_scrobbles WHERE user_id = $1 AND track_length > 0
       GROUP BY song_key
     ),
     plays AS (
       SELECT s.id, s.song_key, s.played_at, s.title, s.artists, s.album, s.album_artists, s.source, s.timezone,
              s.track_length, s.listened_for,
              (s.source = 'manual' OR s.note IS NOT NULL OR s.latitude IS NOT NULL
                OR EXISTS (SELECT 1 FROM companions c WHERE c.checkin_type = $2 AND c.checkin_id = s.id)) AS protected,
              COALESCE(NULLIF(s.track_length, 0), l.len) AS len,
              s.played_at - LAG(s.played_at) OVER (PARTITION BY s.song_key ORDER BY s.played_at, s.id) AS gap
       FROM music_scrobbles s LEFT JOIN lengths l USING (song_key)
       WHERE s.user_id = $1
     ),
     marked AS (
       SELECT *,
              CASE WHEN len IS NULL THEN $3::numeric ELSE LEAST(len / 2.0, $4::numeric) END AS threshold,
              CASE WHEN gap IS NOT NULL
                        AND gap < make_interval(secs => CASE WHEN len IS NULL THEN $3::numeric ELSE LEAST(len / 2.0, $4::numeric) END)
                   THEN 0 ELSE 1 END AS starts
       FROM plays
     ),
     grouped AS (
       SELECT *, song_key || '#' || SUM(starts) OVER (PARTITION BY song_key ORDER BY played_at, id) AS burst
       FROM marked
     ),
     sized AS (
       SELECT *, COUNT(*) OVER (PARTITION BY burst) AS size FROM grouped
     )
     SELECT id, song_key, played_at, title, artists, album, album_artists, source, timezone, track_length, listened_for,
            protected, len AS song_length, threshold, burst
     FROM sized WHERE size > 1
     ORDER BY played_at, id`,
    [userId, PLUGIN_ID, UNKNOWN_LENGTH_GAP_SECONDS, MAX_REQUIRED_SECONDS],
  );
  return result.rows;
}

/**
 * Which plays of a burst stay: every protected one, or else the best single
 * play (a live scrobble, which knows how long was listened, over an import),
 * the earliest on a tie.
 */
export function splitBurst<T extends Pick<DuplicatePlay, 'protected' | 'source' | 'listened_for' | 'played_at' | 'id'>>(
  plays: T[],
): { keep: T[]; remove: T[] } {
  const guarded = plays.filter((p) => p.protected);
  if (guarded.length > 0) return { keep: guarded, remove: plays.filter((p) => !p.protected) };
  const score = (p: T) => (p.source === 'multi-scrobbler' ? 2 : 0) + (p.listened_for != null ? 1 : 0);
  const best = [...plays].sort(
    (a, b) =>
      score(b) - score(a) ||
      new Date(a.played_at).getTime() - new Date(b.played_at).getTime() ||
      a.id.localeCompare(b.id),
  )[0];
  return { keep: [best], remove: plays.filter((p) => p !== best) };
}

function toPlay(r: Row): DuplicatePlay {
  return {
    id: r.id,
    played_at: new Date(r.played_at).toISOString(),
    title: r.title,
    artists: r.artists,
    album_artists: r.album_artists,
    timezone: r.timezone,
    source: r.source,
    album: r.album,
    track_length: r.track_length,
    listened_for: r.listened_for,
    protected: r.protected,
  };
}

async function scan(db: Queryable, userId: string): Promise<DuplicateScan> {
  const rows = await loadBursts(db, userId);
  const byBurst = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byBurst.get(r.burst);
    if (list) list.push(r);
    else byBurst.set(r.burst, [r]);
  }
  const bursts: DuplicateBurst[] = [];
  for (const plays of byBurst.values()) {
    const { keep, remove } = splitBurst(plays);
    if (remove.length === 0) continue;
    const first = keep[0];
    const len = first.song_length == null ? null : Math.round(Number(first.song_length));
    bursts.push({
      id: first.id,
      song_key: first.song_key,
      title: first.title,
      artists: first.artists,
      length: len,
      threshold: Math.round(Number(first.threshold)),
      keep: keep.map(toPlay),
      remove: remove.map(toPlay),
    });
  }
  // Biggest bursts first: they're the clearest cases.
  bursts.sort((a, b) => b.remove.length - a.remove.length || a.keep[0].played_at.localeCompare(b.keep[0].played_at));
  return { bursts, removable: bursts.reduce((n, b) => n + b.remove.length, 0) };
}

/** The dry run: what would be removed, changing nothing. */
export async function findDuplicatePlays(userId: string): Promise<DuplicateScan> {
  const client = await pool.connect();
  try {
    return await scan(client, userId);
  } finally {
    client.release();
  }
}

/**
 * Remove the given plays, but only those a fresh scan still flags (so a stale
 * preview, or a hand-picked id, can't delete a real play). Returns the removed
 * plays in full, for the download that can restore them.
 */
export async function removeDuplicatePlays(userId: string, ids: string[]): Promise<RemovedPlay[]> {
  const settings = await getMusicSettings(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    const wanted = new Set(ids);
    const flagged = (await scan(client, userId)).bursts.flatMap((b) => b.remove.map((p) => p.id)).filter((id) => wanted.has(id));
    if (flagged.length === 0) {
      await client.query('COMMIT');
      return [];
    }
    const gone = await client.query(
      `DELETE FROM music_scrobbles WHERE user_id = $1 AND id = ANY($2::uuid[])
       RETURNING id, played_at, title, artists, album, album_artists, track_length, listened_for, source, timezone`,
      [userId, flagged],
    );
    // Flagged plays carry no companions, but never leave any behind.
    await deleteCompanionsForCheckins(PLUGIN_ID, flagged, client);
    await rebuildSessionsInTransaction(client, userId, settings.session_gap_minutes);
    await client.query('COMMIT');
    return gone.rows
      .map((r: RemovedPlay & { played_at: Date | string }) => ({ ...r, played_at: new Date(r.played_at).toISOString() }))
      .sort((a: RemovedPlay, b: RemovedPlay) => a.played_at.localeCompare(b.played_at));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
