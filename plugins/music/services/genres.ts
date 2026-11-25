/**
 * Music plugin — genres: looking them up, correcting them, and reading them.
 *
 * Genres are looked up on MusicBrainz (see genreProviders.ts) for every
 * album and every first-credited artist, and cached in `music_genres` with
 * the user's own corrections beside them. Which genres a play has is decided
 * in SQL by genreSql.ts. Lookups run as a user-started backfill (Settings →
 * Music) or, for a newly arrived scrobble, in the background.
 *
 * Counting: a play counts in full toward each of its genres, so genre totals
 * can add up to more than the plays they came from.
 */

import { query } from '../../../server/src/db';
import { ProviderUnavailableError, sharedMusicBrainz } from './albumProviders';
import { cleanGenreList, musicBrainzGenres, type GenreMatch, type GenreProvider } from './genreProviders';
import { artistKeyOf, playGenres } from './genreSql';
import { discoveryBucket, type DiscoveryBucket } from './insights';

/** The period's plays of `m`, each read on its own local day; $1 user, $2/$3 range. */
const M_RANGE = `
  AND ($2::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date >= $2::date)
  AND ($3::date IS NULL OR (m.played_at AT TIME ZONE m.timezone)::date <= $3::date)`;
const M_SECONDS = `COALESCE(m.listened_for, m.track_length, 0)`;

export type GenreKind = 'album' | 'artist';

// Tests never reach the network: they inject a provider with `setGenreProvider`.
let provider: GenreProvider | null = process.env.NODE_ENV === 'test' ? null : musicBrainzGenres(sharedMusicBrainz());

export function setGenreProvider(next: GenreProvider | null): void {
  provider = next;
}

export const genreLookupEnabled = () => provider !== null;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

interface Target {
  kind: GenreKind;
  key: string;
  /** Album title (albums) or artist name, as played. */
  name: string;
  /** The album's artist (albums only). */
  artist: string | null;
}

async function store(userId: string, target: Target, match: GenreMatch | null): Promise<'found' | 'not_found'> {
  const found = Boolean(match && match.genres.length > 0);
  await query(
    `INSERT INTO music_genres (user_id, kind, item_key, status, mbid, catalog_genres, looked_up_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, kind, item_key) DO UPDATE SET
       status = EXCLUDED.status, mbid = EXCLUDED.mbid, catalog_genres = EXCLUDED.catalog_genres, looked_up_at = NOW()`,
    [userId, target.kind, target.key, found ? 'matched' : 'not_found', match?.mbid ?? null, match?.genres ?? []],
  );
  return found ? 'found' : 'not_found';
}

/** Look one album or artist up. Throws ProviderUnavailableError when MusicBrainz can't be reached. */
async function lookupOne(userId: string, target: Target): Promise<'found' | 'not_found'> {
  if (!provider) throw new ProviderUnavailableError('Genre lookup is disabled');
  const match =
    target.kind === 'album'
      ? await provider.album({ album: target.name, artist: target.artist ?? '' })
      : await provider.artist(target.name);
  return store(userId, target, match);
}

/** Albums of the user's plays never looked up (a user's edit alone doesn't count), most played first. */
const UNLOOKED_ALBUMS = `
  SELECT 'album' AS kind, m.album_key AS key, MIN(m.album) AS name,
         (ARRAY_AGG(COALESCE(m.album_artists[1], m.artists[1]) ORDER BY m.played_at DESC))[1] AS artist,
         COUNT(*)::int AS plays
  FROM music_scrobbles m
  LEFT JOIN music_genres g ON g.user_id = m.user_id AND g.kind = 'album' AND g.item_key = m.album_key
  WHERE m.user_id = $1 AND m.album_key IS NOT NULL AND g.status IS NULL`;

/** First-credited artists never looked up, most played first. */
const UNLOOKED_ARTISTS = `
  SELECT 'artist' AS kind, k.key, k.name, NULL::text AS artist, k.plays
  FROM (
    SELECT ${artistKeyOf('m.artists[1]')} AS key, (ARRAY_AGG(btrim(m.artists[1]) ORDER BY m.played_at DESC))[1] AS name,
           COUNT(*)::int AS plays
    FROM music_scrobbles m
    WHERE m.user_id = $1 AND cardinality(m.artists) > 0
    GROUP BY 1
  ) k
  LEFT JOIN music_genres g ON g.user_id = $1 AND g.kind = 'artist' AND g.item_key = k.key
  WHERE k.key <> '' AND g.status IS NULL`;

