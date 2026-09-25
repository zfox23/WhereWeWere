// ============================================================================
// IGDB (The Internet Games Database) provider — primary for game metadata.
//
// Auth: IGDB runs on Twitch OAuth. A free Twitch application (Confidential)
// yields a Client ID + Client Secret; the client_credentials grant exchanges
// them for a bearer token that lives ~60 days. The token is cached in-process
// and refreshed before expiry (or immediately after a 401).
//
// Requests are POSTs to /v4/games with a plain-text APICalypse query body.
// Dot-expanders (genres.name, involved_companies, age_ratings, platforms.name)
// inline related data in a single response, so — unlike TGDB — no separate
// by-id name-resolution calls are needed.
//
// Rate limit: 4 requests/second (HTTP 429). This app issues at most one query
// per user action plus the shared ApiCache single-flight dedupe, so no
// additional throttling is required.
// ============================================================================

import { ApiCache, externalFetchPostText, withDegradation } from './mediaApi';
import { normalizeTitle, titleRelation } from './titleMatch';

const IGDB_BASE = 'https://api.igdb.com/v4';
const IGDB_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_IMAGES_BASE = 'https://images.igdb.com/igdb/image/upload';

// APICalypse fields requested. `involved_companies` is expanded with a dot
// expander for the company name; `age_ratings` uses the post-rename field
// names (organization / rating_category) per the docs' migration notes.
const GAME_FIELDS = [
  'id',
  'name',
  'slug',
  'summary',
  'first_release_date',
  'release_dates.y',
  'cover.image_id',
  'platforms.name',
  'genres.name',
  'involved_companies.company.name',
  'age_ratings',
  'age_ratings.rating_category.rating',
].join(',');

// ---------------------------------------------------------------------------
// Response row shapes (IGDB returns plain arrays of objects, one per match).
// ---------------------------------------------------------------------------

interface IgdbCover {
  image_id?: string | null;
}

interface IgdbReleaseDate {
  y?: number | null;
  date?: number | null;
  platform?: number | null;
}

interface IgdbPlatform {
  name?: string | null;
}

interface IgdbGenre {
  name?: string | null;
}

interface IgdbCompany {
  name?: string | null;
}

interface IgdbInvolvedCompany {
  developer?: boolean;
  publisher?: boolean;
  company?: IgdbCompany;
}

interface IgdbRatingCategory {
  rating?: string | null;
}

interface IgdbAgeRating {
  organization?: string | null;
  rating_category?: IgdbRatingCategory;
}

interface IgdbGameRow {
  id?: number;
  name?: string | null;
  slug?: string | null;
  summary?: string | null;
  first_release_date?: number | null;
  release_dates?: IgdbReleaseDate[];
  cover?: IgdbCover;
  platforms?: IgdbPlatform[];
  genres?: IgdbGenre[];
  involved_companies?: IgdbInvolvedCompany[];
  age_ratings?: IgdbAgeRating[];
}

interface TwitchTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * Result shape mirrors TgdbGameResult so server dispatch code is uniform.
 * IGDB has no player-count or co-op fields: those are always null.
 */
export interface IgdbGameResult {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
  platform: string | null;
  overview: string | null;
  contentRating: string | null;
  players: number | null;
  coop: string | null;
  genres: string[] | null;
  developers: string[] | null;
  publishers: string[] | null;
}

// ---------------------------------------------------------------------------
// Small field mappers
// ---------------------------------------------------------------------------

function yearFromUnixSeconds(unixSeconds: number | null | undefined): number | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return null;
  const year = new Date(unixSeconds * 1000).getUTCFullYear();
  return year >= 1980 && year <= new Date().getUTCFullYear() + 2 ? year : null;
}

