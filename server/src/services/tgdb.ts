import { ApiCache, externalFetchJson, withDegradation } from './mediaApi';

// ============================================================================
// TGDB (The Games Database, thegamesdb.net) client.
// v1.1 REST API: https://api.thegamesdb.net/v1.1
// ============================================================================

const TGDB_BASE = 'https://api.thegamesdb.net';
/** Default CDN size when the response omits `include.boxart.base_url`. */
const TGDB_IMAGE_BASE = 'https://cdn.thegamesdb.net/images/medium/';

export interface TgdbGameResult {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
}

interface TgdbGameRow {
  id: number;
  game_title: string;
  release_date?: string | null;
  platform?: number | null;
  region_id?: number | null;
  country_id?: number | null;
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

interface TgdbSearchResponse {
  data?: {
    count?: number;
    games?: TgdbGameRow[];
  };
  include?: {
    boxart?: TgdbBoxartInclude;
  };
}

// Shared response cache; cleared on server restart.
const cache = new ApiCache(60 * 60 * 1000);

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const match = date.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
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

export const tgdb = {
  get cache() {
    return cache;
  },

  async searchGames(apiKey: string | null, query: string): Promise<TgdbGameResult[] | null> {
    if (!apiKey) return null;
    const url = `${TGDB_BASE}/v1.1/Games/ByGameName?apikey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(query)}&include=boxart`;
    return withDegradation(
      async () => {
        const data = await cache.get<TgdbSearchResponse>(`tgdb:search:${query.toLowerCase()}`, async () => {
          const json = await externalFetchJson<TgdbSearchResponse>(url);
          return json;
        });
        return dedupeByGameId(data.data?.games || [])
          .filter((r) => r.game_title)
          .map((row) => ({
            externalId: String(row.id),
            title: row.game_title,
            releaseYear: yearFromDate(row.release_date),
            imageUrl: imageUrlFor(String(row.id), data.include?.boxart),
            externalUrl: `https://www.thegamesdb.net/game/${row.id}`,
          }));
      },
      null,
      `TGDB game search "${query}"`
    );
  },
};