export interface GenreBackfillStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  /** Artists are looked up first: one artist covers every album of theirs that has no genres of its own. */
  phase: GenreKind | null;
  processed: number;
  total: number;
  found: number;
  not_found: number;
  /** Left for next time because MusicBrainz was unavailable for them. */
  skipped: number;
  error: string | null;
}

const BATCH = 25;
const MAX_FAILURES_IN_A_ROW = 5;

interface Backfill {
  status: GenreBackfillStatus;
  cancelRequested: boolean;
  running: Promise<void> | null;
}

const IDLE: GenreBackfillStatus = { state: 'idle', phase: null, processed: 0, total: 0, found: 0, not_found: 0, skipped: 0, error: null };
const backfills = new Map<string, Backfill>();

export const getGenreBackfillStatus = (userId: string): GenreBackfillStatus => ({ ...(backfills.get(userId)?.status ?? IDLE) });
export const cancelGenreBackfill = (userId: string): void => {
  const run = backfills.get(userId);
  if (run?.status.state === 'running') run.cancelRequested = true;
};
/** Settles when the user's run (or, without a user, every run) has finished. */
export const whenGenreBackfillDone = async (userId?: string): Promise<void> => {
  const runs = userId ? [backfills.get(userId)] : [...backfills.values()];
  await Promise.all(runs.map((r) => r?.running ?? Promise.resolve()));
};

async function countUnlooked(userId: string): Promise<number> {
  const r = await query(
    `SELECT (SELECT COUNT(*) FROM (${UNLOOKED_ALBUMS} GROUP BY m.album_key) a)::int
          + (SELECT COUNT(*) FROM (${UNLOOKED_ARTISTS}) b)::int AS n`,
    [userId],
  );
  return r.rows[0].n;
}

/**
 * Look up every artist, then every album, that hasn't been looked up, most
 * played first. `retryMissing` first forgets earlier "nothing found" results
 * (a user's own edits are kept).
 */
export async function startGenreBackfill(userId: string, opts: { retryMissing?: boolean } = {}): Promise<GenreBackfillStatus> {
  if (!provider) throw new ProviderUnavailableError('Genre lookup is disabled');
  if (backfills.get(userId)?.status.state === 'running') throw new Error('A lookup is already running');
  if (opts.retryMissing) {
    await query(`UPDATE music_genres SET status = NULL WHERE user_id = $1 AND status = 'not_found'`, [userId]);
  }
  const run: Backfill = {
    status: { ...IDLE, state: 'running', total: await countUnlooked(userId) },
    cancelRequested: false,
    running: null,
  };
  backfills.set(userId, run);
  const { status } = run;
  run.running = (async () => {
    try {
      const skipped: string[] = [];
      let failuresInARow = 0;
      for (const [kind, sql] of [['artist', UNLOOKED_ARTISTS], ['album', UNLOOKED_ALBUMS]] as const) {
        status.phase = kind;
        // Re-query each round: anything that arrived meanwhile is picked up too.
        for (;;) {
          const keyCol = kind === 'album' ? 'm.album_key' : 'k.key';
          const batch = (await query(
            `${sql} AND NOT (${keyCol} = ANY($2::text[])) ${kind === 'album' ? 'GROUP BY m.album_key' : ''}
             ORDER BY plays DESC, key LIMIT ${BATCH}`,
            [userId, skipped],
          )).rows as Target[];
          if (batch.length === 0) break;
          for (const target of batch) {
            if (run.cancelRequested) {
              status.state = 'cancelled';
              return;
            }
            try {
              status[await lookupOne(userId, target)]++;
              failuresInARow = 0;
            } catch (err) {
              if (!(err instanceof ProviderUnavailableError)) throw err;
              skipped.push(target.key);
              status.skipped++;
              if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) throw err;
            }
            status.processed++;
            status.total = Math.max(status.total, status.processed);
          }
        }
      }
      status.phase = null;
      status.state = 'done';
    } catch (err) {
      status.state = 'error';
      status.error = err instanceof Error ? err.message : 'Lookup failed';
    }
  })();
  return getGenreBackfillStatus(userId);
}

const inFlight = new Set<string>();

/**
 * Fire-and-forget lookups for a just-stored play's album and first artist,
 * or for an artist whose page was opened. Never throws and never delays the
 * caller; a no-op for anything already looked up.
 */
