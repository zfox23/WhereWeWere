/**
 * Music plugin — album artwork, release info and track lengths.
 *
 * Albums are looked up once each against public catalogs (see
 * albumProviders.ts) and cached in `music_albums`: the metadata and tracklist
 * in the row, a small thumbnail on disk, and the large cover on disk the first
 * time it is opened. Lookups run as a user-started backfill (Settings → Music)
 * or, for albums on a newly arrived scrobble, in the background after the
 * response has been sent.
 *
 * A matched album's tracklist also supplies lengths for plays that have none
 * (imports), which listening time falls back to. Lengths are only ever filled
 * in, never overwritten, so those sent by multi-scrobbler stay as they are.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../../server/src/db';
import { config } from '../../../server/src/config';
import { normalizeTitle, type AlbumMatch } from './albumMatch';
import { albumRefSql, songKeySql, UNKNOWN_ALBUM } from './identity';
import {
  ProviderUnavailableError,
  chainProviders,
  createDeezerProvider,
  createMusicBrainzProvider,
  type AlbumProvider,
  type FetchLike,
} from './albumProviders';

export type ImageFetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface AlbumDeps {
  provider: AlbumProvider;
  fetchImage: ImageFetch;
}

const THUMB_PX = 96;
const LARGE_PX = 1200;

function realDeps(): AlbumDeps {
  const fetchJson: FetchLike = (url, init) => fetch(url, init);
  return {
    provider: chainProviders([createDeezerProvider(fetchJson), createMusicBrainzProvider(fetchJson)]),
    fetchImage: (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
  };
}

// Tests never reach the network: they inject deps with `setAlbumDeps`.
let deps: AlbumDeps | null = process.env.NODE_ENV === 'test' ? null : realDeps();

export function setAlbumDeps(next: AlbumDeps | null): void {
  deps = next;
}

export const albumLookupEnabled = () => deps !== null;

// ---------------------------------------------------------------------------
// Art files
// ---------------------------------------------------------------------------

const artDir = () => path.join(config.dataDir, 'music-art');
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
export const artFileName = (provider: string, externalId: string, size: 'thumb' | 'large') =>
  `${provider}-${safe(externalId)}-${size}.jpg`;
export const artPath = (file: string) => path.join(artDir(), path.basename(file));

async function downloadImage(url: string, px: number, quality: number, fit: 'cover' | 'inside', file: string): Promise<boolean> {
  if (!deps) return false;
  let res;
  try {
    res = await deps.fetchImage(url);
  } catch (err) {
    throw new ProviderUnavailableError(`Couldn't download artwork: ${err instanceof Error ? err.message : 'network error'}`);
  }
  if (res.status >= 500) throw new ProviderUnavailableError(`Artwork host returned HTTP ${res.status}`);
  if (!res.ok) return false; // no cover for this release
  try {
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(px, px, { fit, withoutEnlargement: fit === 'inside' })
      .jpeg({ quality })
      .toBuffer();
    fs.mkdirSync(artDir(), { recursive: true });
    fs.writeFileSync(artPath(file), jpeg);
    return true;
  } catch {
    return false; // not an image
  }
}

/** Serve-time path of an album's large cover, fetching and caching it on first use. */
export async function ensureLargeArt(album: { provider: string; external_id: string; large_url: string | null }): Promise<string | null> {
  const file = artFileName(album.provider, album.external_id, 'large');
  if (fs.existsSync(artPath(file))) return artPath(file);
  if (!album.large_url) return null;
  return (await downloadImage(album.large_url, LARGE_PX, 88, 'inside', file)) ? artPath(file) : null;
}

