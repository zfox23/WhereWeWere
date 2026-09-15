import { ApiCache, externalFetchJson, withDegradation } from './mediaApi';

// ============================================================================
// TGDB (The Games Database, thegamesdb.net) client.
// v1.1 REST API: https://api.thegamesdb.net/v1.1
// ============================================================================

const TGDB_BASE = 'https://api.thegamesdb.net';
/** Default CDN size when the response omits `include.boxart.base_url`. */
const TGDB_IMAGE_BASE = 'https://cdn.thegamesdb.net/images/medium/';
/** Game detail fields requested from the API (plain Game object fields only). */
const GAME_FIELDS = 'platform,overview,players,rating,coop';

export interface TgdbGameResult {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
  platform: string | null;
  /** Synopsis. */
  overview: string | null;
  /** ESRB-style content rating, e.g. "E - Everyone". */
  contentRating: string | null;
  /** Minimum player count. */
  players: number | null;
  /** Co-op support string, e.g. "Yes"/"No". */
  coop: string | null;
  /** Genre names (null = unknown/unresolved). */
  genres: string[] | null;
  /** Developer names (null = unknown/unresolved). */
  developers: string[] | null;
  /** Publisher names (null = unknown/unresolved). */
  publishers: string[] | null;
}

interface TgdbGameRow {
  id: number;
  game_title: string;
  release_date?: string | null;
  platform?: number | null;
  region_id?: number | null;
  country_id?: number | null;
  overview?: string | null;
  /** ESRB-style content rating (distinct from the user's star rating). */
  rating?: string | null;
  players?: number | null;
  coop?: string | null;
  genres?: number[] | null;
  developers?: number[] | null;
  publishers?: number[] | null;
}

interface TgdbBoxartImage {
  type: string;
  side?: string | null;
  filename: string;
}

interface TgdbBoxartInclude {
  base_url?: {
    original?: string;
    small?: string;
    thumb?: string;
    cropped_center_thumb?: string;
    medium?: string;
    large?: string;
  };
  data?: Record<string, TgdbBoxartImage[]>;
}

interface TgdbPlatformSkinny {
  id: number;
  name: string;
  alias?: string;
}

interface TgdbSearchResponse {
  data?: {
    count?: number;
    games?: TgdbGameRow[];
  };
  include?: {
    boxart?: TgdbBoxartInclude;
    platform?: {
      data?: Record<string, TgdbPlatformSkinny>;
    };
  };
}

/** Response shape for v1 Games/ByGameID (mirrors the search payload). */
interface TgdbGameByIdResponse {
  data?: {
    count?: number;
    games?: TgdbGameRow[];
  };
  include?: {
    boxart?: TgdbBoxartInclude;
    platform?: {
      data?: Record<string, TgdbPlatformSkinny>;
    };
  };
}

/** Response shape for /v1/{Genres,Developers,Publishers}/By*ID?id=a,b. */
interface TgdbNameByIdResponse {
  data?: {
    count?: number;
    genres?: NameMap;
    developers?: NameMap;
    publishers?: NameMap;
  };
}

type NameKind = 'genres' | 'developers' | 'publishers';

type NameMap = Record<string, { id: number; name: string }>;

const NAME_ENDPOINT: Record<NameKind, { path: string; key: 'genres' | 'developers' | 'publishers' }> = {
  genres: { path: '/v1/Genres/ByGenreID', key: 'genres' },
  developers: { path: '/v1/Developers/ByDeveloperID', key: 'developers' },
  publishers: { path: '/v1/Publishers/ByPublisherID', key: 'publishers' },
};

// Shared response cache; cleared on server restart.
const cache = new ApiCache(60 * 60 * 1000);
/**
 * Persistent id->name maps for stable catalog data (genre/developer/publisher
 * names). Module-level so repeated ids cost zero API calls across the process
 * lifetime; cleared on server restart like the response cache.
 */
