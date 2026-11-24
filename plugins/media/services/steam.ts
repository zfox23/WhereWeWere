// ============================================================================
// Steam Web API client: owned games with playtime, profile lookups.
//
// Auth: a Steam Web API key (https://steamcommunity.com/dev/apikey) sent as
// the `key` query parameter. Owned games are only visible when the profile's
// "Game details" privacy setting is Public.
// ============================================================================

import { MediaApiError, externalFetchJson } from './mediaApi';

const STEAM_API = 'https://api.steampowered.com';

/** A user-facing Steam failure (bad key, private profile, unknown name). */
export class SteamError extends Error {}

export interface SteamOwnedGame {
  appid: number;
  name: string;
  /** Total playtime in whole minutes. */
  playtimeMinutes: number;
  /** When the game was last played, or null if never (or unknown). */
  lastPlayedAt: Date | null;
  iconUrl: string | null;
}

export type SteamIdInput =
  | { kind: 'steamid'; steamid: string }
  | { kind: 'vanity'; vanity: string };

const STEAMID64 = /^7656119\d{10}$/;

/**
 * Read what the user typed into the Steam ID field: a 17-digit SteamID64, a
 * steamcommunity.com profile URL (/profiles/<id> or /id/<name>), or a bare
 * custom URL name. Returns null for empty or unusable input.
 */
export function parseSteamIdInput(raw: string): SteamIdInput | null {
  const input = raw.trim();
  if (!input) return null;
  if (STEAMID64.test(input)) return { kind: 'steamid', steamid: input };

  const url = input.match(/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  if (url) {
    const value = decodeURIComponent(url[2]);
    if (url[1].toLowerCase() === 'profiles') {
      return STEAMID64.test(value) ? { kind: 'steamid', steamid: value } : null;
    }
    return { kind: 'vanity', vanity: value };
  }

  // Custom URL names are letters, digits, underscores and dashes.
  if (/^[A-Za-z0-9_-]{2,32}$/.test(input)) return { kind: 'vanity', vanity: input };
  return null;
}

function apiUrl(path: string, params: Record<string, string>): string {
  return `${STEAM_API}${path}?${new URLSearchParams(params)}`;
}

/** GET a Steam API URL, turning auth failures into a clear message. */
async function steamGet<T>(url: string): Promise<T> {
  try {
    return await externalFetchJson<T>(url);
  } catch (err) {
    if (err instanceof MediaApiError && /\b(401|403)\b/.test(err.message)) {
      throw new SteamError('Steam rejected the API key. Check it at steamcommunity.com/dev/apikey.');
    }
    throw err;
  }
}

/** Resolve the Steam ID field's value to a SteamID64. */
export async function resolveSteamId(apiKey: string, raw: string): Promise<string> {
  const parsed = parseSteamIdInput(raw);
  if (!parsed) {
    throw new SteamError('Enter a SteamID64, a steamcommunity.com profile URL, or your custom URL name.');
  }
  if (parsed.kind === 'steamid') return parsed.steamid;

  const data = await steamGet<{ response?: { success?: number; steamid?: string } }>(
    apiUrl('/ISteamUser/ResolveVanityURL/v1/', { key: apiKey, vanityurl: parsed.vanity }),
  );
  if (data.response?.success !== 1 || !data.response.steamid) {
    throw new SteamError(`No Steam profile uses the custom URL "${parsed.vanity}".`);
  }
  return data.response.steamid;
}

/** The profile's display name, or null if Steam returns no profile. */
export async function getPlayerSummary(apiKey: string, steamid: string): Promise<{ personaName: string } | null> {
  const data = await steamGet<{ response?: { players?: { personaname?: string }[] } }>(
    apiUrl('/ISteamUser/GetPlayerSummaries/v2/', { key: apiKey, steamids: steamid }),
  );
  const player = data.response?.players?.[0];
  return player ? { personaName: player.personaname ?? steamid } : null;
}

interface OwnedGamesResponse {
  response?: {
    game_count?: number;
    games?: {
      appid?: number;
      name?: string;
      playtime_forever?: number;
      rtime_last_played?: number;
      img_icon_url?: string;
    }[];
  };
}

/**
 * Every game the account owns (including played free-to-play games), with
 * total playtime. Steam answers a private profile with an empty response
 * rather than an error, so that case is reported explicitly.
 */
export async function getOwnedGames(apiKey: string, steamid: string): Promise<SteamOwnedGame[]> {
  const data = await steamGet<OwnedGamesResponse>(
    apiUrl('/IPlayerService/GetOwnedGames/v1/', {
      key: apiKey,
      steamid,
      include_appinfo: '1',
      include_played_free_games: '1',
      format: 'json',
    }),
  );
  const response = data.response;
  if (!response || (response.game_count === undefined && response.games === undefined)) {
    throw new SteamError(
      "Steam returned no games. Set your Steam profile's \"Game details\" privacy to Public.",
    );
  }
  const games: SteamOwnedGame[] = [];
  for (const g of response.games ?? []) {
    if (typeof g.appid !== 'number' || !Number.isInteger(g.appid) || g.appid <= 0) continue;
    const name = (g.name ?? '').trim() || `Steam app ${g.appid}`;
    const playtime = typeof g.playtime_forever === 'number' && g.playtime_forever > 0 ? Math.round(g.playtime_forever) : 0;
    const lastPlayed = typeof g.rtime_last_played === 'number' && g.rtime_last_played > 0
      ? new Date(g.rtime_last_played * 1000)
      : null;
    games.push({
      appid: g.appid,
      name,
      playtimeMinutes: playtime,
      lastPlayedAt: lastPlayed,
      iconUrl: g.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
        : null,
    });
  }
  return games;
}

/** The game's Steam store page. */
export function steamStoreUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}`;
}
