/**
 * Steam routes of the Media plugin, mounted on its /media router:
 *
 *   POST /steam/verify                  check an API key + Steam ID, resolve the ID
 *   GET  /steam/status                  last sync, its summary or error, review count
 *   GET  /steam/games?status=           the review list (unmatched) or ignored games
 *   POST /steam/games/:appid/link       link to an existing library game
 *   POST /steam/games/:appid/add        add the game to the library, then link it
 *   POST /steam/games/:appid/ignore     hide it from the review list
 *   POST /steam/games/:appid/unignore   put it back in the review list
 *
 * Syncing itself runs as the `steam-sync` job (and hourly, see steamSync.ts).
 */

import type { Request, Response, Router } from 'express';
import { query } from '../../server/src/db';
import { currentUserId } from '../../server/src/auth/context';
import { isUuid } from '../../server/src/services/batching';
import { getOwnedGames, getPlayerSummary, resolveSteamId, SteamError } from './services/steam';
import { getSteamSettings, linkSteamGame, setSteamGameIgnored } from './services/steamSync';
import { igdb, pickIgdbCandidate, type IgdbGameResult } from './services/igdb';

export interface SteamRouteDeps {
  /** Find-or-create a game; returns its id. */
  upsertGame: (game: {
    external_source: string | null;
    external_id: string | null;
    title: string;
    release_year: number | null;
    image_url: string | null;
    external_url: string | null;
    platform: string | null;
  }) => Promise<string>;
}

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof SteamError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(`${fallback}:`, err);
  res.status(502).json({ error: `${fallback}. Steam may be unavailable; try again later.` });
}

function parseAppid(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
}