function cleanStr(value: string | null | undefined): string | null {
  if (value == null) return null;
  // Strip tags without inserting spaces so inline tags (e.g. <b>) don't
  // leave stray whitespace before punctuation.
  const s = String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

function namesFrom(rows: { name?: string | null }[] | null | undefined): string[] | null {
  if (!rows || rows.length === 0) return null;
  const names = rows.map((r) => cleanStr(r?.name)).filter((n): n is string => n != null);
  return names.length > 0 ? [...new Set(names)] : null;
}

function rowToResult(row: IgdbGameRow): IgdbGameResult | null {
  const title = cleanStr(row.name);
  if (!title || row.id == null) return null;
  const releaseYear =
    yearFromUnixSeconds(row.first_release_date) ??
    yearFromUnixSeconds(row.release_dates?.[0]?.date) ??
    row.release_dates?.[0]?.y ??
    null;
  const imageId = row.cover?.image_id;
  const companies = row.involved_companies ?? [];
  const developers = namesFrom(companies.filter((c) => c.developer).map((c) => c.company ?? {}));
  const publishers = namesFrom(companies.filter((c) => c.publisher).map((c) => c.company ?? {}));
  // Prefer an ESRB rating when present; otherwise the first rating with a label.
  const esrb = (row.age_ratings ?? []).find((r) => r.organization?.toLowerCase() === 'esrb');
  const contentRating = cleanStr(esrb?.rating_category?.rating) ?? cleanStr(row.age_ratings?.[0]?.rating_category?.rating);
  return {
    externalId: String(row.id),
    title,
    releaseYear,
    imageUrl: imageId ? `${IGDB_IMAGES_BASE}/t_cover_big/${imageId}.jpg` : null,
    externalUrl: row.slug ? `https://www.igdb.com/games/${row.slug}` : `https://www.igdb.com/games/${row.id}`,
    platform: cleanStr(row.platforms?.[0]?.name),
    overview: cleanStr(row.summary),
    contentRating,
    players: null,
    coop: null,
    genres: namesFrom(row.genres),
    developers,
    publishers,
  };
}

/** Escape an APICalypse string literal (the only special character is "). */
function apicalypseQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Token cache (in-process; the server is single-user).
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

export function clearIgdbToken(): void {
  tokenCache = null;
  tokenInFlight = null;
}

function fetchNewToken(clientId: string, clientSecret: string): Promise<string> {
  const url = `${IGDB_TOKEN_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  return (async () => {
    try {
      const res = await fetch(url, { method: 'POST', signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`IGDB token request returned ${res.status} ${body}`.trim());
      }
      const data = (await res.json()) as TwitchTokenResponse;
      if (!data.access_token) throw new Error('IGDB token response missing access_token');
      // Refresh a full hour before the stated expiry as a safety margin.
      const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 60 * 24 * 3600;
      tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + Math.max((expiresInSec - 3600) * 1000, 60_000),
      };
      return data.access_token;
    } finally {
      clearTimeout(timeout);
    }
  })();
}

/** Return a valid bearer token, refreshing it if missing or near expiry. */
export function getIgdbToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return Promise.resolve(tokenCache.token);
  }
  if (!tokenInFlight) {
    tokenInFlight = fetchNewToken(clientId, clientSecret).finally(() => {
      tokenInFlight = null;
    });
  }
  return tokenInFlight;
}

// ---------------------------------------------------------------------------
// Query execution (single 401 retry with a fresh token)
// ---------------------------------------------------------------------------

async function igdbQuery(clientId: string, clientSecret: string, apicalypse: string): Promise<IgdbGameRow[]> {
  const doFetch = async (token: string) =>
    externalFetchPostText<IgdbGameRow[] | null>(
      `${IGDB_BASE}/games`,
      apicalypse,
      { 'Client-ID': clientId, Authorization: `Bearer ${token}` }
    );
  let token: string;
  try {
    token = await getIgdbToken(clientId, clientSecret);
  } catch (err) {
    throw err; // token failure → caller degrades
  }
  try {
    const rows = await doFetch(token);
    return rows ?? [];
  } catch (err) {
    // A 401 means the (possibly stale) token was rejected: drop it once and retry.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401')) {
      clearIgdbToken();
      token = await getIgdbToken(clientId, clientSecret);
      const rows = await doFetch(token);
      return rows ?? [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Platform matching (shared by search filtering and re-key candidate selection)
// ---------------------------------------------------------------------------

/**
 * Aliases from the app's short platform names to the names IGDB uses.
 * Matched case-insensitively as a whole string against a candidate's
 * platform list.
 */
const PLATFORM_ALIASES: Record<string, string[]> = {
  'pc': ['pc'],
  'ps5': ['playstation 5', 'ps5'],
  'ps4': ['playstation 4', 'ps4'],
  'ps3': ['playstation 3', 'ps3'],
  'ps2': ['playstation 2', 'ps2'],
  'ps1': ['playstation', 'psp', 'ps1', 'playstation 1'],
  'psp': ['psp'],
  'game boy color': ['game boy color', 'gbc'],
  'gbc': ['game boy color', 'gbc'],
  'game boy advance': ['game boy advance', 'gba'],
  'gba': ['game boy advance', 'gba'],
  'nintendo switch': ['nintendo switch'],
  'switch': ['nintendo switch'],
  'xbox series x': ['xbox series x/s', 'xbox series x'],
  'xbox one': ['xbox one'],
  'xbox 360': ['xbox 360'],
};

function platformMatches(stored: string, candidatePlatforms: string[]): boolean {
  const key = stored.trim().toLowerCase();
  if (!key) return false;
  const wanted = new Set<string>([key, ...(PLATFORM_ALIASES[key] ?? [])]);
  return candidatePlatforms.some((p) => wanted.has(p.trim().toLowerCase()));
}

/**
 * Console priority for disambiguating multi-platform games, per the user's
 * personal history. When no stored platform narrows the candidates, prefer a
 * candidate released on the first console in this list that at least one
 * candidate supports.
 */
const CONSOLE_PRIORITY = ['pc', 'ps5', 'ps4', 'ps3', 'ps2', 'ps1', 'game boy color'];

export interface IgdbCandidate {
  result: IgdbGameResult;
  platforms: string[];
}

/**
 * Pick one IGDB candidate for a row being (re)keyed. `candidates` must
 * already be filtered to strict same-game title matches. Returns null only
 * when there are no candidates at all.
 *
 * Priority: (1) the row's stored platform, if any candidate supports it;
 * (2) the first console in CONSOLE_PRIORITY that a candidate supports;
 * (3) the first candidate, arbitrarily.
 */
export function pickIgdbCandidate(row: { title: string; platform?: string | null }, candidates: IgdbCandidate[]): IgdbCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const stored = row.platform?.trim();
  if (stored) {
    const byPlatform = candidates.filter((c) => platformMatches(stored, c.platforms));
    if (byPlatform.length > 0) return byPlatform[0];
  }
  for (const console_ of CONSOLE_PRIORITY) {
    const byConsole = candidates.filter((c) => platformMatches(console_, c.platforms));
    if (byConsole.length > 0) return byConsole[0];
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Provider singleton (mirrors the tgdb/tmdb pattern)
// ---------------------------------------------------------------------------

const cache = new ApiCache(60 * 60 * 1000);

export const igdb = {
  get cache() {
    return cache;
  },

  /** Clear the response cache and the cached OAuth token. */
  clearAll(): void {
    cache.clear();
    clearIgdbToken();
  },

  hasCredentials(clientId: string | null, clientSecret: string | null): boolean {
    return !!(clientId && clientSecret);
  },

  /**
   * Search games by name and return strict same-game title matches (exact
   * or edition; exact ordered first) with each match's full platform list,
   * for candidate selection (see pickIgdbCandidate). Returns null when
   * credentials are missing or the API call fails.
   */
  async searchCandidates(
    clientId: string | null,
    clientSecret: string | null,
    query: string
  ): Promise<IgdbCandidate[] | null> {
    if (!this.hasCredentials(clientId, clientSecret)) return null;
    const id = clientId as string;
    const secret = clientSecret as string;

    // IGDB `search` also matches description text; the version_parent filter
    // keeps editions/versions out, and the post-filter below keeps
    // description-only hits out.
    const apicalypse =
      `search ${apicalypseQuote(query)}; ` +
      `where version_parent = null; ` +
      `fields ${GAME_FIELDS}; ` +
      `limit 25;`;

    return withDegradation(
      async () => {
        const rows = await cache.get<IgdbGameRow[]>(`igdb:search:${query.toLowerCase()}`, async () => {
          return igdbQuery(id, secret, apicalypse);
        });

        const qKey = normalizeTitle(query);
        const matched: { result: IgdbGameResult; platforms: string[]; rel: 'exact' | 'edition' }[] = [];
        for (const row of rows) {
          const result = rowToResult(row);
          if (!result) continue;
          const rel = titleRelation(qKey, normalizeTitle(result.title));
          if (rel === 'none') continue;
          const platforms = (row.platforms ?? []).map((p) => p.name ?? '').filter(Boolean);
          matched.push({ result, platforms, rel });
        }
        matched.sort((a, b) => (a.rel === b.rel ? 0 : a.rel === 'exact' ? -1 : 1));
        return matched.map((m) => ({ result: m.result, platforms: m.platforms }));
      },
      null,
      `IGDB game search "${query}"`
    );
  },

  /**
   * Search games by name. When `platform` is given, rows are filtered to
   * candidates released on that platform; if the filter yields nothing, the
   * unfiltered list is served so a quirky stored platform string never
   * blocks a match (mirrors TGDB behavior).
   */
  async searchGames(
    clientId: string | null,
    clientSecret: string | null,
    query: string,
    platform?: string | null
  ): Promise<IgdbGameResult[] | null> {
    const candidates = await this.searchCandidates(clientId, clientSecret, query);
    if (!candidates) return null;
    if (platform?.trim()) {
      const filtered = candidates.filter((c) => platformMatches(platform, c.platforms));
      if (filtered.length > 0) return filtered.map((c) => c.result);
    }
    return candidates.map((c) => c.result);
  },

  /**
   * Fetch a single game by its IGDB id (for metadata sync).
   */
  async getGameDetails(clientId: string | null, clientSecret: string | null, gameId: string): Promise<IgdbGameResult | null> {
    if (!this.hasCredentials(clientId, clientSecret)) return null;
    const id = clientId as string;
    const secret = clientSecret as string;
    const apicalypse = `where id = ${Number(gameId)}; fields ${GAME_FIELDS};`;
    return withDegradation(
      async () => {
        const rows = await cache.get<IgdbGameRow[]>(`igdb:game:${gameId}`, async () => {
          return igdbQuery(id, secret, apicalypse);
        });
        return rows.map(rowToResult).find((r) => r != null) ?? null;
      },
      null,
      `IGDB game details ${gameId}`
    );
  },
};