const nameMaps: Record<NameKind, Map<number, string>> = {
  genres: new Map(),
  developers: new Map(),
  publishers: new Map(),
};

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const match = date.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function cleanStr(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Pick a boxart URL for a game: prefer boxart/front, then any boxart. */
function imageUrlFor(gameId: string, boxart: TgdbBoxartInclude | undefined): string | null {
  const images = boxart?.data?.[gameId];
  if (!images || images.length === 0) return null;
  const base = boxart?.base_url?.medium || TGDB_IMAGE_BASE;
  const pick = images.find((i) => i.type === 'boxart' && i.side === 'front') || images.find((i) => i.type === 'boxart');
  return pick ? `${base}${pick.filename}` : null;
}

/**
 * Name search returns one row per platform/region entry, so the same game can
 * appear multiple times. Collapse to one row per game id, keeping the entry
 * with the earliest (most representative) release date.
 */
function dedupeByGameId(rows: TgdbGameRow[]): TgdbGameRow[] {
  const byId = new Map<number, TgdbGameRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    const a = existing.release_date || '';
    const b = row.release_date || '';
    if (b && (!a || b < a)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * Resolve a set of TGDB entity ids to names in ONE batched call
 * (By*ID accepts comma-delimited ids). Results are recorded in the persistent
 * per-kind name map so repeated ids across the run cost nothing; unknown ids
 * are dropped. Returns null when the id list is empty or the lookup fails.
 */
async function resolveNames(apiKey: string, kind: NameKind, ids: number[]): Promise<Map<number, string> | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;

  const endpoint = NAME_ENDPOINT[kind];
  const persistent = nameMaps[kind];
  const map = new Map<number, string>();

  // Serve from the persistent map first; only hit the API for the missing ids.
  const missing: number[] = [];
  for (const id of unique) {
    const known = persistent.get(id);
    if (known != null) {
      map.set(id, known);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return map;

  const url = `${TGDB_BASE}${endpoint.path}?apikey=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(missing.join(','))}`;
  const data = await cache.get<TgdbNameByIdResponse>(`tgdb:${kind}:${missing.slice().sort((a, b) => a - b).join(',')}`, async () => {
    return externalFetchJson<TgdbNameByIdResponse>(url);
  });

  const byId = data.data?.[endpoint.key] || {};
  for (const id of missing) {
    const entry = byId[String(id)];
    if (entry?.name) {
      persistent.set(id, entry.name);
      map.set(id, entry.name);
    }
  }
  return map;
}

/**
 * Map a raw id array to names. Returns null when the source list is absent or
 * no ids could be resolved (so callers can distinguish "TGDB said nothing"
 * from "resolved to an empty list").
 */
async function mapNames(
  apiKey: string,
  kind: NameKind,
  ids: number[] | null | undefined
): Promise<string[] | null> {
  if (!ids || ids.length === 0) return null;
  const resolved = await resolveNames(apiKey, kind, ids);
  if (!resolved) return null;
  const names = ids.map((id) => resolved.get(id)).filter((n): n is string => n != null);
  return names.length > 0 ? names : null;
}

export const tgdb = {
  get cache() {
    return cache;
  },

  /** Clear the response cache and the persistent id→name maps. */
  clearAll(): void {
    cache.clear();
    nameMaps.genres.clear();
    nameMaps.developers.clear();
    nameMaps.publishers.clear();
  },

  async searchGames(apiKey: string | null, query: string): Promise<TgdbGameResult[] | null> {
    if (!apiKey) return null;
    const url = `${TGDB_BASE}/v1.1/Games/ByGameName?apikey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(query)}&fields=${GAME_FIELDS}&include=boxart,platform`;
    return withDegradation(
      async () => {
        const data = await cache.get<TgdbSearchResponse>(`tgdb:search:${query.toLowerCase()}`, async () => {
          const json = await externalFetchJson<TgdbSearchResponse>(url);
          return json;
        });
        const platforms = data.include?.platform?.data || {};
        const rows = dedupeByGameId(data.data?.games || []).filter((r) => r.game_title);

        // Batch-resolve all genre/developer/publisher ids across the
        // candidate rows in at most 3 extra calls.
        const [genreMap, devMap, pubMap] = await Promise.all([
          resolveNames(apiKey, 'genres', rows.flatMap((r) => r.genres || [])),
          resolveNames(apiKey, 'developers', rows.flatMap((r) => r.developers || [])),
          resolveNames(apiKey, 'publishers', rows.flatMap((r) => r.publishers || [])),
        ]);
        const namesFrom = (ids: number[] | null | undefined, map: Map<number, string> | null): string[] | null => {
          if (!ids || ids.length === 0) return null;
          if (!map) return null;
          const names = ids.map((id) => map.get(id)).filter((n): n is string => n != null);
          return names.length > 0 ? names : null;
        };

        return rows.map((row) => ({
          externalId: String(row.id),
          title: row.game_title,
          releaseYear: yearFromDate(row.release_date),
          imageUrl: imageUrlFor(String(row.id), data.include?.boxart),
          externalUrl: `https://thegamesdb.net/game.php?id=${row.id}`,
          platform: row.platform != null ? platforms[String(row.platform)]?.name || null : null,
          overview: cleanStr(row.overview),
          contentRating: cleanStr(row.rating),
          players: row.players != null && Number.isFinite(row.players) ? row.players : null,
          coop: cleanStr(row.coop),
          genres: namesFrom(row.genres, genreMap),
          developers: namesFrom(row.developers, devMap),
          publishers: namesFrom(row.publishers, pubMap),
        }));
      },
      null,
      `TGDB game search "${query}"`
    );
  },

  /**
   * Fetch a single game by its TGDB id (for metadata sync).
   * NOTE: By-id lookups live on the v1 API (`/v1/Games/ByGameID`); the v1.1
   * API only offers name search. The response shape matches the v1.1 search
   * payload (data.games + include.boxart/platform).
   */
  async getGameDetails(apiKey: string | null, gameId: string): Promise<TgdbGameResult | null> {
    if (!apiKey) return null;
    const url = `${TGDB_BASE}/v1/Games/ByGameID?apikey=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(gameId)}&fields=${GAME_FIELDS}&include=boxart,platform`;
    return withDegradation(
      async () => {
        const data = await cache.get<TgdbGameByIdResponse>(`tgdb:game:${gameId}`, async () => {
          const json = await externalFetchJson<TgdbGameByIdResponse>(url);
          return json;
        });
        const rows = dedupeByGameId(data.data?.games || []).filter((r) => r.game_title);
        if (rows.length === 0) return null;
        const row = rows[0];
        const platforms = data.include?.platform?.data || {};
        const [genres, developers, publishers] = await Promise.all([
          mapNames(apiKey, 'genres', row.genres),
          mapNames(apiKey, 'developers', row.developers),
          mapNames(apiKey, 'publishers', row.publishers),
        ]);
        return {
          externalId: String(row.id),
          title: row.game_title,
          releaseYear: yearFromDate(row.release_date),
          imageUrl: imageUrlFor(String(row.id), data.include?.boxart),
          externalUrl: `https://thegamesdb.net/game.php?id=${row.id}`,
          platform: row.platform != null ? platforms[String(row.platform)]?.name || null : null,
          overview: cleanStr(row.overview),
          contentRating: cleanStr(row.rating),
          players: row.players != null && Number.isFinite(row.players) ? row.players : null,
          coop: cleanStr(row.coop),
          genres,
          developers,
          publishers,
        };
      },
      null,
      `TGDB game details ${gameId}`
    );
  },
};
