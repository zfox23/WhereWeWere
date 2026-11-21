/**
 * Music plugin — "Soundtrack of your life": what you played around your other
 * check-ins, grouped by the companion you were with, the kind of place you
 * were at, or the mood you logged.
 *
 * A play belongs to a check-in when it falls within the listening-session gap
 * (Settings → Music) before or after the check-in's moment. A play near
 * several check-ins of one group counts once for that group.
 *
 * Place and mood read the location and mood plugins' own tables (`checkins`,
 * `venues`, `venue_categories`, `mood_checkins`), always filtered to the user.
 * Companions are filtered on their owner and, as well, joined to the user's
 * own check-ins (`userCheckinRefsSql`) before their moments are looked up
 * through the plugins' `resolveTimestamps` hooks, which resolve anyone's ids.
 */

import { query } from '../../../server/src/db';
import { pluginTimestampUnion, userCheckinRefsSql } from '../../../server/src/plugins/registry';
import { fullestArtistsSql, latestTitleSql } from './identity';
import { getMusicSettings } from './scrobbles';

export type LifeBy = 'companion' | 'place' | 'mood';
export const LIFE_BY: LifeBy[] = ['companion', 'place', 'mood'];

/** Groups returned, most plays first. */
const MAX_GROUPS = 8;
/** Artists and songs returned per group, most played first. */
const TOP_ITEMS = 30;
/** A day either side of the period, so check-ins just outside it still reach its plays. */
const DAY_MS = 86_400_000;

interface Anchor {
  t: Date | string;
  key: string;
  label: string;
}

export interface LifeItem {
  name: string;
  plays: number;
  /** Share of the group's plays over share of all plays in the period; > 1 means "more than usual". */
  lift: number;
}

export interface LifeGroup {
  key: string;
  label: string;
  /** Check-ins of the group with at least one play around them. */
  checkins: number;
  plays: number;
  top_artists: LifeItem[];
  top_songs: (LifeItem & { artists: string[]; song_key: string })[];
}

function anchorWindow(from: string | null, to: string | null): [Date | null, Date | null] {
  return [
    from ? new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS) : null,
    to ? new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS) : null,
  ];
}

async function companionAnchors(userId: string, lo: Date | null, hi: Date | null): Promise<Anchor[]> {
  const refs = userCheckinRefsSql(userId);
  const owned = await query(
    `SELECT DISTINCT c.checkin_id AS id, c.name
     FROM companions c
     JOIN (\n${refs.sql}\n) r ON r.type = c.checkin_type AND r.id = c.checkin_id
     WHERE c.user_id = $1`,
    refs.values,
  );
  if (owned.rows.length === 0) return [];
  // The ids are the user's own (above), so resolving their moments is safe.
  const ids = [...new Set(owned.rows.map((r: { id: string }) => String(r.id)))];
  const times = await query(
    `SELECT u.id, u.checked_in_at FROM (\n${pluginTimestampUnion()}\n) u
     WHERE ($2::timestamptz IS NULL OR u.checked_in_at >= $2) AND ($3::timestamptz IS NULL OR u.checked_in_at < $3)`,
    [ids, lo, hi],
  );
  const at = new Map(times.rows.map((r: { id: string; checked_in_at: Date }) => [String(r.id), r.checked_in_at]));
  return owned.rows.flatMap((r: { id: string; name: string }) => {
    const t = at.get(String(r.id));
    return t ? [{ t, key: r.name, label: r.name }] : [];
  });
}

async function placeAnchors(userId: string, lo: Date | null, hi: Date | null): Promise<Anchor[]> {
  const r = await query(
    `SELECT c.checked_in_at AS t, vc.id::text AS key, vc.name AS label
     FROM checkins c
     JOIN venues v ON v.id = c.venue_id
     JOIN venue_categories vc ON vc.id = v.category_id
     WHERE c.user_id = $1
       AND ($2::timestamptz IS NULL OR c.checked_in_at >= $2) AND ($3::timestamptz IS NULL OR c.checked_in_at < $3)`,
    [userId, lo, hi],
  );
  return r.rows;
}

async function moodAnchors(userId: string, lo: Date | null, hi: Date | null): Promise<Anchor[]> {
  const r = await query(
    `SELECT checked_in_at AS t, mood::text AS key, mood::text AS label
     FROM mood_checkins
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR checked_in_at >= $2) AND ($3::timestamptz IS NULL OR checked_in_at < $3)`,
    [userId, lo, hi],
  );
  return r.rows;
}

export const ANCHORS: Record<LifeBy, (userId: string, lo: Date | null, hi: Date | null) => Promise<Anchor[]>> = {
  companion: companionAnchors,
  place: placeAnchors,
  mood: moodAnchors,
};

/** The period's plays, each read on its own local day; $1 user, $2/$3 range. */
const PLAY_RANGE = `
  AND ($2::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date >= $2::date)
  AND ($3::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date <= $3::date)`;

