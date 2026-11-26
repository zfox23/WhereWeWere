/**
 * Music plugin — plays over time split by what they're plays of, for the
 * wave charts on album, artist, playlist and list pages.
 *
 * The group's most played constituents (songs, or a list's items) each get
 * plays per local day; everything else is summed as "Other". Days are read in
 * the zone each play happened in, like the rest of Profile → Music. The
 * client groups the days into weeks, months or years itself.
 */

import { query } from '../../../server/src/db';
import { fullestArtistsSql, latestTitleSql, songKeySql } from './identity';
import type { DayCount } from './detail';

/** Constituents drawn as bands of their own (one per categorical colour). */
export const SERIES_BANDS = 8;

export interface SeriesBand {
  /** The constituent's identity: a song key, or a list item key. */
  key: string;
  name: string;
  artists: string[];
  plays: number;
  daily: DayCount[];
}

export interface PlaySeries {
  /** Most played first. */
  bands: SeriesBand[];
  /** Everything outside the bands: how many plays, of how many constituents, per day. */
  other: { plays: number; count: number; daily: DayCount[] };
}

/** Local dates (inclusive) whose plays pick the bands, instead of all of them. */
export interface RankWindow {
  from: string;
  to: string;
}

/**
 * The plays of `m` matching `where` (values from $2 on; the user is $1),
 * split by `key` (an expression on `m`, songs by default). The bands are the
 * most played overall, or, with `rank`, the most played in that window (ties
 * by plays overall); plays per day always cover everything.
 */
export async function getPlaySeries(
  userId: string,
  where: string,
  values: unknown[],
  key: string = songKeySql('m.'),
  rank?: RankWindow,
): Promise<PlaySeries> {
  const params = [userId, ...values, ...(rank ? [rank.from, rank.to] : [])];
  const fromParam = `$${values.length + 2}`;
  const toParam = `$${values.length + 3}`;
  const inWindow = rank ? `COUNT(*) FILTER (WHERE day BETWEEN ${fromParam}::date AND ${toParam}::date) DESC, ` : '';
  const plays = `
    p AS (
      SELECT ${key} AS key, m.title, m.artists, m.played_at, (m.played_at AT TIME ZONE m.timezone)::date AS day
      FROM music_scrobbles m WHERE m.user_id = $1 AND (${where})
    ),
    totals AS (
      SELECT key, COUNT(*)::int AS plays, ${latestTitleSql()} AS name, ${fullestArtistsSql()} AS artists,
             ROW_NUMBER() OVER (ORDER BY ${inWindow}COUNT(*) DESC, key) AS rn
      FROM p GROUP BY key
    )`;
  const [totals, days] = await Promise.all([
    query(`WITH ${plays} SELECT key, plays, name, artists, rn FROM totals ORDER BY rn`, params),
    query(
      `WITH ${plays}
       SELECT CASE WHEN t.rn <= ${SERIES_BANDS} THEN t.key END AS key, p.day::text AS date, COUNT(*)::int AS plays
       FROM p JOIN totals t USING (key)
       GROUP BY 1, 2 ORDER BY 2`,
      params,
    ),
  ]);
  const rows = totals.rows as { key: string; plays: number; name: string; artists: string[]; rn: string | number }[];
  const daily = new Map<string | null, DayCount[]>();
  for (const d of days.rows as { key: string | null; date: string; plays: number }[]) {
    daily.set(d.key, [...(daily.get(d.key) ?? []), { date: d.date, plays: d.plays }]);
  }
  const banded = rows.filter((r) => Number(r.rn) <= SERIES_BANDS);
  const rest = rows.filter((r) => Number(r.rn) > SERIES_BANDS);
  return {
    bands: banded.map((r) => ({ key: r.key, name: r.name, artists: r.artists ?? [], plays: r.plays, daily: daily.get(r.key) ?? [] })),
    other: { plays: rest.reduce((n, r) => n + r.plays, 0), count: rest.length, daily: daily.get(null) ?? [] },
  };
}