export function lookupGenresSoon(userId: string, item: { albumKey?: string | null; artist?: string | null }): void {
  if (!provider) return;
  const wanted: { kind: GenreKind; key: string }[] = [];
  if (item.artist?.trim()) wanted.push({ kind: 'artist', key: item.artist.trim() });
  if (item.albumKey) wanted.push({ kind: 'album', key: item.albumKey });
  for (const w of wanted) {
    const flight = `${userId}:${w.kind}:${w.key}`;
    if (inFlight.has(flight)) continue;
    inFlight.add(flight);
    void (async () => {
      try {
        const target =
          w.kind === 'album'
            ? (await query(`${UNLOOKED_ALBUMS} AND m.album_key = $2 GROUP BY m.album_key`, [userId, w.key])).rows[0]
            : await unlookedArtist(userId, w.key);
        if (target) await lookupOne(userId, target as Target);
      } catch (err) {
        if (!(err instanceof ProviderUnavailableError)) console.error('Error looking up genres:', err);
      } finally {
        inFlight.delete(flight);
      }
    })();
  }
}

/** Any credited artist (not only first ones) can be looked up on demand. */
async function unlookedArtist(userId: string, name: string): Promise<Target | null> {
  const r = await query(
    `SELECT k.key, g.status FROM (SELECT ${artistKeyOf('$2::text')} AS key) k
     LEFT JOIN music_genres g ON g.user_id = $1 AND g.kind = 'artist' AND g.item_key = k.key`,
    [userId, name],
  );
  const row = r.rows[0];
  return !row.key || row.status ? null : { kind: 'artist', key: row.key, name, artist: null };
}

