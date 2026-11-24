// ============================================================================
// Steam library sync: merges Steam playtime into the Media library.
//
// For each owned Steam game:
//   1. Find its game in the library: by a stored steam_appid, then by the IGDB
//      id IGDB maps the Steam app to, then by strict title. Games with no
//      match wait in a review list (media_steam_games.status = 'unmatched').
//   2. Raise media_items.time_played_minutes to Steam's total. A Steam total
//      lower than the library's is ignored: time played never goes down.
//   3. If Steam's total rose since the last sync, add an in_progress check-in
//      for the minutes played, unless the user already logged a check-in for
//      that game by hand since then. The first sync only records a baseline.
// ============================================================================

import type { PoolClient } from 'pg';
import { pool, query } from '../../../server/src/db';
import { allPlugins } from '../../../server/src/plugins/registry';
import { runAsUser } from '../../../server/src/auth/context';
import { igdb } from './igdb';
import { normalizeTitle, isSameGame } from './titleMatch';
import { getOwnedGames, SteamError, type SteamOwnedGame } from './steam';

export interface SteamSettings {
  apiKey: string | null;
  steamId: string | null;
  autoSync: boolean;
  igdbClientId: string | null;
  igdbClientSecret: string | null;
}

export interface SteamSyncSummary {
  games: number;
  matched: number;
  newly_matched: number;
  time_updated: number;
  checkins_created: number;
  unmatched: number;
  ignored: number;
}

export interface SteamSyncOptions {
  isCancelled?: () => boolean;
  onProgress?: (message: string) => Promise<void> | void;
  /** Injectable clock for tests. */
  now?: Date;
}

const SETTING_KEYS = ['steam_api_key', 'steam_id', 'steam_auto_sync', 'igdb_client_id', 'igdb_client_secret'];