export function mountSteamRoutes(router: Router, deps: SteamRouteDeps): void {
  router.post('/steam/verify', async (req: Request, res: Response) => {
    const apiKey = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
    const steamIdInput = typeof req.body?.steam_id === 'string' ? req.body.steam_id.trim() : '';
    if (!apiKey || !steamIdInput) {
      return res.status(400).json({ error: 'api_key and steam_id are required' });
    }
    try {
      const steamid64 = await resolveSteamId(apiKey, steamIdInput);
      const player = await getPlayerSummary(apiKey, steamid64);
      if (!player) throw new SteamError('No Steam profile has that ID.');
      const games = await getOwnedGames(apiKey, steamid64);
      res.json({ steamid64, persona_name: player.personaName, game_count: games.length });
    } catch (err) {
      sendError(res, err, 'Could not reach Steam');
    }
  });

  router.get('/steam/status', async (_req: Request, res: Response) => {
    try {
      const userId = currentUserId();
      const settings = await getSteamSettings(userId);
      const state = await query(
        `SELECT last_synced_at, last_attempt_at, last_error, last_summary
           FROM media_steam_sync_state WHERE user_id = $1`,
        [userId],
      );
      const counts = await query(
        `SELECT COUNT(*) FILTER (WHERE status = 'unmatched' AND playtime_minutes > 0)::int AS unmatched,
                COUNT(*) FILTER (WHERE status = 'unmatched')::int AS unmatched_all,
                COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored
           FROM media_steam_games WHERE user_id = $1`,
        [userId],
      );
      const s = state.rows[0] ?? {};
      res.json({
        configured: !!(settings.apiKey && settings.steamId),
        last_synced_at: s.last_synced_at ?? null,
        last_attempt_at: s.last_attempt_at ?? null,
        last_error: s.last_error ?? null,
        last_summary: s.last_summary ?? null,
        unmatched: counts.rows[0].unmatched,
        unmatched_all: counts.rows[0].unmatched_all,
        ignored: counts.rows[0].ignored,
      });
    } catch (err) {
      console.error('Error getting Steam status:', err);
      res.status(500).json({ error: 'Failed to get Steam status' });
    }
  });

  router.get('/steam/games', async (req: Request, res: Response) => {
    const status = req.query.status === 'ignored' ? 'ignored' : 'unmatched';
    // The review list hides never-played games unless asked for.
    const includeUnplayed = req.query.include_unplayed === 'true' || status === 'ignored';
    try {
      const result = await query(
        `SELECT appid, name, playtime_minutes, last_played_at, icon_url, status
           FROM media_steam_games
          WHERE user_id = $1 AND status = $2 ${includeUnplayed ? '' : 'AND playtime_minutes > 0'}
          ORDER BY playtime_minutes DESC, name ASC`,
        [currentUserId(), status],
      );
      res.json(result.rows);
    } catch (err) {
      console.error('Error listing Steam games:', err);
      res.status(500).json({ error: 'Failed to list Steam games' });
    }
  });

  router.post('/steam/games/:appid/link', async (req: Request, res: Response) => {
    const appid = parseAppid(req.params.appid);
    const itemId = req.body?.media_item_id;
    if (appid == null || typeof itemId !== 'string' || !isUuid(itemId)) {
      return res.status(400).json({ error: 'A valid appid and media_item_id are required' });
    }
    try {
      await linkSteamGame(currentUserId(), appid, itemId);
      res.json({ ok: true, media_item_id: itemId });
    } catch (err) {
      if (err instanceof SteamError) return res.status(409).json({ error: err.message });
      console.error('Error linking Steam game:', err);
      res.status(500).json({ error: 'Failed to link Steam game' });
    }
  });

  router.post('/steam/games/:appid/add', async (req: Request, res: Response) => {
    const appid = parseAppid(req.params.appid);
    if (appid == null) return res.status(400).json({ error: 'Invalid appid' });
    try {
      const userId = currentUserId();
      const row = await query(
        'SELECT name FROM media_steam_games WHERE user_id = $1 AND appid = $2',
        [userId, appid],
      );
      if (row.rows.length === 0) return res.status(404).json({ error: 'Steam game not found' });
      const name = row.rows[0].name as string;

      // Prefer the IGDB game Steam's app maps to, then a title search.
      const settings = await getSteamSettings(userId);
      let details: IgdbGameResult | null = null;
      const mapped = await igdb.steamAppIdsToIgdb(settings.igdbClientId, settings.igdbClientSecret, [appid]);
      const igdbId = mapped?.get(appid);
      if (igdbId) {
        details = await igdb.getGameDetails(settings.igdbClientId, settings.igdbClientSecret, igdbId);
      }
      if (!details) {
        const candidates = await igdb.searchCandidates(settings.igdbClientId, settings.igdbClientSecret, name);
        details = candidates ? pickIgdbCandidate({ title: name, platform: 'PC' }, candidates)?.result ?? null : null;
      }

      const itemId = await deps.upsertGame(
        details
          ? {
              external_source: 'igdb',
              external_id: details.externalId,
              title: details.title,
              release_year: details.releaseYear,
              image_url: details.imageUrl,
              external_url: details.externalUrl,
              platform: 'PC',
            }
          : {
              external_source: null,
              external_id: null,
              title: name,
              release_year: null,
              image_url: null,
              external_url: null,
              platform: 'PC',
            },
      );
      if (details) {
        // Fill the descriptive metadata a new game would get from a sync.
        await query(
          `UPDATE media_items
              SET overview = COALESCE(overview, $2), content_rating = COALESCE(content_rating, $3),
                  genres = COALESCE(genres, $4), developers = COALESCE(developers, $5),
                  publishers = COALESCE(publishers, $6)
            WHERE id = $1 AND user_id = $7`,
          [itemId, details.overview, details.contentRating, details.genres, details.developers, details.publishers, userId],
        );
      }
      await linkSteamGame(userId, appid, itemId);
      res.status(201).json({ ok: true, media_item_id: itemId });
    } catch (err) {
      if (err instanceof SteamError) return res.status(409).json({ error: err.message });
      console.error('Error adding Steam game:', err);
      res.status(500).json({ error: 'Failed to add Steam game' });
    }
  });

  for (const [action, ignored] of [['ignore', true], ['unignore', false]] as const) {
    router.post(`/steam/games/:appid/${action}`, async (req: Request, res: Response) => {
      const appid = parseAppid(req.params.appid);
      if (appid == null) return res.status(400).json({ error: 'Invalid appid' });
      try {
        const changed = await setSteamGameIgnored(currentUserId(), appid, ignored);
        if (!changed) return res.status(404).json({ error: 'Steam game not found in that list' });
        res.json({ ok: true });
      } catch (err) {
        console.error(`Error (${action}) Steam game:`, err);
        res.status(500).json({ error: 'Failed to update Steam game' });
      }
    });
  }
}