export async function getGenreCounts(userId: string) {
  const r = await query(
    `SELECT kind, COUNT(*) FILTER (WHERE status = 'matched')::int AS found,
            COUNT(*) FILTER (WHERE status = 'not_found')::int AS not_found
     FROM music_genres WHERE user_id = $1 GROUP BY kind`,
    [userId],
  );
  const of = (kind: GenreKind) => r.rows.find((x: { kind: string }) => x.kind === kind) ?? { found: 0, not_found: 0 };
  const coverage = await query(
    (() => {
      const pg = playGenres('m');
      return `SELECT COUNT(*)::int AS plays, COUNT(*) FILTER (WHERE cardinality(${pg.genres}) > 0)::int AS with_genres
              FROM music_scrobbles m ${pg.join} WHERE m.user_id = $1`;
    })(),
    [userId],
  );
  return {
    artists: { found: of('artist').found, not_found: of('artist').not_found },
    albums: { found: of('album').found, not_found: of('album').not_found },
    pending: await countUnlooked(userId),
    plays: coverage.rows[0].plays as number,
    plays_with_genres: coverage.rows[0].with_genres as number,
  };
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * Whether `ref` can have genres: an album ref of a real album (not an
 * artist's "|artist" "Unknown album", whose plays take the artist's genres),
 * or an artist's name.
 */
export function hasGenreKey(kind: GenreKind, ref: string): boolean {
  return kind === 'artist' ? ref.trim() !== '' : ref !== '' && !ref.startsWith('|');
}

/** The SQL computing an item's `music_genres` key from the param holding its ref or name. */
const keySql = (kind: GenreKind, param: string) => (kind === 'artist' ? artistKeyOf(`${param}::text`) : `${param}::text`);

/**
 * Replace an album's or artist's genres with the user's own (`null` goes back
 * to the catalog's). Returns the item's genres afterwards, or null for a key
 * that can't have genres.
 */
export async function setUserGenres(userId: string, kind: GenreKind, ref: string, genres: unknown[] | null): Promise<ItemGenres | null> {
  if (!hasGenreKey(kind, ref)) return null;
  const list = genres === null ? null : cleanGenreList(genres, 20);
  await query(
    `INSERT INTO music_genres (user_id, kind, item_key, user_genres) VALUES ($1, $2, ${keySql(kind, '$3')}, $4)
     ON CONFLICT (user_id, kind, item_key) DO UPDATE SET user_genres = EXCLUDED.user_genres`,
    [userId, kind, ref, list],
  );
  return getItemGenres(userId, kind, ref);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ItemGenres {
  /** What counts: the user's edit when there is one, else the catalog's. */
  genres: string[];
  catalog_genres: string[];
  edited: boolean;
  /** 'found' / 'not_found' after a lookup, null before one. */
  lookup: 'found' | 'not_found' | null;
}

export async function getItemGenres(userId: string, kind: GenreKind, ref: string): Promise<ItemGenres> {
  const row = hasGenreKey(kind, ref)
    ? (await query(
        `SELECT genres, catalog_genres, user_genres IS NOT NULL AS edited, status
         FROM music_genres WHERE user_id = $1 AND kind = $2 AND item_key = ${keySql(kind, '$3')}`,
        [userId, kind, ref],
      )).rows[0]
    : null;
  return {
    genres: row?.genres ?? [],
    catalog_genres: row?.catalog_genres ?? [],
    edited: row?.edited ?? false,
    lookup: row?.status === 'matched' ? 'found' : row?.status === 'not_found' ? 'not_found' : null,
  };
}

export interface GenreCount {
  name: string;
  plays: number;
}

/**
 * The genres of a group of plays (`where`, a condition on `m`, with values
 * from $2 on), each with how many of those plays carry it, most first.
 */
export async function genresOfPlays(userId: string, where: string, values: unknown[]): Promise<GenreCount[]> {
  const pg = playGenres('m');
  const r = await query(
    `SELECT g AS name, COUNT(*)::int AS plays
     FROM music_scrobbles m ${pg.join} CROSS JOIN LATERAL unnest(${pg.genres}) AS g
     WHERE m.user_id = $1 AND ${where}
     GROUP BY g ORDER BY plays DESC, g`,
    [userId, ...values],
  );
  return r.rows;
}

/** Plays per genre in the period (all time without one), most played first. */
export async function getTopGenres(
  userId: string,
  from: string | null,
  to: string | null,
  limit: number,
): Promise<{ name: string; plays: number; listened_seconds: number; artists: number }[]> {
  const pg = playGenres('m');
  const r = await query(
    `SELECT g AS name, COUNT(*)::int AS plays,
            COALESCE(SUM(${M_SECONDS}), 0)::int AS listened_seconds,
            COUNT(DISTINCT m.artists[1])::int AS artists
     FROM music_scrobbles m ${pg.join} CROSS JOIN LATERAL unnest(${pg.genres}) AS g
     WHERE m.user_id = $1 ${M_RANGE}
     GROUP BY g ORDER BY plays DESC, g LIMIT $4`,
    [userId, from, to, limit],
  );
  return r.rows;
}

/** Every genre ever played, most played first (the Library's filter and the editor's suggestions). */
export async function listGenres(userId: string): Promise<GenreCount[]> {
  return genresOfPlays(userId, 'TRUE', []);
}

// ---- Genres over time ----------------------------------------------------

/** Genres drawn as bands of their own; the rest are "Other". */
export const STREAM_BANDS = 8;
/** Genres named per bucket for what "Other" holds. */
const OTHER_NAMED = 3;

export interface GenreStream {
  bucket: DiscoveryBucket;
  /** The period's most played genres, most first: the bands, in order. */
  genres: string[];
  buckets: {
    start: string;
    /** Plays per band, in `genres` order. */
    counts: number[];
    other: number;
    /** The biggest genres inside `other` in this bucket. */
    other_top: GenreCount[];
  }[];
  /** Plays in the period, and how many of them have a genre. */
  plays: number;
  plays_with_genres: number;
}

/**
 * Plays per genre per week, month or year of the period (the same bucket
 * sizes as Discovery), for the top genres and "Other".
 */
export async function getGenreStream(userId: string, from: string | null, to: string | null): Promise<GenreStream> {
  const pg = playGenres('m');
  const range = M_RANGE;
  const localDay = `(m.played_at AT TIME ZONE m.timezone)::date`;
  const span = await query(
    `SELECT MIN(${localDay})::text AS first, MAX(${localDay})::text AS last, COUNT(*)::int AS plays,
            COUNT(*) FILTER (WHERE cardinality(${pg.genres}) > 0)::int AS with_genres
     FROM music_scrobbles m ${pg.join} WHERE m.user_id = $1 ${range}`,
    [userId, from, to],
  );
  const { first, last, plays, with_genres: withGenres } = span.rows[0];
  if (!first || !last) return { bucket: 'month', genres: [], buckets: [], plays: 0, plays_with_genres: 0 };
  const bucket = discoveryBucket(from ?? first, to ?? last);
  const start = from ?? first;
  const end = to ?? last;

  // $1 user, $2/$3 range, $4 bucket unit, $5/$6 the series' first and last day.
  const r = await query(
    `WITH counted AS (
       SELECT date_trunc($4::text, (${localDay})::timestamp)::date AS start, g AS genre, COUNT(*)::int AS plays
       FROM music_scrobbles m ${pg.join} CROSS JOIN LATERAL unnest(${pg.genres}) AS g
       WHERE m.user_id = $1 ${range}
       GROUP BY 1, 2
     ),
     buckets AS (
       SELECT generate_series(date_trunc($4::text, ($5::date)::timestamp), date_trunc($4::text, ($6::date)::timestamp), ('1 ' || $4::text)::interval)::date AS start
     )
     SELECT b.start::text AS start,
            COALESCE(jsonb_object_agg(c.genre, c.plays) FILTER (WHERE c.genre IS NOT NULL), '{}') AS counts
     FROM buckets b LEFT JOIN counted c USING (start)
     GROUP BY b.start ORDER BY b.start`,
    [userId, from, to, bucket, start, end],
  );
  const rows = r.rows as { start: string; counts: Record<string, number> }[];
  const totals = new Map<string, number>();
  for (const row of rows) for (const [g, n] of Object.entries(row.counts)) totals.set(g, (totals.get(g) ?? 0) + n);
  const genres = [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, STREAM_BANDS)
    .map(([g]) => g);
  const banded = new Set(genres);
  return {
    bucket,
    genres,
    buckets: rows.map((row) => {
      const rest = Object.entries(row.counts)
        .filter(([g]) => !banded.has(g))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return {
        start: row.start,
        counts: genres.map((g) => row.counts[g] ?? 0),
        other: rest.reduce((n, [, c]) => n + c, 0),
        other_top: rest.slice(0, OTHER_NAMED).map(([name, n]) => ({ name, plays: n })),
      };
    }),
    plays,
    plays_with_genres: withGenres,
  };
}

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

export interface GenreBackupRow {
  kind: GenreKind;
  item_key: string;
  status: 'matched' | 'not_found' | null;
  mbid: string | null;
  catalog_genres: string[];
  user_genres: string[] | null;
}

export async function exportGenres(userId: string): Promise<GenreBackupRow[]> {
  const r = await query(
    `SELECT kind, item_key, status, mbid, catalog_genres, user_genres
     FROM music_genres WHERE user_id = $1 ORDER BY kind, item_key`,
    [userId],
  );
  return r.rows;
}

/**
 * Restore genre rows inside the restore transaction. A lookup already on this
 * server wins; the user's edits from the backup fill in where there are none.
 */
export async function importGenres(db: { query: typeof query }, userId: string, rows: unknown): Promise<number> {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const raw of rows) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const kind = r.kind === 'album' || r.kind === 'artist' ? r.kind : null;
    const key = typeof r.item_key === 'string' && r.item_key.length <= 1000 ? r.item_key : null;
    if (!kind || !key) continue;
    const status = r.status === 'matched' || r.status === 'not_found' ? r.status : null;
    const mbid = typeof r.mbid === 'string' && /^[0-9a-f-]{36}$/i.test(r.mbid) ? r.mbid : null;
    const catalog = cleanGenreList(r.catalog_genres);
    const user = Array.isArray(r.user_genres) ? cleanGenreList(r.user_genres, 20) : null;
    if (!status && user === null) continue;
    const result = await db.query(
      `INSERT INTO music_genres (user_id, kind, item_key, status, mbid, catalog_genres, user_genres, looked_up_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (user_id, kind, item_key) DO UPDATE SET
         status = COALESCE(music_genres.status, EXCLUDED.status),
         mbid = CASE WHEN music_genres.status IS NULL THEN EXCLUDED.mbid ELSE music_genres.mbid END,
         catalog_genres = CASE WHEN music_genres.status IS NULL THEN EXCLUDED.catalog_genres ELSE music_genres.catalog_genres END,
         looked_up_at = COALESCE(music_genres.looked_up_at, EXCLUDED.looked_up_at),
         user_genres = COALESCE(music_genres.user_genres, EXCLUDED.user_genres)`,
      [userId, kind, key, status, mbid, catalog, user],
    );
    n += result.rowCount ?? 0;
  }
  return n;
}
