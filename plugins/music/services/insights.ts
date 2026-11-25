/**
 * Music plugin — the Overview's charts: a listening calendar (with streaks),
 * a listening clock (hour of day by day of week) and discovery (plays of songs
 * new to you against familiar ones).
 *
 * Every day, hour and month is read in the zone the play happened in, the
 * same rule as the rest of Profile → Music.
 */

import { query } from '../../../server/src/db';
import { IN_RANGE, PLAY_SECONDS } from './scrobbles';
import { playGenres } from './genreSql';

/** A play's local calendar day. */
const LOCAL_DAY = `(played_at AT TIME ZONE timezone)::date`;

export interface DailyListening {
  days: { date: string; plays: number; seconds: number }[];
  /** Days with at least one play in the year. */
  listening_days: number;
  /** Longest run of consecutive listening days, ever. */
  longest_streak: number;
  /** The run that reaches `today` or the day before (0 when neither had a play). */
  current_streak: number;
}

/** Plays per local day of `year`, and streaks over the whole history. */
export async function getDailyListening(userId: string, year: number, today: string): Promise<DailyListening> {
  const [days, streaks] = await Promise.all([
    query(
      `SELECT ${LOCAL_DAY}::text AS date, COUNT(*)::int AS plays, COALESCE(SUM(${PLAY_SECONDS}), 0)::int AS seconds
       FROM music_scrobbles
       WHERE user_id = $1 AND ${LOCAL_DAY} BETWEEN make_date($2, 1, 1) AND make_date($2, 12, 31)
       GROUP BY 1 ORDER BY 1`,
      [userId, year],
    ),
    // Gaps and islands: consecutive days share day - row_number.
    query(
      `WITH d AS (SELECT DISTINCT ${LOCAL_DAY} AS day FROM music_scrobbles WHERE user_id = $1),
            runs AS (
              SELECT MAX(day) AS last_day, COUNT(*)::int AS n
              FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM d) g
              GROUP BY grp
            )
       SELECT COALESCE(MAX(n), 0)::int AS longest_streak,
              COALESCE(MAX(n) FILTER (WHERE last_day >= $2::date - 1), 0)::int AS current_streak
       FROM runs`,
      [userId, today],
    ),
  ]);
  return {
    days: days.rows,
    listening_days: days.rows.length,
    longest_streak: streaks.rows[0].longest_streak,
    current_streak: streaks.rows[0].current_streak,
  };
}