export async function getLifeSoundtrack(
  userId: string,
  by: LifeBy,
  from: string | null,
  to: string | null,
): Promise<{ groups: LifeGroup[]; gap_minutes: number }> {
  const { session_gap_minutes: gap } = await getMusicSettings(userId);
  const [lo, hi] = anchorWindow(from, to);
  const anchors = await ANCHORS[by](userId, lo, hi);
  if (anchors.length === 0) return { groups: [], gap_minutes: gap };

  const labels = new Map(anchors.map((a) => [a.key, a.label]));
  // $1 user, $2/$3 range, $4 anchor moments, $5 anchor groups, $6 gap minutes.
  const params = [userId, from, to, anchors.map((a) => a.t), anchors.map((a) => a.key), gap];
  const linked = `
    anc AS (SELECT ord, t, grp FROM unnest($4::timestamptz[], $5::text[]) WITH ORDINALITY AS a(t, grp, ord)),
    linked AS (
      SELECT DISTINCT a.grp, m.id, m.song_key, m.title, m.artists, m.played_at
      FROM anc a
      JOIN music_scrobbles m
        ON m.user_id = $1
       AND m.played_at BETWEEN a.t - make_interval(mins => $6::int) AND a.t + make_interval(mins => $6::int)
      WHERE TRUE ${PLAY_RANGE}
    )`;

  const [groups, artists, songs, overall] = await Promise.all([
    query(
      `WITH ${linked}
       SELECT g.grp, g.plays,
              (SELECT COUNT(*)::int FROM anc a2 WHERE a2.grp = g.grp AND EXISTS (
                 SELECT 1 FROM music_scrobbles m
                 WHERE m.user_id = $1
                   AND m.played_at BETWEEN a2.t - make_interval(mins => $6::int) AND a2.t + make_interval(mins => $6::int)
                   ${PLAY_RANGE})) AS checkins
       FROM (SELECT grp, COUNT(*)::int AS plays FROM linked GROUP BY grp) g
       ORDER BY g.plays DESC, g.grp
       LIMIT ${MAX_GROUPS}`,
      params,
    ),
    query(
      `WITH ${linked},
       counted AS (
         SELECT grp, artist, COUNT(*)::int AS plays,
                ROW_NUMBER() OVER (PARTITION BY grp ORDER BY COUNT(*) DESC, artist) AS rn
         FROM linked, unnest(artists) AS artist GROUP BY grp, artist
       )
       SELECT grp, artist AS name, plays FROM counted WHERE rn <= ${TOP_ITEMS}`,
      params,
    ),
    query(
      `WITH ${linked},
       counted AS (
         SELECT grp, song_key, ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists, COUNT(*)::int AS plays,
                ROW_NUMBER() OVER (PARTITION BY grp ORDER BY COUNT(*) DESC, song_key) AS rn
         FROM linked GROUP BY grp, song_key
       )
       SELECT grp, song_key, name, artists, plays FROM counted WHERE rn <= ${TOP_ITEMS}`,
      params,
    ),
    // Everything played in the period: the baseline for lift.
    query(
      `SELECT
         (SELECT COUNT(*)::int FROM music_scrobbles m WHERE m.user_id = $1 ${PLAY_RANGE}) AS total,
         (SELECT COALESCE(jsonb_object_agg(artist, n), '{}') FROM (
            SELECT artist, COUNT(*)::int AS n FROM music_scrobbles m, unnest(m.artists) AS artist
            WHERE m.user_id = $1 ${PLAY_RANGE} GROUP BY artist) x) AS artists,
         (SELECT COALESCE(jsonb_object_agg(song_key, n), '{}') FROM (
            SELECT song_key, COUNT(*)::int AS n FROM music_scrobbles m
            WHERE m.user_id = $1 ${PLAY_RANGE} GROUP BY song_key) y) AS songs`,
      [userId, from, to],
    ),
  ]);

  const base = overall.rows[0] as { total: number; artists: Record<string, number>; songs: Record<string, number> };
  const lift = (n: number, groupPlays: number, overallN: number | undefined) =>
    groupPlays && base.total && overallN ? Math.round(((n / groupPlays) / (overallN / base.total)) * 100) / 100 : 0;

  return {
    gap_minutes: gap,
    groups: groups.rows.map((g: { grp: string; plays: number; checkins: number }) => ({
      key: g.grp,
      label: labels.get(g.grp) ?? g.grp,
      checkins: g.checkins,
      plays: g.plays,
      top_artists: artists.rows
        .filter((a: { grp: string }) => a.grp === g.grp)
        .map((a: { name: string; plays: number }) => ({ name: a.name, plays: a.plays, lift: lift(a.plays, g.plays, base.artists[a.name]) })),
      top_songs: songs.rows
        .filter((s: { grp: string }) => s.grp === g.grp)
        .map((s: { song_key: string; name: string; artists: string[]; plays: number }) => ({
          name: s.name,
          artists: s.artists,
          song_key: s.song_key,
          plays: s.plays,
          lift: lift(s.plays, g.plays, base.songs[s.song_key]),
        })),
    })),
  };
}
