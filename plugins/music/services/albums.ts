/**
 * Music plugin — album artwork and release info.
 *
 * Albums are looked up once each against public catalogs (see
 * albumProviders.ts) and cached in `music_albums`: the metadata and tracklist
 * in the row, a small thumbnail on disk, and the large cover on disk the first
 * time it is opened. Lookups run as a user-started backfill (Settings → Music)
 * or, for albums on a newly arrived scrobble, in the background after the
 * response has been sent.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { query } from '../../../server/src/db';
import { config } from '../../../server/src/config';
import { normalizeTitle, type AlbumMatch } from './albumMatch';
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
       (user_id, album_key, status, provider, external_id, title, artist, release_date, label, tracks, thumb_file, large_url)
     VALUES ($1, $2, 'matched', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     ON CONFLICT (user_id, album_key) DO UPDATE SET
       status = 'matched', provider = EXCLUDED.provider, external_id = EXCLUDED.external_id,
       title = EXCLUDED.title, artist = EXCLUDED.artist, release_date = EXCLUDED.release_date,
       label = EXCLUDED.label, tracks = EXCLUDED.tracks, thumb_file = EXCLUDED.thumb_file,
       large_url = EXCLUDED.large_url, looked_up_at = NOW()`,
    [
      userId, target.album_key, match.provider, match.externalId, match.title, match.artist,
      match.releaseDate, match.label, JSON.stringify(match.tracks),
      haveThumb ? thumbName : null, match.largeUrl,
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
// Backfill job
// ---------------------------------------------------------------------------

export interface BackfillStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  processed: number;
  total: number;
  matched: number;
  not_found: number;
  error: string | null;
}

const BATCH = 25;
let status: BackfillStatus = { state: 'idle', processed: 0, total: 0, matched: 0, not_found: 0, error: null };
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
  status = { state: 'running', processed: 0, total, matched: 0, not_found: 0, error: null };
  running = (async () => {
    try {
      await collectOrphanArt();
      // Re-query each round: albums that arrived meanwhile are picked up too.
      for (;;) {
        const batch = (await query(
          `${UNLOOKED} GROUP BY m.album_key ORDER BY plays DESC, m.album_key LIMIT ${BATCH}`,
          [userId],
        )).rows as Target[];
        if (batch.length === 0) break;
        for (const target of batch) {
          if (cancelRequested) {
            status.state = 'cancelled';
            return;
          }
          const outcome = await lookupOne(userId, target);
          status[outcome === 'matched' ? 'matched' : 'not_found']++;
          status.processed++;
          status.total = Math.max(status.total, status.processed);
        }
      }
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

export interface AlbumDetail {
  id: string;
  title: string;
  artist: string;
  release_date: string | null;
  label: string | null;
  plays: number;
  listened_seconds: number;
  tracks: { position: number; title: string; length: number | null; plays: number }[];
}

/** Everything the album modal shows, with the user's own play counts. */
export async function getAlbumDetail(userId: string, id: string): Promise<AlbumDetail | null> {
  const found = await query(
    `SELECT id, provider, external_id, title, artist, release_date, label, tracks
     FROM music_albums WHERE user_id = $1 AND id = $2 AND status = 'matched'`,
    [userId, id],
  );
  const album = found.rows[0];
  if (!album) return null;
  // Every local key that resolved to this release counts (a soundtrack
  // imported with a different artist per track is several keys).
  const played = await query(
    `SELECT MIN(m.title) AS title, COUNT(*)::int AS plays,
            COALESCE(SUM(COALESCE(m.listened_for, m.track_length, 0)), 0)::int AS seconds
     FROM music_scrobbles m
     JOIN music_albums a ON a.user_id = m.user_id AND a.album_key = m.album_key
     WHERE a.user_id = $1 AND a.provider = $2 AND a.external_id = $3
     GROUP BY lower(m.title)`,
    [userId, album.provider, album.external_id],
  );
  const playsByTitle = new Map<string, number>();
  let plays = 0;
  let seconds = 0;
  for (const r of played.rows) {
    const key = normalizeTitle(r.title);
    playsByTitle.set(key, (playsByTitle.get(key) ?? 0) + r.plays);
    plays += r.plays;
    seconds += r.seconds;
  }
  return {
    id: album.id,
    title: album.title,
    artist: album.artist,
    release_date: album.release_date,
    label: album.label,
    plays,
    listened_seconds: seconds,
    tracks: (album.tracks as { position: number; title: string; length: number | null }[]).map((t) => ({
      ...t,
      plays: playsByTitle.get(normalizeTitle(t.title)) ?? 0,
    })),
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
