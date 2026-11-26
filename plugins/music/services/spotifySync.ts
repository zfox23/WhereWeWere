/**
 * Music plugin — copying the user's Spotify playlists into WhereWeWere.
 *
 * A sync reads every playlist in the user's library (`GET /me/playlists`, in
 * Spotify's order), keeps their metadata, and re-reads the tracks of each one
 * whose snapshot changed since the last sync. Spotify only lists the tracks
 * of playlists the user owns or collaborates on (for Development Mode apps);
 * the others are kept with their metadata only.
 *
 * Syncs run from the "Sync now" button (the `spotify-sync` job) and once a day
 * for every connected user.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { pool, query } from '../../../server/src/db';
import { config } from '../../../server/src/config';
import { runAsUser } from '../../../server/src/auth/context';
import { getAccount, spotifyApi, SpotifyError, userAccessToken, NOT_CONNECTED } from './spotifyApi';

export const SPOTIFY_SYNC_JOB = 'spotify-sync';

const PAGE = 50;

// ---------------------------------------------------------------------------
// Reading Spotify's answers (both the February 2026 shapes and the older ones)
// ---------------------------------------------------------------------------

interface SpotifyImage {
  url?: unknown;
  width?: unknown;
}

/** The image to show at about 160px: the smallest at least that wide, else the largest. */
export function pickImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const valid = (images as SpotifyImage[]).filter((i) => i && typeof i.url === 'string' && /^https:\/\//.test(i.url as string));
  if (valid.length === 0) return null;
  const sized = valid.filter((i) => typeof i.width === 'number');
  if (sized.length === 0) return valid[0].url as string;
  const big = sized.filter((i) => (i.width as number) >= 160).sort((a, b) => (a.width as number) - (b.width as number));
  return (big[0] ?? sized.sort((a, b) => (b.width as number) - (a.width as number))[0]).url as string;
}

export interface PlaylistSummary {
  spotify_id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  image_url: string | null;
  collaborative: boolean;
  public: boolean | null;
  snapshot_id: string | null;
  total_tracks: number | null;
}

/** One entry of `GET /me/playlists`, or null when it isn't a usable playlist. */
export function parsePlaylist(p: unknown): PlaylistSummary | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, any>;
  if (typeof o.id !== 'string' || !o.id) return null;
  // February 2026 renamed `tracks` to `items` ({ href, total }).
  const ref = [o.items, o.tracks].find((x) => x && typeof x === 'object' && !Array.isArray(x));
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    spotify_id: o.id,
    name: text(o.name) ?? 'Untitled playlist',
    description: text(o.description),
    owner_id: text(o.owner?.id),
    owner_name: text(o.owner?.display_name) ?? text(o.owner?.id),
    image_url: pickImage(o.images),
    collaborative: o.collaborative === true,
    public: typeof o.public === 'boolean' ? o.public : null,
    snapshot_id: text(o.snapshot_id),
    total_tracks: Number.isInteger(ref?.total) ? ref.total : null,
  };
}

export interface PlaylistTrack {
  spotify_id: string | null;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number | null;
  added_at: string | null;
  is_local: boolean;
}

/** One entry of a playlist's items, or null for episodes and removed tracks. */
export function parsePlaylistEntry(e: unknown): PlaylistTrack | null {
  if (!e || typeof e !== 'object') return null;
  const entry = e as Record<string, any>;
  // February 2026 moved the track to `item`; `track` may now be a boolean.
  const t = [entry.item, entry.track].find((x) => x && typeof x === 'object');
  if (!t || (t.type !== undefined && t.type !== 'track')) return null;
  const title = typeof t.name === 'string' ? t.name.trim() : '';
  if (!title) return null;
  const isLocal = entry.is_local === true || t.is_local === true;
  const artists = (Array.isArray(t.artists) ? t.artists : [])
    .map((a: { name?: unknown }) => (typeof a?.name === 'string' ? a.name.trim() : ''))
    .filter(Boolean);
  const added = typeof entry.added_at === 'string' && !Number.isNaN(Date.parse(entry.added_at)) ? entry.added_at : null;
  return {
    spotify_id: !isLocal && typeof t.id === 'string' && t.id ? t.id : null,
    title,
    artists,
    album: typeof t.album?.name === 'string' && t.album.name.trim() ? t.album.name : null,
    duration_ms: Number.isInteger(t.duration_ms) && t.duration_ms > 0 ? t.duration_ms : null,
    // Spotify dates tracks added before 2009 (and some generated playlists) at the epoch.
    added_at: added && Date.parse(added) > 0 ? added : null,
    is_local: isLocal,
  };
}