/** The Steam (and IGDB, for matching) settings of one user. */
export async function getSteamSettings(userId: string): Promise<SteamSettings> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'media' AND key = ANY($2::text[])`,
    [userId, SETTING_KEYS],
  );
  const v: Record<string, unknown> = {};
  for (const row of result.rows) v[row.key] = row.value;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return {
    apiKey: str(v.steam_api_key),
    steamId: str(v.steam_id),
    autoSync: v.steam_auto_sync !== false,
    igdbClientId: str(v.igdb_client_id),
    igdbClientSecret: str(v.igdb_client_secret),
  };
}

/**
 * How many minutes an automatic check-in should record, or null for none.
 * `previous` is Steam's total at the last sync (null when this game was not
 * seen before, i.e. a baseline).
 */
export function autoCheckinMinutes(args: {
  previous: number | null;
  current: number;
  matched: boolean;
  manualCheckinSinceLastSync: boolean;
}): number | null {
  if (!args.matched || args.previous == null) return null;
  const delta = args.current - args.previous;
  if (delta <= 0) return null;
  if (args.manualCheckinSinceLastSync) return null;
  return delta;
}

/** The user's timezone at `at`, from their latest check-in of any type. */
async function inferTimezone(client: PoolClient, userId: string, at: Date): Promise<string> {
  for (const plugin of allPlugins()) {
    const hook = plugin.server.latestTimezoneAsOf;
    if (!hook) continue;
    const result = await client.query(hook().sql, [at.toISOString(), userId]);
    const timezone = result.rows[0]?.timezone;
    if (timezone) return timezone as string;
  }
  return 'UTC';
}

interface GameItem {
  id: string;
  title: string;
  steam_appid: number | null;
  external_source: string | null;
  external_id: string | null;
}

interface SnapshotRow {
  appid: number;
  playtime_minutes: number;
  status: 'matched' | 'unmatched' | 'ignored';
  media_item_id: string | null;
}

/**
 * Pick a library game for each Steam game not yet linked. Each library game
 * is linked to at most one Steam app.
 */
async function matchGames(
  games: SteamOwnedGame[],
  snapshot: Map<number, SnapshotRow>,
  items: GameItem[],
  settings: SteamSettings,
): Promise<Map<number, string>> {
  const links = new Map<number, string>();
  const claimed = new Set<string>();
  const byAppid = new Map<number, GameItem>();
  for (const item of items) {
    if (item.steam_appid != null) {
      byAppid.set(item.steam_appid, item);
      claimed.add(item.id);
    }
  }

  const pending: SteamOwnedGame[] = [];
  for (const game of games) {
    const linked = byAppid.get(game.appid);
    if (linked) {
      links.set(game.appid, linked.id);
      continue;
    }
    if (snapshot.get(game.appid)?.status === 'ignored') continue;
    pending.push(game);
  }
  if (pending.length === 0) return links;

  const claim = (appid: number, item: GameItem | undefined): boolean => {
    if (!item || claimed.has(item.id)) return false;
    claimed.add(item.id);
    links.set(appid, item.id);
    return true;
  };

  // IGDB knows which IGDB game each Steam app is.
  const igdbIds = await igdb.steamAppIdsToIgdb(
    settings.igdbClientId,
    settings.igdbClientSecret,
    pending.map((g) => g.appid),
  );
  const byIgdbId = new Map<string, GameItem>();
  for (const item of items) {
    if (item.external_source === 'igdb' && item.external_id) byIgdbId.set(item.external_id, item);
  }
  const rest: SteamOwnedGame[] = [];
  for (const game of pending) {
    const igdbId = igdbIds?.get(game.appid);
    if (!(igdbId && claim(game.appid, byIgdbId.get(igdbId)))) rest.push(game);
  }

  // Strict title match (exact, or the same game with an edition qualifier).
  const keyed = items.map((item) => ({ item, key: normalizeTitle(item.title) }));
  for (const game of rest) {
    const key = normalizeTitle(game.name);
    const exact = keyed.find((k) => !claimed.has(k.item.id) && k.key === key);
    const match = exact ?? keyed.find((k) => !claimed.has(k.item.id) && isSameGame(key, k.key));
    claim(game.appid, match?.item);
  }
  return links;
}

async function recordFailure(userId: string, at: Date, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await query(
    `INSERT INTO media_steam_sync_state (user_id, last_attempt_at, last_error)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_error = EXCLUDED.last_error`,
    [userId, at.toISOString(), message.slice(0, 500)],
  );
}

/** Run one Steam sync for `userId`. Throws a SteamError for setup problems. */
export async function runSteamSync(userId: string, opts: SteamSyncOptions = {}): Promise<SteamSyncSummary> {
  const startedAt = opts.now ?? new Date();
  const progress = async (message: string) => {
    if (opts.isCancelled?.()) throw new Error('cancelled');
    await opts.onProgress?.(message);
  };

  const settings = await getSteamSettings(userId);
  if (!settings.apiKey || !settings.steamId) {
    throw new SteamError('Add a Steam API key and Steam ID in Settings > Media first.');
  }

  let games: SteamOwnedGame[];
  try {
    await progress('Fetching your Steam library...');
    games = await getOwnedGames(settings.apiKey, settings.steamId);
  } catch (err) {
    if (!(err instanceof Error && err.message === 'cancelled')) await recordFailure(userId, startedAt, err);
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One sync per user at a time (the hourly sync and the button can overlap).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('media-steam-sync'), hashtext($1))`, [userId]);

    const state = await client.query(
      'SELECT last_synced_at FROM media_steam_sync_state WHERE user_id = $1',
      [userId],
    );
    const lastSyncedAt: Date | null = state.rows[0]?.last_synced_at ?? null;

    const snapRows = await client.query(
      'SELECT appid, playtime_minutes, status, media_item_id FROM media_steam_games WHERE user_id = $1',
      [userId],
    );
    const snapshot = new Map<number, SnapshotRow>(
      (snapRows.rows as SnapshotRow[]).map((r) => [Number(r.appid), { ...r, appid: Number(r.appid) }]),
    );
    const itemRows = await client.query(
      `SELECT id, title, steam_appid, external_source, external_id
         FROM media_items WHERE user_id = $1 AND media_type = 'game'`,
      [userId],
    );
    const items = itemRows.rows as GameItem[];

    await progress(`Matching ${games.length} Steam games to your library...`);
    const links = await matchGames(games, snapshot, items, settings);
    const itemById = new Map(items.map((i) => [i.id, i]));

    const summary: SteamSyncSummary = {
      games: games.length, matched: 0, newly_matched: 0, time_updated: 0,
      checkins_created: 0, unmatched: 0, ignored: 0,
    };

    await progress('Updating time played...');
    for (const game of games) {
      const prev = snapshot.get(game.appid);
      const itemId = links.get(game.appid) ?? null;
      const status = itemId ? 'matched' : prev?.status === 'ignored' ? 'ignored' : 'unmatched';

      await client.query(
        `INSERT INTO media_steam_games
           (user_id, appid, name, playtime_minutes, last_played_at, icon_url, status, media_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, appid) DO UPDATE SET
           name = EXCLUDED.name, playtime_minutes = EXCLUDED.playtime_minutes,
           last_played_at = EXCLUDED.last_played_at, icon_url = EXCLUDED.icon_url,
           status = EXCLUDED.status, media_item_id = EXCLUDED.media_item_id, updated_at = NOW()`,
        [userId, game.appid, game.name, game.playtimeMinutes, game.lastPlayedAt?.toISOString() ?? null,
          game.iconUrl, status, itemId],
      );

      if (!itemId) {
        if (status === 'ignored') summary.ignored++;
        else summary.unmatched++;
        continue;
      }
      summary.matched++;

      if (itemById.get(itemId)?.steam_appid !== game.appid) {
        summary.newly_matched++;
        await client.query(
          'UPDATE media_items SET steam_appid = $2, updated_at = NOW() WHERE id = $1 AND user_id = $3',
          [itemId, game.appid, userId],
        );
      }

      // Time played only ever goes up.
      const raised = await client.query(
        `UPDATE media_items SET time_played_minutes = $2, updated_at = NOW()
          WHERE id = $1 AND user_id = $3 AND COALESCE(time_played_minutes, 0) < $2`,
        [itemId, game.playtimeMinutes, userId],
      );
      summary.time_updated += raised.rowCount ?? 0;

      // A game first seen now has no earlier Steam total to compare against.
      const previous = prev && lastSyncedAt ? prev.playtime_minutes : null;
      let manual = false;
      if (previous != null && game.playtimeMinutes > previous) {
        const m = await client.query(
          `SELECT 1 FROM media_checkins
            WHERE user_id = $1 AND media_item_id = $2 AND external_event_id IS NULL AND created_at > $3
            LIMIT 1`,
          [userId, itemId, lastSyncedAt],
        );
        manual = m.rows.length > 0;
      }
      const minutes = autoCheckinMinutes({
        previous, current: game.playtimeMinutes, matched: true, manualCheckinSinceLastSync: manual,
      });
      if (minutes != null) {
        const at = game.lastPlayedAt ?? startedAt;
        const timezone = await inferTimezone(client, userId, at);
        const inserted = await client.query(
          `INSERT INTO media_checkins
             (user_id, media_item_id, checkin_type, checked_in_at, checkin_timezone, time_played_minutes, external_event_id)
           VALUES ($1, $2, 'in_progress', $3, $4, $5, $6)
           ON CONFLICT (user_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING`,
          [userId, itemId, at.toISOString(), timezone, minutes, `steam:${game.appid}:${game.playtimeMinutes}`],
        );
        summary.checkins_created += inserted.rowCount ?? 0;
      }
    }

    await client.query(
      `INSERT INTO media_steam_sync_state (user_id, last_synced_at, last_attempt_at, last_error, last_summary)
       VALUES ($1, $2, $2, NULL, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at, last_attempt_at = EXCLUDED.last_attempt_at,
         last_error = NULL, last_summary = EXCLUDED.last_summary`,
      [userId, startedAt.toISOString(), JSON.stringify(summary)],
    );
    if (opts.isCancelled?.()) throw new Error('cancelled');
    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (!(err instanceof Error && err.message === 'cancelled')) await recordFailure(userId, startedAt, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Link a Steam game from the review list to a library game and merge its
 * playtime (never lowering it). Throws SteamError when the game is already
 * linked to a different Steam app.
 */
export async function linkSteamGame(userId: string, appid: number, itemId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const steam = await client.query(
      'SELECT playtime_minutes FROM media_steam_games WHERE user_id = $1 AND appid = $2 FOR UPDATE',
      [userId, appid],
    );
    if (steam.rows.length === 0) throw new SteamError('That Steam game is not in your synced library.');
    const item = await client.query(
      `SELECT steam_appid FROM media_items WHERE id = $1 AND user_id = $2 AND media_type = 'game' FOR UPDATE`,
      [itemId, userId],
    );
    if (item.rows.length === 0) throw new SteamError('Game not found.');
    const current = item.rows[0].steam_appid as number | null;
    if (current != null && current !== appid) {
      throw new SteamError('That game is already linked to a different Steam game.');
    }
    // Free the app from any other game it was linked to.
    await client.query(
      'UPDATE media_items SET steam_appid = NULL WHERE user_id = $1 AND steam_appid = $2 AND id <> $3',
      [userId, appid, itemId],
    );
    await client.query(
      `UPDATE media_items
          SET steam_appid = $2,
              time_played_minutes = GREATEST(COALESCE(time_played_minutes, 0), $4),
              updated_at = NOW()
        WHERE id = $1 AND user_id = $3`,
      [itemId, appid, userId, Number(steam.rows[0].playtime_minutes)],
    );
    await client.query(
      `UPDATE media_steam_games SET status = 'matched', media_item_id = $3, updated_at = NOW()
        WHERE user_id = $1 AND appid = $2`,
      [userId, appid, itemId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Ignore a Steam game (true) or put it back in the review list (false). */
export async function setSteamGameIgnored(userId: string, appid: number, ignored: boolean): Promise<boolean> {
  const result = await query(
    ignored
      ? `UPDATE media_steam_games SET status = 'ignored', media_item_id = NULL, updated_at = NOW()
          WHERE user_id = $1 AND appid = $2 AND status <> 'matched'`
      : `UPDATE media_steam_games SET status = 'unmatched', updated_at = NOW()
          WHERE user_id = $1 AND appid = $2 AND status = 'ignored'`,
    [userId, appid],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Users whose hourly sync is on and who have Steam set up. */
async function autoSyncUserIds(): Promise<string[]> {
  const result = await query(
    `SELECT ps.user_id
       FROM plugin_settings ps
       JOIN users u ON u.id = ps.user_id AND u.disabled_at IS NULL
      WHERE ps.plugin_id = 'media'
      GROUP BY ps.user_id
     HAVING bool_or(ps.key = 'steam_api_key' AND jsonb_typeof(ps.value) = 'string' AND ps.value #>> '{}' <> '')
        AND bool_or(ps.key = 'steam_id' AND jsonb_typeof(ps.value) = 'string' AND ps.value #>> '{}' <> '')
        AND NOT bool_or(ps.key = 'steam_auto_sync' AND ps.value = 'false'::jsonb)`,
  );
  return result.rows.map((r) => r.user_id as string);
}

export const STEAM_SYNC_JOB = 'steam-sync';
const AUTO_SYNC_EVERY_MS = 60 * 60 * 1000;
/** pg advisory lock id for the hourly pass (arbitrary, stable). */
const AUTO_SYNC_LOCK_ID = 82_000_001;

/** One hourly pass: sync every user with auto-sync on. Exported for tests. */
export async function runSteamAutoSync(): Promise<{ synced: number; failed: number }> {
  const totals = { synced: 0, failed: 0 };
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [AUTO_SYNC_LOCK_ID]);
    if (!lock.rows[0]?.ok) return totals; // another process is syncing
    try {
      for (const userId of await autoSyncUserIds()) {
        // The button's job already covers this user.
        const active = await query(
          `SELECT 1 FROM jobs WHERE user_id = $1 AND type = $2 AND status IN ('pending', 'running') LIMIT 1`,
          [userId, STEAM_SYNC_JOB],
        );
        if (active.rows.length > 0) continue;
        try {
          await runAsUser(userId, () => runSteamSync(userId));
          totals.synced++;
        } catch (err) {
          totals.failed++;
          console.warn(`[steam] hourly sync failed for user ${userId}:`, err instanceof Error ? err.message : err);
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

/** Start the hourly Steam sync (from the Media plugin's onServerStart). */
export function startSteamAutoSync(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSteamAutoSync();
    } catch (err) {
      console.error('[steam] hourly sync failed:', err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, AUTO_SYNC_EVERY_MS).unref();
}
