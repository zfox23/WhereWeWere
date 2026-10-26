/**
 * Music plugin — scrobble storage, listening-session maintenance, and the
 * read queries behind the Profile tab.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { isValidTimeZone } from 'wwp-shared';
import { query, pool } from '../../../server/src/db';
import { allPlugins } from '../../../server/src/plugins/registry';
import { resolveTimezones, loadTimezoneAnchors, timezoneAt } from './timezones';
import { lookupAlbumSoon } from './albums';
import { albumRefSql, fullestArtistsSql, latestTitleSql, songKeySql } from './identity';
import { likeText, orderBy } from '../../../server/src/services/libraryQuery';
import { companionNamesSql, deleteCompanionsForCheckins, setCompanions } from '../../../server/src/services/companions';
import { DEFAULT_MIN_SESSION_TRACKS, DEFAULT_SESSION_GAP_MINUTES, PLUGIN_ID } from './constants';


export interface ScrobbleInput {
  playedAt: Date;
  title: string;
  artists: string[];
  album?: string | null;
  albumArtists?: string[];
  trackLength?: number | null;
  listenedFor?: number | null;
  source?: string | null;
  /** IANA zone the play happened in; assigned from check-ins when absent. */
  timezone?: string | null;
  /** Hand-entered plays only. */
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Meters. */
  locationAccuracy?: number | null;
  /** Keep this id (a restore, so companions stay attached); generated when absent. */
  id?: string | null;
}

export interface MusicSettings {
  scrobbler_key: string;
  session_gap_minutes: number;
  min_session_tracks: number;
  timezone: string;
}

type Queryable = Pick<PoolClient, 'query'> | { query: typeof query };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function settingsFromRows(stored: Map<string, unknown>): MusicSettings {
  const tz = stored.get('timezone');
  return {
    scrobbler_key: typeof stored.get('scrobbler_key') === 'string' ? (stored.get('scrobbler_key') as string) : '',
    session_gap_minutes: positiveInt(stored.get('session_gap_minutes'), DEFAULT_SESSION_GAP_MINUTES),
    min_session_tracks: positiveInt(stored.get('min_session_tracks'), DEFAULT_MIN_SESSION_TRACKS),
    timezone: typeof tz === 'string' && isValidTimeZone(tz) ? tz : 'UTC',
  };
}

/**
 * Stored settings with defaults applied, read through `db` (so a caller
 * inside a transaction sees its own uncommitted writes). Never writes: the
 * scrobbler key is empty until `getMusicSettings` has generated one.
 */
async function readMusicSettings(userId: string, db: Queryable = { query }): Promise<MusicSettings & { timezoneStored: boolean }> {
  const result = await db.query(
    `SELECT key, value FROM plugin_settings WHERE user_id = $1 AND plugin_id = $2`,
    [userId, PLUGIN_ID],
  );
  const stored = new Map<string, unknown>(result.rows.map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return { ...settingsFromRows(stored), timezoneStored: typeof stored.get('timezone') === 'string' };
}

/**
 * The timezone of the user's most recent check-in, asked of every plugin that
 * can answer (the same hook the Plex and Sleep integrations use). Null when
 * no check-in carries one.
 */
async function inferTimezone(userId: string): Promise<string | null> {
  for (const plugin of allPlugins()) {
    const hook = plugin.server.latestTimezoneAsOf;
    if (!hook) continue;
    const result = await query(hook().sql, [new Date().toISOString(), userId]);
    const tz = result.rows[0]?.timezone;
    if (typeof tz === 'string' && tz !== 'UTC' && isValidTimeZone(tz)) return tz;
  }
  return null;
}

/**
 * Effective music settings. First use generates the scrobbler key and, when
 * no timezone has been chosen, adopts the timezone of the user's latest
 * check-in (sessions and periods are bucketed by it, and UTC would put
 * evening listening on the wrong day). Nothing is stored until a check-in
 * timezone exists, so it is retried until then.
 */
export async function getMusicSettings(userId: string): Promise<MusicSettings> {
  let current = await readMusicSettings(userId);
  if (!current.scrobbler_key) {
    await query(
      `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
       VALUES ($1, $2, 'scrobbler_key', $3::jsonb)
       ON CONFLICT (user_id, plugin_id, key) DO NOTHING`,
      [userId, PLUGIN_ID, JSON.stringify(crypto.randomBytes(24).toString('hex'))],
    );
    current = await readMusicSettings(userId);
  }
  if (!current.timezoneStored) {
    const inferred = await inferTimezone(userId);
    if (inferred) {
      await query(
        `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
         VALUES ($1, $2, 'timezone', $3::jsonb)
         ON CONFLICT (user_id, plugin_id, key) DO NOTHING`,
        [userId, PLUGIN_ID, JSON.stringify(inferred)],
      );
      current = await readMusicSettings(userId);
      // Plays already stored took the UTC default as their fallback zone.
      const existing = await query('SELECT 1 FROM music_scrobbles WHERE user_id = $1 LIMIT 1', [userId]);
      if ((existing.rowCount ?? 0) > 0) await recomputeTimezones(userId);
    }
  }
  const { timezoneStored: _stored, ...settings } = current;
  return settings;
}

export async function regenerateScrobblerKey(userId: string): Promise<string> {
  const key = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
     VALUES ($1, $2, 'scrobbler_key', $3::jsonb)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, PLUGIN_ID, JSON.stringify(key)],
  );
  return key;
}