/** Every page of a paged Spotify list, following `next`. */
async function allPages<T>(token: string, first: string, isCancelled: () => boolean): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  while (next) {
    if (isCancelled()) throw new Error('cancelled');
    const page: { items?: T[]; next?: string | null } = await spotifyApi(token, next);
    out.push(...(page?.items ?? []));
    next = typeof page?.next === 'string' ? page.next : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

export interface SpotifySyncSummary {
  playlists: number;
  /** Playlists whose tracks were read this sync (new or changed). */
  read: number;
  /** Playlists Spotify won't list the tracks of. */
  unavailable: number;
  tracks: number;
}

export interface SpotifySyncOptions {
  isCancelled?: () => boolean;
  onProgress?: (message: string) => Promise<void> | void;
}

async function replaceTracks(userId: string, playlistId: string, snapshot: string | null, tracks: PlaylistTrack[] | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM music_spotify_playlist_tracks WHERE user_id = $1 AND playlist_id = $2`, [userId, playlistId]);
    if (tracks && tracks.length > 0) {
      await client.query(
        `INSERT INTO music_spotify_playlist_tracks
           (user_id, playlist_id, position, spotify_id, title, artists, album, duration_ms, added_at, is_local)
         SELECT $1, $2, t.position, t.spotify_id, t.title, ARRAY(SELECT jsonb_array_elements_text(t.artists)),
                t.album, t.duration_ms, t.added_at, t.is_local
         FROM jsonb_to_recordset($3::jsonb) AS t(position int, spotify_id text, title text, artists jsonb, album text,
                                                 duration_ms int, added_at timestamptz, is_local boolean)`,
        [userId, playlistId, JSON.stringify(tracks.map((t, position) => ({ ...t, position })))],
      );
    }
    const newest = tracks?.reduce<string | null>((max, t) => (t.added_at && (!max || t.added_at > max) ? t.added_at : max), null) ?? null;
    await client.query(
      `UPDATE music_spotify_playlists
       SET tracks_available = $3, tracks_snapshot_id = $4, last_modified_at = $5,
           total_tracks = COALESCE($6, total_tracks)
       WHERE user_id = $1 AND spotify_id = $2`,
      [userId, playlistId, tracks !== null, snapshot, newest, tracks?.length ?? null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Sync one user's playlists. Records the outcome for the settings page; rethrows failures. */
export async function runSpotifySync(userId: string, opts: SpotifySyncOptions = {}): Promise<SpotifySyncSummary> {
  const isCancelled = opts.isCancelled ?? (() => false);
  const progress = async (m: string) => {
    await opts.onProgress?.(m);
  };
  await query(`UPDATE music_spotify_accounts SET last_attempt_at = NOW() WHERE user_id = $1`, [userId]);
  try {
    const token = await userAccessToken(userId);
    await progress('Reading your Spotify playlists...');
    const raw = await allPages<unknown>(token, `/me/playlists?limit=${PAGE}`, isCancelled);
    const seen = new Set<string>();
    const playlists = raw.map(parsePlaylist).filter((p): p is PlaylistSummary => {
      if (!p || seen.has(p.spotify_id)) return false;
      seen.add(p.spotify_id);
      return true;
    });

    await query(
      `INSERT INTO music_spotify_playlists
         (user_id, spotify_id, position, name, description, owner_id, owner_name, image_url, collaborative, public,
          snapshot_id, total_tracks, synced_at)
       SELECT $1, p.spotify_id, p.position, p.name, p.description, p.owner_id, p.owner_name, p.image_url,
              p.collaborative, p.public, p.snapshot_id, p.total_tracks, NOW()
       FROM jsonb_to_recordset($2::jsonb) AS p(spotify_id text, position int, name text, description text, owner_id text,
              owner_name text, image_url text, collaborative boolean, public boolean, snapshot_id text, total_tracks int)
       ON CONFLICT (user_id, spotify_id) DO UPDATE SET
         position = EXCLUDED.position, name = EXCLUDED.name, description = EXCLUDED.description,
         owner_id = EXCLUDED.owner_id, owner_name = EXCLUDED.owner_name, image_url = EXCLUDED.image_url,
         collaborative = EXCLUDED.collaborative, public = EXCLUDED.public, snapshot_id = EXCLUDED.snapshot_id,
         -- A playlist whose tracks were read keeps the count of what was stored.
         total_tracks = CASE WHEN music_spotify_playlists.tracks_available
                               AND music_spotify_playlists.tracks_snapshot_id IS NOT DISTINCT FROM EXCLUDED.snapshot_id
                             THEN music_spotify_playlists.total_tracks ELSE EXCLUDED.total_tracks END,
         synced_at = NOW()`,
      [userId, JSON.stringify(playlists.map((p, position) => ({ ...p, position })))],
    );
    await query(`DELETE FROM music_spotify_playlists WHERE user_id = $1 AND NOT (spotify_id = ANY($2::text[]))`, [
      userId,
      playlists.map((p) => p.spotify_id),
    ]);

    const stale = await query(
      `SELECT spotify_id, name, snapshot_id FROM music_spotify_playlists
       WHERE user_id = $1 AND (tracks_snapshot_id IS NULL OR tracks_snapshot_id IS DISTINCT FROM snapshot_id)
       ORDER BY position`,
      [userId],
    );
    const summary: SpotifySyncSummary = { playlists: playlists.length, read: 0, unavailable: 0, tracks: 0 };
    let i = 0;
    for (const p of stale.rows as { spotify_id: string; name: string; snapshot_id: string | null }[]) {
      if (isCancelled()) throw new Error('cancelled');
      i++;
      await progress(`Reading playlist ${i} of ${stale.rows.length}: ${p.name}`);
      let tracks: PlaylistTrack[] | null;
      try {
        const entries = await allPages<unknown>(
          token,
          `/playlists/${encodeURIComponent(p.spotify_id)}/items?limit=${PAGE}&additional_types=track`,
          isCancelled,
        );
        tracks = entries.map(parsePlaylistEntry).filter((t): t is PlaylistTrack => t !== null);
        summary.read++;
        summary.tracks += tracks.length;
      } catch (err) {
        // Not the user's playlist (Development Mode) or gone: metadata only.
        if (!(err instanceof SpotifyError) || (err.upstream !== 403 && err.upstream !== 404)) throw err;
        tracks = null;
        summary.unavailable++;
      }
      await replaceTracks(userId, p.spotify_id, p.snapshot_id, tracks);
    }
    const unavailable = await query(
      `SELECT COUNT(*)::int AS n FROM music_spotify_playlists WHERE user_id = $1 AND NOT tracks_available`,
      [userId],
    );
    summary.unavailable = unavailable.rows[0].n;

    await query(
      `UPDATE music_spotify_accounts SET last_synced_at = NOW(), last_error = NULL, last_summary = $2 WHERE user_id = $1`,
      [userId, JSON.stringify(summary)],
    );
    void collectOrphanCovers().catch(() => {});
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    if (message !== 'cancelled') {
      await query(`UPDATE music_spotify_accounts SET last_error = $2 WHERE user_id = $1`, [userId, message]);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Daily sync
// ---------------------------------------------------------------------------

const AUTO_SYNC_CHECK_MS = 60 * 60 * 1000;
const AUTO_SYNC_EVERY = '23 hours';
const AUTO_SYNC_LOCK_ID = 85_000_001;

/** Connected users whose last sync attempt was a day or more ago. */
async function dueUserIds(): Promise<string[]> {
  const r = await query(
    `SELECT a.user_id FROM music_spotify_accounts a
     JOIN users u ON u.id = a.user_id AND u.disabled_at IS NULL
     WHERE a.refresh_token IS NOT NULL
       AND (a.last_attempt_at IS NULL OR a.last_attempt_at < NOW() - INTERVAL '${AUTO_SYNC_EVERY}')
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = a.user_id AND j.type = $1 AND j.status IN ('pending', 'running'))`,
    [SPOTIFY_SYNC_JOB],
  );
  return r.rows.map((row) => row.user_id as string);
}

/** One pass of the daily sync. Exported for tests. */
export async function runSpotifyAutoSync(): Promise<{ synced: number; failed: number }> {
  const totals = { synced: 0, failed: 0 };
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [AUTO_SYNC_LOCK_ID]);
    if (!lock.rows[0]?.ok) return totals;
    try {
      for (const userId of await dueUserIds()) {
        try {
          await runAsUser(userId, () => runSpotifySync(userId));
          totals.synced++;
        } catch (err) {
          totals.failed++;
          console.warn(`[spotify] daily sync failed for user ${userId}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [AUTO_SYNC_LOCK_ID]);
    }
  } finally {
    lockClient.release();
  }
  return totals;
}