/** Remove art files no album row refers to (after a start-over or a re-match). */
export async function collectOrphanArt(): Promise<number> {
  if (!fs.existsSync(artDir())) return 0;
  const used = new Set(
    (await query(`SELECT provider, external_id FROM music_albums WHERE status = 'matched' AND provider IS NOT NULL`)).rows.flatMap(
      (r: { provider: string; external_id: string }) => [
        artFileName(r.provider, r.external_id, 'thumb'),
        artFileName(r.provider, r.external_id, 'large'),
      ],
    ),
  );
  let removed = 0;
  for (const file of fs.readdirSync(artDir())) {
    if (!used.has(file)) {
      fs.rmSync(path.join(artDir(), file), { force: true });
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

interface Target {
  album_key: string;
  album: string;
  artist: string;
}

async function storeMatch(userId: string, target: Target, match: AlbumMatch): Promise<void> {
  const thumbName = artFileName(match.provider, match.externalId, 'thumb');
  const haveThumb =
    fs.existsSync(artPath(thumbName)) ||
    (match.thumbUrl ? await downloadImage(match.thumbUrl, THUMB_PX, 78, 'cover', thumbName) : false);
  await query(
    `INSERT INTO music_albums
       (user_id, album_key, status, provider, external_id, title, artist, release_date, label, tracks, thumb_file, large_url, thumb_url)
     VALUES ($1, $2, 'matched', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (user_id, album_key) DO UPDATE SET
       status = 'matched', provider = EXCLUDED.provider, external_id = EXCLUDED.external_id,
       title = EXCLUDED.title, artist = EXCLUDED.artist, release_date = EXCLUDED.release_date,
       label = EXCLUDED.label, tracks = EXCLUDED.tracks, thumb_file = EXCLUDED.thumb_file,
       large_url = EXCLUDED.large_url, thumb_url = EXCLUDED.thumb_url, looked_up_at = NOW()`,
    [
      userId, target.album_key, match.provider, match.externalId, match.title, match.artist,
      match.releaseDate, match.label, JSON.stringify(match.tracks),
      haveThumb ? thumbName : null, match.largeUrl, haveThumb ? match.thumbUrl : null,
    ],
  );
}

/** Look one album up. Throws ProviderUnavailableError when a catalog can't be reached. */
async function lookupOne(userId: string, target: Target): Promise<'matched' | 'not_found'> {
  if (!deps) throw new ProviderUnavailableError('Album lookup is disabled');
  const played = await query(
    `SELECT DISTINCT title FROM music_scrobbles WHERE user_id = $1 AND album_key = $2 LIMIT 60`,
    [userId, target.album_key],
  );
  const match = await deps.provider.find({
    album: target.album,
    artist: target.artist,
    titles: played.rows.map((r: { title: string }) => r.title),
  });
  if (match) {
    await storeMatch(userId, target, match);
    const filled = await fillTrackLengths(userId, target.album_key);
    if (status.state === 'running') status.durations_filled += filled;
    return 'matched';
  }
  await query(
    `INSERT INTO music_albums (user_id, album_key, status) VALUES ($1, $2, 'not_found')
     ON CONFLICT (user_id, album_key) DO UPDATE SET status = 'not_found', looked_up_at = NOW()`,
    [userId, target.album_key],
  );
  return 'not_found';
}

const UNLOOKED = `
  SELECT m.album_key,
         MIN(m.album) AS album,
         (ARRAY_AGG(COALESCE(m.album_artists[1], m.artists[1]) ORDER BY m.played_at DESC))[1] AS artist,
         COUNT(*)::int AS plays
  FROM music_scrobbles m
  LEFT JOIN music_albums a ON a.user_id = m.user_id AND a.album_key = m.album_key
  WHERE m.user_id = $1 AND m.album_key IS NOT NULL AND a.album_key IS NULL`;

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

export interface AlbumBackupRow {
  album_key: string;
  status: 'matched' | 'not_found';
  provider: string | null;
  external_id: string | null;
  title: string | null;
  artist: string | null;
  release_date: string | null;
  label: string | null;
  tracks: { position: number; title: string; length: number | null }[];
  large_url: string | null;
  thumb_url: string | null;
  /** Whether a thumbnail file ships with the backup (named by provider + external id). */
  has_thumb: boolean;
}

export async function exportAlbums(userId: string): Promise<AlbumBackupRow[]> {
  const result = await query(
    `SELECT album_key, status, provider, external_id, title, artist, release_date, label, tracks,
            large_url, thumb_url, thumb_file
     FROM music_albums WHERE user_id = $1 ORDER BY album_key`,
    [userId],
  );
  return result.rows.map(({ thumb_file, ...row }) => ({
    ...row,
    has_thumb: Boolean(thumb_file) && fs.existsSync(artPath(thumb_file)),
  }));
}

/** Thumbnail files to bundle in a ZIP backup, one per distinct release. */
export async function listThumbnailFiles(userId: string): Promise<{ zipPath: string; absPath: string }[]> {
  const result = await query(
    `SELECT DISTINCT thumb_file FROM music_albums WHERE user_id = $1 AND status = 'matched' AND thumb_file IS NOT NULL`,
    [userId],
  );
  return result.rows
    .map((r: { thumb_file: string }) => r.thumb_file)
    .filter((file: string) => fs.existsSync(artPath(file)))
    .map((file: string) => ({ zipPath: `thumbnails/${file}`, absPath: artPath(file) }));
}

const PROVIDERS = new Set(['deezer', 'musicbrainz']);
const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

/**
 * Restore album rows (and, from a ZIP backup, their thumbnails) inside the
 * restore transaction. Existing rows win. A row without its thumbnail keeps
 * its `thumb_url`, so the next metadata update downloads it again.
 */
export async function importAlbums(
  db: { query: typeof query },
  userId: string,
  rows: unknown,
  filesDir?: string,
): Promise<number> {
  if (!Array.isArray(rows)) return 0;
  let inserted = 0;
  for (const raw of rows) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const key = text(r.album_key, 1000);
    if (!key || (r.status !== 'matched' && r.status !== 'not_found')) continue;
    let provider: string | null = null;
    let externalId: string | null = null;
    let tracks: unknown[] = [];
    let thumbFile: string | null = null;
    if (r.status === 'matched') {
      provider = text(r.provider, 20);
      externalId = text(r.external_id, 200);
      if (!provider || !PROVIDERS.has(provider) || !externalId) continue;
      tracks = (Array.isArray(r.tracks) ? r.tracks : []).slice(0, 500).flatMap((t: any, i: number) => {
        const title = text(t?.title, 500);
        const length = Number(t?.length);
        return title
          ? [{ position: Number(t?.position) || i + 1, title, length: Number.isFinite(length) && length > 0 ? Math.round(length) : null }]
          : [];
      });
      // The file name is derived, never taken from the backup.
      const file = artFileName(provider, externalId, 'thumb');
      const dest = artPath(file);
      if (!fs.existsSync(dest) && filesDir && r.has_thumb === true) {
        const src = path.resolve(filesDir, 'thumbnails', file);
        if (src.startsWith(path.resolve(filesDir) + path.sep) && fs.existsSync(src)) {
          fs.mkdirSync(artDir(), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      if (fs.existsSync(dest)) thumbFile = file;
    }
    const result = await db.query(
      `INSERT INTO music_albums
         (user_id, album_key, status, provider, external_id, title, artist, release_date, label, tracks, thumb_file, large_url, thumb_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       ON CONFLICT (user_id, album_key) DO NOTHING`,
      [
        userId, key, r.status, provider, externalId, text(r.title), text(r.artist), text(r.release_date, 20), text(r.label),
        JSON.stringify(tracks), thumbFile, text(r.large_url, 2000), text(r.thumb_url, 2000),
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/** Download thumbnails that matched albums should have but don't (after a restore without images). */
export async function repairThumbnails(userId: string): Promise<number> {
  const missing = await query(
    `SELECT id, provider, external_id, thumb_url FROM music_albums
     WHERE user_id = $1 AND status = 'matched' AND thumb_file IS NULL AND thumb_url IS NOT NULL`,
    [userId],
  );
  let repaired = 0;
  for (const a of missing.rows as { id: string; provider: string; external_id: string; thumb_url: string }[]) {
    const file = artFileName(a.provider, a.external_id, 'thumb');
    if (fs.existsSync(artPath(file)) || (await downloadImage(a.thumb_url, THUMB_PX, 78, 'cover', file))) {
      await query(`UPDATE music_albums SET thumb_file = $2 WHERE id = $1`, [a.id, file]);
      repaired++;
    }
  }
  return repaired;
}

// ---------------------------------------------------------------------------
// Track lengths
// ---------------------------------------------------------------------------

const FILL_BATCH = 2000;

/**
 * Give plays without a length the length of the same track on their matched
 * album's tracklist (all albums, or just `albumKey`), then refresh the
 * listening time of the sessions they belong to. Returns plays updated.
 */
export async function fillTrackLengths(userId: string, albumKey?: string): Promise<number> {
  const albums = await query(
    `SELECT a.album_key, a.tracks, ARRAY_AGG(DISTINCT m.title) AS titles
     FROM music_albums a
     JOIN music_scrobbles m ON m.user_id = a.user_id AND m.album_key = a.album_key AND m.track_length IS NULL
     WHERE a.user_id = $1 AND a.status = 'matched' AND ($2::text IS NULL OR a.album_key = $2)
     GROUP BY a.album_key, a.tracks`,
    [userId, albumKey ?? null],
  );
  const keys: string[] = [];
  const titles: string[] = [];
  const lengths: number[] = [];
  for (const row of albums.rows as { album_key: string; tracks: { title: string; length: number | null }[]; titles: string[] }[]) {
    const byTitle = new Map<string, number>();
    for (const t of row.tracks) {
      const norm = normalizeTitle(t.title);
      if (t.length && t.length > 0 && !byTitle.has(norm)) byTitle.set(norm, t.length);
    }
    for (const title of row.titles) {
      const length = byTitle.get(normalizeTitle(title));
      if (length) {
        keys.push(row.album_key);
        titles.push(title);
        lengths.push(length);
      }
    }
  }
  let updated = 0;
  const sessions = new Set<string>();
  for (let i = 0; i < keys.length; i += FILL_BATCH) {
    const result = await query(
      `UPDATE music_scrobbles m SET track_length = v.len
       FROM unnest($2::text[], $3::text[], $4::int[]) AS v(key, title, len)
       WHERE m.user_id = $1 AND m.album_key = v.key AND m.title = v.title AND m.track_length IS NULL
       RETURNING m.session_id`,
      [userId, keys.slice(i, i + FILL_BATCH), titles.slice(i, i + FILL_BATCH), lengths.slice(i, i + FILL_BATCH)],
    );
    updated += result.rowCount ?? 0;
    for (const r of result.rows) if (r.session_id) sessions.add(r.session_id);
  }
  if (sessions.size > 0) {
    await query(
      `UPDATE music_sessions s SET listened_seconds = t.seconds
       FROM (SELECT session_id, COALESCE(SUM(COALESCE(listened_for, track_length)), 0)::int AS seconds
             FROM music_scrobbles WHERE user_id = $1 AND session_id = ANY($2::uuid[]) GROUP BY session_id) t
       WHERE s.id = t.session_id`,
      [userId, [...sessions]],
    );
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Backfill job
// ---------------------------------------------------------------------------

export interface BackfillStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  processed: number;
  total: number;
  matched: number;
  not_found: number;
  /** Albums left for next time because a catalog was unavailable for them. */
  skipped: number;
  /** Plays that were given a track length from an album's tracklist. */
  durations_filled: number;
  /** Thumbnails downloaded again after a restore without images. */
  thumbnails_restored: number;
  error: string | null;
}

const BATCH = 25;
const MAX_FAILURES_IN_A_ROW = 5;
let status: BackfillStatus = { state: 'idle', processed: 0, total: 0, matched: 0, not_found: 0, skipped: 0, durations_filled: 0, thumbnails_restored: 0, error: null };
let cancelRequested = false;
let running: Promise<void> | null = null;

export const getBackfillStatus = (): BackfillStatus => ({ ...status });
export const cancelBackfill = (): void => {
  if (status.state === 'running') cancelRequested = true;
};
export const whenBackfillDone = (): Promise<void> => running ?? Promise.resolve();

/**
 * Start looking up every album that hasn't been looked up, most played first.
 * `retryMissing` first forgets earlier "not found" results.
 */
export async function startBackfill(userId: string, opts: { retryMissing?: boolean } = {}): Promise<BackfillStatus> {
  if (!deps) throw new ProviderUnavailableError('Album lookup is disabled');
  if (status.state === 'running') throw new Error('A lookup is already running');
  if (opts.retryMissing) await query(`DELETE FROM music_albums WHERE user_id = $1 AND status = 'not_found'`, [userId]);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM (${UNLOOKED} GROUP BY m.album_key) u`, [userId])).rows[0].n;
  cancelRequested = false;
  status = { state: 'running', processed: 0, total, matched: 0, not_found: 0, skipped: 0, durations_filled: 0, thumbnails_restored: 0, error: null };
  running = (async () => {
    try {
      await collectOrphanArt();
      // Albums a catalog couldn't answer for are left for the next run; a few
      // in a row means the catalog is down, so stop rather than skip them all.
      const skipped: string[] = [];
      let failuresInARow = 0;
      // Re-query each round: albums that arrived meanwhile are picked up too.
      for (;;) {
        const batch = (await query(
          `${UNLOOKED} AND NOT (m.album_key = ANY($2::text[])) GROUP BY m.album_key ORDER BY plays DESC, m.album_key LIMIT ${BATCH}`,
          [userId, skipped],
        )).rows as Target[];
        if (batch.length === 0) break;
        for (const target of batch) {
          if (cancelRequested) {
            status.state = 'cancelled';
            return;
          }
          try {
            const outcome = await lookupOne(userId, target);
            failuresInARow = 0;
            status[outcome === 'matched' ? 'matched' : 'not_found']++;
          } catch (err) {
            if (!(err instanceof ProviderUnavailableError)) throw err;
            skipped.push(target.album_key);
            status.skipped++;
            if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) throw err;
          }
          status.processed++;
          status.total = Math.max(status.total, status.processed);
        }
      }
      // Albums matched in earlier runs may have lengths the plays still lack.
      status.thumbnails_restored += await repairThumbnails(userId);
      status.durations_filled += await fillTrackLengths(userId);
      status.state = 'done';
    } catch (err) {
      status.state = 'error';
      status.error = err instanceof Error ? err.message : 'Lookup failed';
    }
  })();
  return getBackfillStatus();
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

/**
 * Fire-and-forget lookup for a just-stored scrobble's album (its `album_key`).
 * Never throws and never delays the caller; a no-op when the album has already
 * been looked up.
 */
export function lookupAlbumSoon(userId: string, albumKey: string | null | undefined): void {
  if (!deps || !albumKey) return;
  const flight = `${userId}:${albumKey}`;
  if (inFlight.has(flight)) return;
  inFlight.add(flight);
  void (async () => {
    try {
      const target = (await query(`${UNLOOKED} AND m.album_key = $2 GROUP BY m.album_key`, [userId, albumKey])).rows[0];
      if (target) await lookupOne(userId, target as Target);
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) console.error('Error looking up album art:', err);
    } finally {
      inFlight.delete(flight);
    }
  })();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getAlbumCounts(userId: string) {
  const [total, byStatus] = await Promise.all([
    query(`SELECT COUNT(DISTINCT album_key)::int AS n FROM music_scrobbles WHERE user_id = $1 AND album_key IS NOT NULL`, [userId]),
    query(`SELECT status, COUNT(*)::int AS n FROM music_albums WHERE user_id = $1 GROUP BY status`, [userId]),
  ]);
  const count = (s: string) => byStatus.rows.find((r: { status: string }) => r.status === s)?.n ?? 0;
  const matched = count('matched');
  const notFound = count('not_found');
  return { total: total.rows[0].n as number, matched, not_found: notFound, pending: Math.max(0, total.rows[0].n - matched - notFound) };
}

export interface AlbumViewTrack {
  /** Catalog track number; null for plays that aren't on the matched tracklist. */
  position: number | null;
  title: string;
  artists: string[];
  length: number | null;
  plays: number;
  /** Identity for adding to a list; null for catalog tracks never played. */
  song_key: string | null;
}

export interface AlbumView {
  /** Identity of this album, handed back when adding it to a list. */
  album_ref: string;
  /** Cover id, when the album has one. */
  art_id: string | null;
  /** Whether a catalog (Deezer / MusicBrainz) match backs the details below. */
  matched: boolean;
  title: string;
  artist: string;
  release_date: string | null;
  label: string | null;
  plays: number;
  listened_seconds: number;
  tracks: AlbumViewTrack[];
}

/**
 * Everything the album modal shows, for an album identified by `ref` (or by the
 * cover id of a matched one). The user's own plays always drive it; a catalog
 * match only adds the cover, release info and the full tracklist.
 */
export async function getAlbumView(userId: string, id: { ref?: string; artId?: string }): Promise<AlbumView | null> {
  let ref = id.ref ?? null;
  if (id.artId) {
    const row = (await query(`SELECT album_key FROM music_albums WHERE user_id = $1 AND id = $2 AND status = 'matched'`, [userId, id.artId])).rows[0];
    if (!row) return null;
    ref = row.album_key;
  }
  if (ref === null) return null;

  const matchedRow = (await query(
    `SELECT id, provider, external_id, title, artist, release_date, label, tracks, thumb_file
     FROM music_albums WHERE user_id = $1 AND album_key = $2 AND status = 'matched'`,
    [userId, ref],
  )).rows[0];
  // Every local key that resolved to this release counts (a soundtrack
  // imported with a different artist per track is several keys).
  const refs: string[] = matchedRow
    ? (await query(
        `SELECT album_key FROM music_albums WHERE user_id = $1 AND status = 'matched' AND provider = $2 AND external_id = $3`,
        [userId, matchedRow.provider, matchedRow.external_id],
      )).rows.map((r: { album_key: string }) => r.album_key)
    : [ref];

  const played = (await query(
    `SELECT ${songKeySql()} AS song_key, MIN(title) AS title, MIN(artists) AS artists, COUNT(*)::int AS plays,
            COALESCE(SUM(COALESCE(listened_for, track_length, 0)), 0)::int AS seconds,
            MAX(track_length) AS length, MIN(album) AS album, MIN(COALESCE(album_artists[1], artists[1])) AS album_artist
     FROM music_scrobbles WHERE user_id = $1 AND ${albumRefSql()} = ANY($2::text[])
     GROUP BY ${songKeySql()}`,
    [userId, refs],
  )).rows as {
    song_key: string; title: string; artists: string[]; plays: number; seconds: number;
    length: number | null; album: string | null; album_artist: string;
  }[];
  if (played.length === 0 && !matchedRow) return null;

  const plays = played.reduce((n, r) => n + r.plays, 0);
  const seconds = played.reduce((n, r) => n + r.seconds, 0);
  const albumArtist = matchedRow?.artist ?? played[0]?.album_artist ?? '';
  const byTitle = new Map<string, typeof played>();
  for (const r of played) {
    const key = normalizeTitle(r.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), r]);
  }
  const fromPlays = (rows: typeof played, position: number | null, catalogLength: number | null): AlbumViewTrack => {
    const top = [...rows].sort((a, b) => b.plays - a.plays)[0];
    return {
      position,
      title: top.title,
      artists: top.artists,
      length: catalogLength ?? top.length,
      plays: rows.reduce((n, r) => n + r.plays, 0),
      song_key: top.song_key,
    };
  };

  let tracks: AlbumViewTrack[];
  if (matchedRow) {
    const used = new Set<string>();
    tracks = (matchedRow.tracks as { position: number; title: string; length: number | null }[]).map((t) => {
      const key = normalizeTitle(t.title);
      const rows = byTitle.get(key);
      if (rows) used.add(key);
      return rows
        ? { ...fromPlays(rows, t.position, t.length), title: t.title }
        : { position: t.position, title: t.title, artists: [albumArtist], length: t.length, plays: 0, song_key: null };
    });
    // Plays that aren't on the catalog's tracklist (bonus tracks, other editions).
    tracks.push(
      ...[...byTitle].filter(([key]) => !used.has(key)).map(([, rows]) => fromPlays(rows, null, null)).sort((a, b) => b.plays - a.plays),
    );
  } else {
    tracks = [...byTitle.values()].map((rows) => fromPlays(rows, null, null)).sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title));
  }

  const albumName = matchedRow?.title ?? played.find((r) => r.album)?.album ?? null;
  return {
    album_ref: ref,
    art_id: matchedRow?.thumb_file ? matchedRow.id : null,
    matched: Boolean(matchedRow),
    title: albumName ?? UNKNOWN_ALBUM,
    artist: albumArtist,
    release_date: matchedRow?.release_date ?? null,
    label: matchedRow?.label ?? null,
    plays,
    listened_seconds: seconds,
    tracks,
  };
}

export async function getAlbumArtFile(userId: string, id: string, size: 'thumb' | 'large'): Promise<string | null> {
  const r = await query(
    `SELECT provider, external_id, thumb_file, large_url FROM music_albums WHERE user_id = $1 AND id = $2 AND status = 'matched'`,
    [userId, id],
  );
  const album = r.rows[0];
  if (!album) return null;
  if (size === 'thumb') {
    return album.thumb_file && fs.existsSync(artPath(album.thumb_file)) ? artPath(album.thumb_file) : null;
  }
  return ensureLargeArt(album);
}