/**
 * Persist settings changes. A new gap regroups sessions; a new fallback
 * timezone re-assigns zones (and so regroups too).
 */
export async function updateMusicSettings(
  userId: string,
  updates: Partial<Pick<MusicSettings, 'session_gap_minutes' | 'min_session_tracks' | 'timezone'>>,
): Promise<MusicSettings> {
  const before = await getMusicSettings(userId);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    await query(
      `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, PLUGIN_ID, key, JSON.stringify(value)],
    );
  }
  const after = await getMusicSettings(userId);
  if (after.timezone !== before.timezone) {
    await recomputeTimezones(userId);
  } else if (after.session_gap_minutes !== before.session_gap_minutes) {
    await rebuildAllSessions(userId);
  }
  return after;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Regroup the user's scrobbles into sessions. With no range every session is
 * rebuilt; with a range the caller must already have widened it to whole
 * session boundaries (see `insertScrobble`).
 */
async function rebuildSessions(
  db: Queryable,
  userId: string,
  gapMinutes: number,
  range: { from: Date; to: Date } | null,
): Promise<void> {
  if (range) {
    await db.query(
      `DELETE FROM music_sessions WHERE user_id = $1 AND started_at >= $2 AND ended_at <= $3`,
      [userId, range.from, range.to],
    );
  } else {
    await db.query(`DELETE FROM music_sessions WHERE user_id = $1`, [userId]);
  }
  // Stage the grouping in a temp table so the planner has real row counts
  // for the joins below: as CTEs it picked nested loops that never finished
  // on a six-figure history. A session takes the id of its first scrobble.
  await db.query(`DROP TABLE IF EXISTS music_grp`);
  await db.query(
    `CREATE TEMP TABLE music_grp ON COMMIT DROP AS
     WITH ordered AS (
       SELECT id, played_at, title, artists, listened_for, track_length, source, timezone,
              CASE WHEN played_at - LAG(played_at) OVER (ORDER BY played_at, id)
                        > make_interval(mins => $2::int) THEN 1 ELSE 0 END AS brk
       FROM music_scrobbles
       WHERE user_id = $1
         AND ($3::timestamptz IS NULL OR played_at >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR played_at <= $4::timestamptz)
     ),
     grp AS (
       SELECT *, SUM(brk) OVER (ORDER BY played_at, id) AS g FROM ordered
     )
     SELECT id, played_at, title, artists, listened_for, track_length, source, g,
            FIRST_VALUE(id) OVER (PARTITION BY g ORDER BY played_at, id) AS sid,
            FIRST_VALUE(timezone) OVER (PARTITION BY g ORDER BY played_at, id) AS stz
     FROM grp`,
    [userId, gapMinutes, range?.from ?? null, range?.to ?? null],
  );
  await db.query(`ANALYZE music_grp`);
  await db.query(
    `WITH top AS (
       SELECT sid, a.artist,
              ROW_NUMBER() OVER (PARTITION BY sid ORDER BY COUNT(*) DESC, a.artist) AS rn
       FROM music_grp, LATERAL unnest(music_grp.artists) AS a(artist)
       GROUP BY sid, a.artist
     ),
     top_agg AS (
       SELECT sid, jsonb_agg(artist ORDER BY rn) AS top_artists
       FROM top WHERE rn <= 5
       GROUP BY sid
     ),
     base AS (
       SELECT sid,
              MIN(stz) AS stz,
              MIN(played_at) AS started_at,
              MAX(played_at) AS ended_at,
              COUNT(*)::int AS track_count,
              COALESCE(SUM(COALESCE(listened_for, track_length)), 0)::int AS listened_seconds,
              COALESCE(BOOL_OR(source = 'manual'), FALSE) AS has_manual,
              string_agg(DISTINCT title || ' ' || array_to_string(artists, ' '), ' ') AS search_text
       FROM music_grp
       GROUP BY sid
     )
     INSERT INTO music_sessions
       (id, user_id, started_at, ended_at, timezone, track_count, listened_seconds, top_artists, search_text, has_manual)
     SELECT b.sid, $1, b.started_at, b.ended_at, b.stz, b.track_count, b.listened_seconds,
            COALESCE(t.top_artists, '[]'::jsonb), b.search_text, b.has_manual
     FROM base b LEFT JOIN top_agg t ON t.sid = b.sid`,
    [userId],
  );
  await db.query(
    `UPDATE music_scrobbles m SET session_id = g.sid FROM music_grp g WHERE m.id = g.id`,
  );
  await db.query(`DROP TABLE music_grp`);
}

export async function rebuildAllSessions(userId: string): Promise<void> {
  const settings = await getMusicSettings(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    await rebuildSessions(client, userId, settings.session_gap_minutes, null);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function validZone(zone: string | null | undefined): string | null {
  return typeof zone === 'string' && zone && isValidTimeZone(zone) ? zone : null;
}

const ZONE_UPDATE_BATCH = 5000;

/**
 * Re-assign every scrobble's timezone from the user's current check-ins (and
 * the fallback setting), then regroup sessions. Use after adding or fixing
 * check-ins, or changing the fallback zone. Returns how many plays changed.
 */
export async function recomputeTimezones(userId: string): Promise<number> {
  const settings = await getMusicSettings(userId);
  const anchors = await loadTimezoneAnchors(userId);
  const client = await pool.connect();
  let changed = 0;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    const plays = await client.query(
      `SELECT id, played_at FROM music_scrobbles WHERE user_id = $1`,
      [userId],
    );
    const rows = plays.rows as { id: string; played_at: Date }[];
    for (let i = 0; i < rows.length; i += ZONE_UPDATE_BATCH) {
      const slice = rows.slice(i, i + ZONE_UPDATE_BATCH);
      const result = await client.query(
        `UPDATE music_scrobbles m SET timezone = v.tz
         FROM unnest($1::uuid[], $2::text[]) AS v(id, tz)
         WHERE m.id = v.id AND m.timezone IS DISTINCT FROM v.tz`,
        [
          slice.map((r) => r.id),
          slice.map((r) => timezoneAt(anchors, new Date(r.played_at).getTime(), settings.timezone)),
        ],
      );
      changed += result.rowCount ?? 0;
    }
    await rebuildSessions(client, userId, settings.session_gap_minutes, null);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return changed;
}

/**
 * Rebuild the sessions touching `at` (within one gap either side), whole, so a
 * play added, moved or removed there regroups correctly.
 */
async function rebuildAround(db: Queryable, userId: string, gapMinutes: number, at: Date): Promise<void> {
  const near = await db.query(
    `SELECT MIN(started_at) AS from_at, MAX(ended_at) AS to_at
     FROM music_sessions
     WHERE user_id = $1
       AND ended_at >= $2::timestamptz - make_interval(mins => $3::int)
       AND started_at <= $2::timestamptz + make_interval(mins => $3::int)`,
    [userId, at, gapMinutes],
  );
  const row = near.rows[0] ?? {};
  const from = row.from_at && new Date(row.from_at) < at ? new Date(row.from_at) : at;
  const to = row.to_at && new Date(row.to_at) > at ? new Date(row.to_at) : at;
  await rebuildSessions(db, userId, gapMinutes, { from, to });
}

/** A play of the same song close to this one, from any source. */
export interface NearDuplicate {
  id: string;
  played_at: string;
  title: string;
  artists: string[];
  source: string | null;
}

/** How close in time two plays of one song must be to count as the same listen. */
export const NEAR_DUPLICATE_MINUTES = 6;

async function findNearDuplicate(
  db: Queryable,
  userId: string,
  s: Pick<ScrobbleInput, 'playedAt' | 'title' | 'artists'>,
  onlySource: string | null,
): Promise<NearDuplicate | null> {
  const r = await db.query(
    `SELECT id, played_at, title, artists, source FROM music_scrobbles
     WHERE user_id = $1
       AND played_at BETWEEN $2::timestamptz - make_interval(mins => $3::int) AND $2::timestamptz + make_interval(mins => $3::int)
       AND song_key = music_song_key($4, $5::text[])
       AND ($6::text IS NULL OR source = $6)
     ORDER BY abs(extract(epoch FROM played_at - $2::timestamptz)) LIMIT 1`,
    [userId, s.playedAt, NEAR_DUPLICATE_MINUTES, s.title, s.artists, onlySource],
  );
  return (r.rows[0] as NearDuplicate | undefined) ?? null;
}

export interface InsertOutcome {
  inserted: boolean;
  id: string | null;
  sessionId: string | null;
  /** Set when nothing was stored because a near-identical play exists. */
  duplicate: NearDuplicate | null;
}

/**
 * Insert one scrobble and fold it into the listening sessions. `onlyIfNoNearManual`
 * leaves a scrobbler's play out when the user already wrote down that song by hand
 * around then; `unlessNearDuplicate` (hand entries) stops short and reports any
 * near-identical play instead, so the user can decide.
 */
async function insertOne(
  userId: string,
  s: ScrobbleInput,
  opts: { onlyIfNoNearManual?: boolean; unlessNearDuplicate?: boolean; companions?: string[] } = {},
): Promise<InsertOutcome> {
  const settings = await getMusicSettings(userId);
  const timezone = validZone(s.timezone) ?? (await resolveTimezones(userId, [s.playedAt], settings.timezone))[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    if (opts.onlyIfNoNearManual) {
      const manual = await findNearDuplicate(client, userId, s, 'manual');
      if (manual) {
        await client.query('COMMIT');
        return { inserted: false, id: null, sessionId: null, duplicate: manual };
      }
    }
    if (opts.unlessNearDuplicate) {
      const near = await findNearDuplicate(client, userId, s, null);
      if (near) {
        await client.query('COMMIT');
        return { inserted: false, id: null, sessionId: null, duplicate: near };
      }
    }
    const inserted = await client.query(
      `INSERT INTO music_scrobbles
         (id, user_id, played_at, title, artists, album, album_artists, track_length, listened_for, source, timezone,
          note, latitude, longitude, location_accuracy)
       VALUES (COALESCE($11::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING
       RETURNING id, album_key, session_id`,
      [
        userId, s.playedAt, s.title, s.artists, s.album ?? null, s.albumArtists ?? [],
        s.trackLength ?? null, s.listenedFor ?? null, s.source ?? null, timezone,
        s.id ?? null, s.note ?? null, s.latitude ?? null, s.longitude ?? null, s.locationAccuracy ?? null,
      ],
    );
    let sessionId: string | null = null;
    const id: string | null = inserted.rows[0]?.id ?? null;
    if ((inserted.rowCount ?? 0) > 0) {
      if (opts.companions?.length) await setCompanions(PLUGIN_ID, id as string, opts.companions, client);
      await rebuildAround(client, userId, settings.session_gap_minutes, s.playedAt);
      sessionId = (await client.query(`SELECT session_id FROM music_scrobbles WHERE id = $1`, [id])).rows[0]?.session_id ?? null;
    }
    await client.query('COMMIT');
    if ((inserted.rowCount ?? 0) > 0) lookupAlbumSoon(userId, inserted.rows[0].album_key);
    return { inserted: (inserted.rowCount ?? 0) > 0, id, sessionId, duplicate: null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Insert one scrobbler play. Returns false when it was already stored, or when
 * the user wrote that song down by hand around the same time (the hand entry,
 * with its note, wins).
 */
export async function insertScrobble(userId: string, s: ScrobbleInput): Promise<boolean> {
  return (await insertOne(userId, s, { onlyIfNoNearManual: s.source !== 'manual' })).inserted;
}

/**
 * Record a play by hand. Unless `force`, a near-identical play already on file
 * (a scrobbler got there first, or it was entered twice) is reported back
 * instead of stored.
 */
export function insertManualScrobble(
  userId: string,
  s: ScrobbleInput,
  opts: { force?: boolean; companions?: string[] } = {},
): Promise<InsertOutcome> {
  return insertOne(userId, { ...s, source: 'manual' }, { unlessNearDuplicate: !opts.force, companions: opts.companions });
}

/** Remove a play, whatever its source. False when there is none. */
export async function deleteScrobble(userId: string, id: string): Promise<boolean> {
  const settings = await getMusicSettings(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    const gone = await client.query(`DELETE FROM music_scrobbles WHERE id = $2 AND user_id = $1 RETURNING played_at`, [userId, id]);
    if ((gone.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await deleteCompanionsForCheckins(PLUGIN_ID, [id], client);
    await rebuildAround(client, userId, settings.session_gap_minutes, new Date(gone.rows[0].played_at));
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface ScrobbleEdit {
  playedAt: Date;
  title: string;
  artists: string[];
  album: string | null;
  albumArtists: string[];
  trackLength: number | null;
  timezone: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  companions: string[];
}

/**
 * Change any play. The sessions around where it was and where it now is are
 * regrouped. 'conflict' when another play already has that time and song.
 */
export async function updateScrobble(
  userId: string,
  id: string,
  e: ScrobbleEdit,
): Promise<{ status: 'updated'; sessionId: string | null } | { status: 'not_found' | 'conflict' }> {
  const settings = await getMusicSettings(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
    const old = await client.query(`SELECT played_at, timezone FROM music_scrobbles WHERE id = $2 AND user_id = $1 FOR UPDATE`, [userId, id]);
    if ((old.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const timezone = validZone(e.timezone) ?? old.rows[0].timezone;
    let updated;
    try {
      updated = await client.query(
        `UPDATE music_scrobbles SET played_at = $3, title = $4, artists = $5, album = $6, album_artists = $7,
                track_length = $8, timezone = $9, note = $10, latitude = $11, longitude = $12, location_accuracy = $13
         WHERE id = $2 AND user_id = $1 RETURNING album_key`,
        [userId, id, e.playedAt, e.title, e.artists, e.album, e.albumArtists, e.trackLength, timezone, e.note, e.latitude, e.longitude, e.locationAccuracy],
      );
    } catch (err: any) {
      if (err?.code === '23505') {
        await client.query('ROLLBACK');
        return { status: 'conflict' };
      }
      throw err;
    }
    await setCompanions(PLUGIN_ID, id, e.companions, client);
    const before = new Date(old.rows[0].played_at);
    await rebuildAround(client, userId, settings.session_gap_minutes, before);
    if (before.getTime() !== e.playedAt.getTime()) await rebuildAround(client, userId, settings.session_gap_minutes, e.playedAt);
    const sessionId = (await client.query(`SELECT session_id FROM music_scrobbles WHERE id = $1`, [id])).rows[0]?.session_id ?? null;
    await client.query('COMMIT');
    lookupAlbumSoon(userId, updated.rows[0].album_key);
    return { status: 'updated', sessionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface ScrobbleDetail {
  id: string;
  played_at: string;
  timezone: string;
  title: string;
  artists: string[];
  album: string | null;
  album_artists: string[];
  track_length: number | null;
  listened_for: number | null;
  source: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  companions: string[];
  art_id: string | null;
  album_ref: string;
  song_key: string;
  /** Your plays of this song, all time. */
  history: { plays: number; first_played_at: string; last_played_at: string };
  /** Its listening session, or null while one is being rebuilt. */
  session: {
    id: string;
    /** Local date the session is grouped under on the timeline. */
    date: string;
    position: number;
    count: number;
    previous: SessionNeighbour | null;
    next: SessionNeighbour | null;
  } | null;
}

export interface SessionNeighbour {
  id: string;
  title: string;
  artists: string[];
  played_at: string;
}

/** Everything the play's own page shows, or null when there is no such play. */
export async function getScrobbleDetail(userId: string, id: string): Promise<ScrobbleDetail | null> {
  const r = await query(
    `SELECT m.id, m.played_at, m.timezone, m.title, m.artists, m.album, m.album_artists, m.track_length, m.listened_for,
            m.source, m.note, m.latitude, m.longitude, m.location_accuracy, m.session_id,
            a.id AS art_id, ${albumRefSql('m.')} AS album_ref, ${songKeySql('m.')} AS song_key,
            (${companionNamesSql(PLUGIN_ID, 'm.id')}) AS companions
     FROM music_scrobbles m
     LEFT JOIN music_albums a ON a.user_id = m.user_id AND a.album_key = m.album_key AND a.thumb_file IS NOT NULL
     WHERE m.id = $2 AND m.user_id = $1`,
    [userId, id],
  );
  const row = r.rows[0];
  if (!row) return null;
  const { session_id: sessionId, ...play } = row;
  const [history, session] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS plays, MIN(played_at) AS first_played_at, MAX(played_at) AS last_played_at
       FROM music_scrobbles
       WHERE user_id = $1 AND ${songKeySql()} = $2`,
      [userId, play.song_key],
    ),
    sessionId
      ? query(
          `SELECT s.id, s.title, s.artists, s.played_at, (ms.ended_at AT TIME ZONE ms.timezone)::date::text AS date
           FROM music_scrobbles s JOIN music_sessions ms ON ms.id = s.session_id
           WHERE s.user_id = $1 AND s.session_id = $2 ORDER BY s.played_at, s.id`,
          [userId, sessionId],
        )
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const inSession = session.rows as (SessionNeighbour & { date: string })[];
  const at = inSession.findIndex((x) => x.id === id);
  const neighbour = (x: (SessionNeighbour & { date: string }) | undefined): SessionNeighbour | null =>
    x ? { id: x.id, title: x.title, artists: x.artists, played_at: x.played_at } : null;
  return {
    ...play,
    history: history.rows[0],
    session: sessionId && at >= 0
      ? { id: sessionId, date: inSession[at].date, position: at + 1, count: inSession.length, previous: neighbour(inSession[at - 1]), next: neighbour(inSession[at + 1]) }
      : null,
  } as ScrobbleDetail;
}

const BULK_BATCH = 1000;

/**
 * Insert many scrobbles (import / restore), skipping duplicates, then rebuild
 * all sessions once. Returns the number of newly inserted rows.
 */
export async function insertScrobblesBulk(
  userId: string,
  rows: ScrobbleInput[],
  opts: {
    /** Transaction to run in (restore); a connection is opened when omitted. */
    db?: Queryable;
    /** Session gap to build with, when the stored one isn't in place yet (restore). */
    sessionGapMinutes?: number;
    /** Fallback zone for plays with neither a zone nor an earlier check-in (restore). */
    fallbackTimezone?: string;
  } = {},
): Promise<number> {
  let inserted = 0;
  const ownsClient = opts.db == null;
  const client = (opts.db ?? (await pool.connect())) as PoolClient;
  try {
    if (ownsClient) await client.query('BEGIN');
    // Inside a caller's transaction read settings through it (a pool read
    // could block on its uncommitted rows); never generate a key there.
    const settings = ownsClient ? await getMusicSettings(userId) : await readMusicSettings(userId, client);
    // Plays that arrive without a zone take it from the user's check-ins.
    const anchors = rows.some((r) => !validZone(r.timezone)) ? await loadTimezoneAnchors(userId) : [];
    const fallback = opts.fallbackTimezone ?? settings.timezone;
    for (let i = 0; i < rows.length; i += BULK_BATCH) {
      const batch = rows.slice(i, i + BULK_BATCH).map((r) => ({
        timezone: validZone(r.timezone) ?? timezoneAt(anchors, r.playedAt.getTime(), fallback),
        played_at: r.playedAt.toISOString(),
        title: r.title,
        artists: r.artists,
        album: r.album ?? null,
        album_artists: r.albumArtists ?? [],
        track_length: r.trackLength ?? null,
        listened_for: r.listenedFor ?? null,
        source: r.source ?? null,
        id: r.id ?? null,
        note: r.note ?? null,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        location_accuracy: r.locationAccuracy ?? null,
      }));
      const result = await client.query(
        `INSERT INTO music_scrobbles
           (id, user_id, played_at, title, artists, album, album_artists, track_length, listened_for, source, timezone,
            note, latitude, longitude, location_accuracy)
         SELECT COALESCE(r.id, gen_random_uuid()), $1, r.played_at, r.title,
                ARRAY(SELECT jsonb_array_elements_text(r.artists)),
                r.album,
                ARRAY(SELECT jsonb_array_elements_text(r.album_artists)),
                r.track_length, r.listened_for, r.source, r.timezone,
                r.note, r.latitude, r.longitude, r.location_accuracy
         FROM jsonb_to_recordset($2::jsonb) AS r(
           id uuid, played_at timestamptz, title text, artists jsonb, album text, album_artists jsonb,
           track_length int, listened_for int, source text, timezone text,
           note text, latitude double precision, longitude double precision, location_accuracy int)
         ON CONFLICT DO NOTHING`,
        [userId, JSON.stringify(batch)],
      );
      inserted += result.rowCount ?? 0;
    }
    if (inserted > 0) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`music_sessions:${userId}`]);
      await rebuildSessions(client, userId, opts.sessionGapMinutes ?? settings.session_gap_minutes, null);
    }
    if (ownsClient) await client.query('COMMIT');
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface StoredScrobble {
  played_at: Date;
  title: string;
  artists: string[];
  album: string | null;
  album_artists: string[];
  track_length: number | null;
  listened_for: number | null;
}

export interface ScrobblePage {
  rows: StoredScrobble[];
  hasMore: boolean;
}

/** Newest-first page of scrobbles, optionally bounded by UTC instants. */
export async function listScrobbles(
  userId: string,
  opts: { from?: Date | null; until?: Date | null; page: number; perPage: number },
): Promise<ScrobblePage> {
  const result = await query(
    `SELECT played_at, title, artists, album, album_artists, track_length, listened_for
     FROM music_scrobbles
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR played_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR played_at < $3::timestamptz)
     ORDER BY played_at DESC, id DESC
     LIMIT $4 OFFSET $5`,
    [userId, opts.from ?? null, opts.until ?? null, opts.perPage + 1, opts.page * opts.perPage],
  );
  return {
    rows: result.rows.slice(0, opts.perPage),
    hasMore: result.rows.length > opts.perPage,
  };
}

export interface MusicTotals {
  scrobbles: number;
  listened_seconds: number;
  unique_artists: number;
  unique_tracks: number;
}

/**
 * SQL fragment bounding plays to local dates, each play read in its own
 * timezone; params start at $2.
 */
const IN_RANGE = `
  AND ($2::date IS NULL OR (played_at AT TIME ZONE timezone)::date >= $2::date)
  AND ($3::date IS NULL OR (played_at AT TIME ZONE timezone)::date <= $3::date)`;
const PLAY_SECONDS = `COALESCE(listened_for, track_length, 0)`;
const ALBUM_ARTISTS = `CASE WHEN cardinality(album_artists) > 0 THEN album_artists ELSE artists[1:1] END`;

function rangeParams(userId: string, from: string | null, to: string | null) {
  return [userId, from || null, to || null];
}

export async function getTotals(userId: string, from: string | null, to: string | null): Promise<MusicTotals> {
  const result = await query(
    `SELECT COUNT(*)::int AS scrobbles,
            COALESCE(SUM(${PLAY_SECONDS}), 0)::int AS listened_seconds,
            (SELECT COUNT(DISTINCT a) FROM music_scrobbles m2, unnest(m2.artists) a
              WHERE m2.user_id = $1
                AND ($2::date IS NULL OR (m2.played_at AT TIME ZONE m2.timezone)::date >= $2::date)
                AND ($3::date IS NULL OR (m2.played_at AT TIME ZONE m2.timezone)::date <= $3::date))::int AS unique_artists,
            COUNT(DISTINCT song_key)::int AS unique_tracks
     FROM music_scrobbles
     WHERE user_id = $1 ${IN_RANGE}`,
    rangeParams(userId, from, to),
  );
  return result.rows[0];
}

export type LibraryView = 'songs' | 'artists' | 'albums';

export interface LibraryOptions {
  limit: number;
  offset?: number;
  /** Matches the name, artists or album (any one play of a song counts). */
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

/** Sortable columns, as the outer query names them. */
export const LIBRARY_SORTS: Record<string, string> = {
  name: 'lower(g.name)',
  artists: 'lower(g.artists::text)',
  album: "lower(COALESCE(g.album, ''))",
  plays: 'g.plays',
  time: 'g.listened_seconds',
  last: 'g.last_played_at',
  first: 'g.first_played_at',
  tracks: 'g.unique_tracks',
};

/**
 * Aggregated plays per song / artist / album in the period (the whole history
 * when there is none), filtered, sorted and paged here so a library of tens of
 * thousands of songs is searchable, not just its most played thousand.
 *
 * A song is its `song_key` (title without a "(feat. X)" credit, and first
 * artist); an album is its `album_key`. Each row shows the fullest artist
 * credit and the most recent spelling seen.
 */
export async function getLibrary(
  userId: string,
  view: LibraryView,
  from: string | null,
  to: string | null,
  opts: LibraryOptions,
): Promise<{ rows: any[]; total: number }> {
  const q = likeText(opts.q ?? '');
  // $1 user, $2/$3 range (IN_RANGE), $4 search text, $5 limit, $6 offset.
  const params = [...rangeParams(userId, from, to), q, opts.limit, opts.offset ?? 0];
  const agg = `COUNT(*)::int AS plays,
               COALESCE(SUM(${PLAY_SECONDS}), 0)::int AS listened_seconds,
               MIN(played_at) AS first_played_at,
               MAX(played_at) AS last_played_at`;
  const like = (text: string) => `BOOL_OR(lower(${text}) LIKE '%' || $4 || '%' ESCAPE '\\')`;
  let grouped: string;
  if (view === 'artists') {
    grouped = `SELECT a.artist AS name, NULL::jsonb AS artists, NULL::text AS album, NULL::text AS album_ref, NULL::text AS song_key,
                      COUNT(DISTINCT m.song_key)::int AS unique_tracks,
                      COUNT(*)::int AS plays,
                      COALESCE(SUM(COALESCE(m.listened_for, m.track_length, 0)), 0)::int AS listened_seconds,
                      MIN(m.played_at) AS first_played_at, MAX(m.played_at) AS last_played_at
               FROM music_scrobbles m, unnest(m.artists) AS a(artist)
               WHERE m.user_id = $1
                 AND ($2::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date >= $2::date)
                 AND ($3::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date <= $3::date)
               GROUP BY a.artist
               HAVING $4 = '' OR lower(a.artist) LIKE '%' || $4 || '%' ESCAPE '\\'`;
  } else if (view === 'albums') {
    grouped = `SELECT ${latestTitleSql().replace(/title/g, 'album')} AS name,
                      (ARRAY_AGG(to_jsonb(${ALBUM_ARTISTS}) ORDER BY played_at DESC))[1] AS artists,
                      NULL::text AS album, album_key AS album_ref, NULL::text AS song_key,
                      COUNT(DISTINCT song_key)::int AS unique_tracks, ${agg}
               FROM music_scrobbles
               WHERE user_id = $1 AND album_key IS NOT NULL ${IN_RANGE}
               GROUP BY album_key
               HAVING $4 = '' OR ${like("album || ' ' || array_to_string(artists, ' ')")}`;
  } else {
    grouped = `SELECT ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists,
                      MODE() WITHIN GROUP (ORDER BY album) AS album,
                      MODE() WITHIN GROUP (ORDER BY ${albumRefSql()}) AS album_ref,
                      ${songKeySql()} AS song_key, NULL::int AS unique_tracks, ${agg}
               FROM music_scrobbles
               WHERE user_id = $1 ${IN_RANGE}
               GROUP BY ${songKeySql()}
               HAVING $4 = '' OR ${like("title || ' ' || array_to_string(artists, ' ') || ' ' || COALESCE(album, '')")}`;
  }
  const sort = opts.sort && LIBRARY_SORTS[opts.sort] ? opts.sort : 'plays';
  const sql = `SELECT g.*, a.id AS art_id, COUNT(*) OVER()::int AS total
               FROM (${grouped}) g
               LEFT JOIN music_albums a
                 ON a.user_id = $1 AND a.album_key = g.album_ref AND a.thumb_file IS NOT NULL
               ORDER BY ${orderBy(LIBRARY_SORTS, sort, opts.dir ?? 'desc', 'g.last_played_at DESC, lower(g.name)')}
               LIMIT $5 OFFSET $6`;
  const result = await query(sql, params);
  const rows = result.rows.map(({ total: _t, ...row }) => {
    // An artist is just a name and its totals.
    if (view === 'artists') {
      const { artists: _a, album: _al, album_ref: _r, song_key: _s, art_id: _i, ...artist } = row;
      return artist;
    }
    return row;
  });
  return { rows, total: result.rows[0]?.total ?? 0 };
}

export interface ListeningBefore {
  /** The listening session the plays belong to (a timeline item). */
  session_id: string;
  /** Local date (YYYY-MM-DD) of the session's end, as the timeline groups it. */
  session_date: string;
  /** Up to three plays, newest first. */
  tracks: { artists: string[]; title: string; time: number; art_id: string | null; album_ref: string; song_key: string }[];
  /** True when the session has plays earlier than the oldest one returned. */
  has_more: boolean;
}

const LISTENING_PREVIEW_TRACKS = 3;

/**
 * For each anchor (a check-in's moment): the last few plays on or before it,
 * from the listening session of the most recent play, provided that play was
 * within `gapMinutes` of the anchor and the session is shown on the timeline
 * (`minTracks`). Anchors with nothing to show are absent from the result.
 */
export async function getListeningBefore(
  userId: string,
  anchors: { id: string; time: Date }[],
  gapMinutes: number,
  minTracks: number,
): Promise<Map<string, ListeningBefore>> {
  const out = new Map<string, ListeningBefore>();
  if (anchors.length === 0) return out;
  const result = await query(
    `SELECT a.id AS anchor_id, n.session_id, n.session_date,
            p.played_at, p.title, p.artists, p.art_id, p.album_ref, p.song_key,
            EXISTS (SELECT 1 FROM music_scrobbles e
                    WHERE e.session_id = n.session_id AND e.played_at < p.played_at) AS older_exists
     FROM unnest($1::uuid[], $2::timestamptz[]) AS a(id, t)
     JOIN LATERAL (
       SELECT s.session_id, ms.track_count, ms.has_manual,
              (ms.ended_at AT TIME ZONE ms.timezone)::date::text AS session_date
       FROM music_scrobbles s JOIN music_sessions ms ON ms.id = s.session_id
       WHERE s.user_id = $3
         AND s.played_at <= a.t
         AND s.played_at >= a.t - make_interval(mins => $4::int)
       ORDER BY s.played_at DESC, s.id DESC
       LIMIT 1
     ) n ON (n.track_count >= $5 OR n.has_manual)
     JOIN LATERAL (
       SELECT s2.played_at, s2.title, s2.artists, ${albumRefSql('s2.')} AS album_ref, ${songKeySql('s2.')} AS song_key,
              (SELECT al.id FROM music_albums al
               WHERE al.user_id = s2.user_id AND al.album_key = s2.album_key AND al.thumb_file IS NOT NULL) AS art_id
       FROM music_scrobbles s2
       WHERE s2.session_id = n.session_id AND s2.played_at <= a.t
       ORDER BY s2.played_at DESC, s2.id DESC
       LIMIT $6
     ) p ON true
     ORDER BY a.id, p.played_at DESC`,
    [anchors.map((a) => a.id), anchors.map((a) => a.time), userId, gapMinutes, minTracks, LISTENING_PREVIEW_TRACKS],
  );
  for (const row of result.rows) {
    let entry = out.get(row.anchor_id);
    if (!entry) {
      entry = { session_id: row.session_id, session_date: row.session_date, tracks: [], has_more: false };
      out.set(row.anchor_id, entry);
    }
    entry.tracks.push({
      artists: row.artists,
      title: row.title,
      time: Math.floor(new Date(row.played_at).getTime() / 1000),
      art_id: row.art_id ?? null,
      album_ref: row.album_ref,
      song_key: row.song_key,
    });
    // Rows arrive newest first, so the last one seen is the oldest shown.
    entry.has_more = row.older_exists;
  }
  return out;
}

export async function getSessionTracks(userId: string, sessionId: string) {
  const result = await query(
    `SELECT m.played_at, m.title, m.artists, m.album, m.track_length, m.listened_for, m.timezone, a.id AS art_id,
            ${albumRefSql('m.')} AS album_ref, ${songKeySql('m.')} AS song_key,
            m.id, m.note, (m.source = 'manual') AS manual, m.latitude, m.longitude,
            (${companionNamesSql(PLUGIN_ID, 'm.id')}) AS companions
     FROM music_scrobbles m
     LEFT JOIN music_albums a
       ON a.user_id = m.user_id AND a.album_key = m.album_key AND a.thumb_file IS NOT NULL
     WHERE m.user_id = $1 AND m.session_id = $2
     ORDER BY m.played_at DESC, m.id DESC`,
    [userId, sessionId],
  );
  return result.rows;
}

export async function getCounts(userId: string): Promise<{ scrobbles: number; last_scrobbled_at: string | null }> {
  const result = await query(
    `SELECT COUNT(*)::int AS scrobbles, MAX(played_at) AS last_scrobbled_at
     FROM music_scrobbles WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0];
}

export interface ReflectTrack {
  title: string;
  artists: string[];
  count: number;
}

/**
 * Most-played tracks (up to `limit`) on `date`'s month and day in each earlier
 * year, with each play placed on a day by the zone it was played in.
 */
export async function getReflectionTracks(
  userId: string,
  date: string,
  limit = 7,
): Promise<{ year: number; tracks: ReflectTrack[] }[]> {
  const result = await query(
    `WITH plays AS (
       SELECT EXTRACT(YEAR FROM played_at AT TIME ZONE timezone)::int AS year,
              played_at, title, artists, song_key
       FROM music_scrobbles
       WHERE user_id = $1
         AND TO_CHAR(played_at AT TIME ZONE timezone, 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
         AND EXTRACT(YEAR FROM played_at AT TIME ZONE timezone) < EXTRACT(YEAR FROM $2::date)
     ), ranked AS (
       SELECT year, ${latestTitleSql()} AS title, ${fullestArtistsSql()} AS artists, COUNT(*)::int AS count,
              ROW_NUMBER() OVER (
                PARTITION BY year
                ORDER BY COUNT(*) DESC, MAX(played_at) DESC, ${latestTitleSql()}
              ) AS rank
       FROM plays
       GROUP BY year, song_key
     )
     SELECT year, title, artists, count FROM ranked WHERE rank <= $3 ORDER BY year DESC, rank`,
    [userId, date, limit],
  );
  const byYear = new Map<number, ReflectTrack[]>();
  for (const r of result.rows) {
    const list = byYear.get(r.year) ?? [];
    list.push({ title: r.title, artists: r.artists, count: r.count });
    byYear.set(r.year, list);
  }
  return [...byYear].map(([year, tracks]) => ({ year, tracks }));
}