/** Plays and listening time per local day of week (0 = Sunday) and hour, in the period. */
export async function getListeningClock(userId: string, from: string | null, to: string | null) {
  const r = await query(
    `SELECT extract(dow FROM played_at AT TIME ZONE timezone)::int AS dow,
            extract(hour FROM played_at AT TIME ZONE timezone)::int AS hour,
            COUNT(*)::int AS plays, COALESCE(SUM(${PLAY_SECONDS}), 0)::int AS seconds
     FROM music_scrobbles
     WHERE user_id = $1 ${IN_RANGE}
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [userId, from, to],
  );
  return r.rows as { dow: number; hour: number; plays: number; seconds: number }[];
}

export type DiscoveryBucket = 'week' | 'month' | 'year';

/** Weeks for two months or less, months up to three years, years beyond. */
export function discoveryBucket(first: string, last: string): DiscoveryBucket {
  const days = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  if (days <= 62) return 'week';
  if (days <= 3 * 366) return 'month';
  return 'year';
}

export interface Discovery {
  bucket: DiscoveryBucket;
  buckets: { start: string; new_plays: number; familiar_plays: number; new_songs: number; new_artists: number; new_genres: number }[];
  totals: { plays: number; new_plays: number; new_songs: number; new_artists: number; new_genres: number };
}

/**
 * Per bucket of the period: plays of songs first heard in that same bucket
 * ("new") against the rest ("familiar"), and how many songs and artists were
 * heard for the first time ever. Firsts are over the whole history, so a song
 * first played before the period is familiar throughout it.
 */
export async function getDiscovery(userId: string, from: string | null, to: string | null): Promise<Discovery> {
  const span = await query(
    `SELECT MIN(${LOCAL_DAY})::text AS first, MAX(${LOCAL_DAY})::text AS last
     FROM music_scrobbles WHERE user_id = $1 ${IN_RANGE}`,
    [userId, from, to],
  );
  const { first, last } = span.rows[0] as { first: string | null; last: string | null };
  const empty = { plays: 0, new_plays: 0, new_songs: 0, new_artists: 0, new_genres: 0 };
  if (!first || !last) return { bucket: 'month', buckets: [], totals: empty };
  const start = from ?? first;
  const end = to ?? last;
  const bucket = discoveryBucket(start, end);

  const pg = playGenres('m');
  // $1 user, $2 start, $3 end, $4 bucket unit.
  const r = await query(
    `WITH plays AS (
       SELECT m.song_key, m.artists, (m.played_at AT TIME ZONE m.timezone)::date AS day, ${pg.genres} AS genres
       FROM music_scrobbles m ${pg.join} WHERE m.user_id = $1
     ),
     song_first AS (SELECT song_key, MIN(day) AS first_day FROM plays GROUP BY song_key),
     artist_first AS (SELECT a AS artist, MIN(day) AS first_day FROM plays, unnest(artists) AS a GROUP BY a),
     genre_first AS (SELECT g AS genre, MIN(day) AS first_day FROM plays, unnest(genres) AS g GROUP BY g),
     buckets AS (
       SELECT generate_series(date_trunc($4::text, ($2::date)::timestamp), date_trunc($4::text, ($3::date)::timestamp), ('1 ' || $4::text)::interval)::date AS start
     ),
     play_counts AS (
       SELECT date_trunc($4::text, (p.day)::timestamp)::date AS start,
              COUNT(*) FILTER (WHERE date_trunc($4::text, (p.day)::timestamp) = date_trunc($4::text, (f.first_day)::timestamp))::int AS new_plays,
              COUNT(*) FILTER (WHERE date_trunc($4::text, (p.day)::timestamp) <> date_trunc($4::text, (f.first_day)::timestamp))::int AS familiar_plays
       FROM plays p JOIN song_first f USING (song_key)
       WHERE p.day BETWEEN $2::date AND $3::date
       GROUP BY 1
     ),
     song_counts AS (
       SELECT date_trunc($4::text, (first_day)::timestamp)::date AS start, COUNT(*)::int AS n
       FROM song_first WHERE first_day BETWEEN $2::date AND $3::date GROUP BY 1
     ),
     artist_counts AS (
       SELECT date_trunc($4::text, (first_day)::timestamp)::date AS start, COUNT(*)::int AS n
       FROM artist_first WHERE first_day BETWEEN $2::date AND $3::date GROUP BY 1
     ),
     genre_counts AS (
       SELECT date_trunc($4::text, (first_day)::timestamp)::date AS start, COUNT(*)::int AS n
       FROM genre_first WHERE first_day BETWEEN $2::date AND $3::date GROUP BY 1
     )
     SELECT b.start::text AS start,
            COALESCE(pc.new_plays, 0) AS new_plays, COALESCE(pc.familiar_plays, 0) AS familiar_plays,
            COALESCE(sc.n, 0) AS new_songs, COALESCE(ac.n, 0) AS new_artists, COALESCE(gc.n, 0) AS new_genres
     FROM buckets b
     LEFT JOIN play_counts pc USING (start)
     LEFT JOIN song_counts sc USING (start)
     LEFT JOIN artist_counts ac USING (start)
     LEFT JOIN genre_counts gc USING (start)
     ORDER BY b.start`,
    [userId, start, end, bucket],
  );
  const buckets = r.rows as Discovery['buckets'];
  const totals = buckets.reduce(
    (t, b) => ({
      plays: t.plays + b.new_plays + b.familiar_plays,
      new_plays: t.new_plays + b.new_plays,
      new_songs: t.new_songs + b.new_songs,
      new_artists: t.new_artists + b.new_artists,
      new_genres: t.new_genres + b.new_genres,
    }),
    empty,
  );
  return { bucket, buckets, totals };
}