export function startSpotifyAutoSync(): void {
  if (process.env.NODE_ENV === 'test') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSpotifyAutoSync();
    } catch (err) {
      console.error('[spotify] daily sync failed:', err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, AUTO_SYNC_CHECK_MS).unref();
  setTimeout(tick, 5 * 60 * 1000).unref();
}

/** The job behind "Sync now". */
export async function spotifySyncJob(userId: string, opts: SpotifySyncOptions): Promise<SpotifySyncSummary> {
  if (!(await getAccount(userId))?.refreshToken) throw new Error(NOT_CONNECTED);
  return runSpotifySync(userId, opts);
}

// ---------------------------------------------------------------------------
// Playlist covers: downloaded once and served by WhereWeWere, so the browser
// never loads images from Spotify.
// ---------------------------------------------------------------------------

export type CoverFetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

let coverFetch: CoverFetch | null =
  process.env.NODE_ENV === 'test' ? null : (url) => fetch(url, { signal: AbortSignal.timeout(30_000) });

export function setCoverFetch(next: CoverFetch | null): void {
  coverFetch = next;
}

const COVER_PX = 192;
const coverDir = () => path.join(config.dataDir, 'spotify-covers');
const coverFile = (url: string) => `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`;

/** Spotify's image hosts; anything else is never fetched. */
export function isSpotifyImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (/(^|\.)scdn\.co$/.test(u.hostname) || /(^|\.)spotifycdn\.com$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** The cached cover file of a playlist (downloaded on first use), or null. */
export async function getPlaylistCover(userId: string, playlistId: string): Promise<string | null> {
  const r = await query(`SELECT image_url FROM music_spotify_playlists WHERE user_id = $1 AND spotify_id = $2`, [userId, playlistId]);
  const url = r.rows[0]?.image_url as string | undefined;
  if (!url || !isSpotifyImageUrl(url)) return null;
  const file = path.join(coverDir(), coverFile(url));
  if (fs.existsSync(file)) return file;
  if (!coverFetch) return null;
  const res = await coverFetch(url).catch(() => null);
  if (!res?.ok) return null;
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(COVER_PX, COVER_PX, { fit: 'cover' })
    .jpeg({ quality: 82 })
    .toBuffer()
    .catch(() => null);
  if (!jpeg) return null;
  fs.mkdirSync(coverDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, jpeg);
  fs.renameSync(tmp, file);
  return file;
}

const ORPHAN_GRACE_MS = 10 * 60 * 1000;

/** Remove cover files no playlist uses any more (covers change as playlists do). */
export async function collectOrphanCovers(): Promise<number> {
  if (!fs.existsSync(coverDir())) return 0;
  const used = new Set(
    (await query(`SELECT DISTINCT image_url FROM music_spotify_playlists WHERE image_url IS NOT NULL`)).rows.map((r) =>
      coverFile(r.image_url as string),
    ),
  );
  const settled = Date.now() - ORPHAN_GRACE_MS;
  let removed = 0;
  for (const name of fs.readdirSync(coverDir())) {
    const full = path.join(coverDir(), name);
    const stat = fs.statSync(full);
    if (stat.isFile() && !used.has(name) && stat.mtimeMs < settled) {
      fs.rmSync(full, { force: true });
      removed++;
    }
  }
  return removed;
}
