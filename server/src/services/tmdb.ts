import { ApiCache, externalFetchJson, withDegradation } from './mediaApi';

// ============================================================================
// TMDB (The Movie Database) client.
// v3 API: https://api.themoviedb.org/3
// ============================================================================

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export interface TmdbMovieResult {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
}

export interface TmdbTvResult {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
}

export interface TmdbSeasonInfo {
  seasonNumber: number;
  episodeCount: number;
}

export interface TmdbEpisodeInfo {
  episodeNumber: number;
  episodeTitle: string | null;
}

interface TmdbSearchMovieRow {
  id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
}

interface TmdbSearchTvRow {
  id: number;
  name: string;
  first_air_date: string | null;
  poster_path: string | null;
}

interface TmdbSeasonRow {
  season_number: number;
  name: string;
  episode_count: number;
}

interface TmdbEpisodeRow {
  episode_number: number;
  name: string | null;
}

// Shared response cache; cleared on server restart.
const cache = new ApiCache(60 * 60 * 1000);

function yearFromDate(date: string | null): number | null {
  if (!date) return null;
  const match = date.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function movieToResult(row: TmdbSearchMovieRow): TmdbMovieResult {
  return {
    externalId: String(row.id),
    title: row.title,
    releaseYear: yearFromDate(row.release_date),
    imageUrl: row.poster_path ? `${TMDB_IMAGE_BASE}${row.poster_path}` : null,
    externalUrl: `https://www.themoviedb.org/movie/${row.id}`,
  };
}

function tvToResult(row: TmdbSearchTvRow): TmdbTvResult {
  return {
    externalId: String(row.id),
    title: row.name,
    releaseYear: yearFromDate(row.first_air_date),
    imageUrl: row.poster_path ? `${TMDB_IMAGE_BASE}${row.poster_path}` : null,
    externalUrl: `https://www.themoviedb.org/tv/${row.id}`,
  };
}

export const tmdb = {
  get cache() {
    return cache;
  },

  async searchMovies(apiKey: string | null, query: string): Promise<TmdbMovieResult[] | null> {
    if (!apiKey) return null;
    const url = `${TMDB_BASE}/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`;
    return withDegradation(
      async () => {
        const data = await cache.get<{ results: TmdbSearchMovieRow[] }>(`tmdb:search:movie:${query.toLowerCase()}`, async () => {
          const json = await externalFetchJson<{ results: TmdbSearchMovieRow[] }>(url);
          return json;
        });
        return (data.results || []).filter((r) => r.title).map(movieToResult);
      },
      null,
      `TMDB movie search "${query}"`
    );
  },

  async searchTv(apiKey: string | null, query: string): Promise<TmdbTvResult[] | null> {
    if (!apiKey) return null;
    const url = `${TMDB_BASE}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&language=en-US&page=1`;
    return withDegradation(
      async () => {
        const data = await cache.get<{ results: TmdbSearchTvRow[] }>(`tmdb:search:tv:${query.toLowerCase()}`, async () => {
          const json = await externalFetchJson<{ results: TmdbSearchTvRow[] }>(url);
          return json;
        });
        return (data.results || []).filter((r) => r.name).map(tvToResult);
      },
      null,
      `TMDB TV search "${query}"`
    );
  },

  async getShowSeasons(apiKey: string | null, tmdbId: string): Promise<TmdbSeasonInfo[] | null> {
    if (!apiKey) return null;
    // There is no /tv/{series_id}/seasons endpoint; the seasons array is
    // embedded in the show details response (GET /tv/{series_id}).
    const url = `${TMDB_BASE}/tv/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`;
    return withDegradation(
      async () => {
        const data = await cache.get<{ seasons?: TmdbSeasonRow[] }>(`tmdb:seasons:${tmdbId}`, async () => {
          const json = await externalFetchJson<{ seasons?: TmdbSeasonRow[] }>(url);
          return json;
        });
        // season_number 0 is usually specials; skip it.
        return (data.seasons || [])
          .filter((s) => s.season_number > 0)
          .map((s) => ({ seasonNumber: s.season_number, episodeCount: s.episode_count }));
      },
      null,
      `TMDB seasons for show ${tmdbId}`
    );
  },

  async getShowEpisodes(apiKey: string | null, tmdbId: string, seasonNumber: number): Promise<TmdbEpisodeInfo[] | null> {
    if (!apiKey) return null;
    const url = `${TMDB_BASE}/tv/${encodeURIComponent(tmdbId)}/season/${seasonNumber}?api_key=${encodeURIComponent(apiKey)}&language=en-US`;
    return withDegradation(
      async () => {
        const data = await cache.get<{ episodes: TmdbEpisodeRow[] }>(`tmdb:episodes:${tmdbId}:${seasonNumber}`, async () => {
          const json = await externalFetchJson<{ episodes: TmdbEpisodeRow[] }>(url);
          return json;
        });
        return (data.episodes || []).map((e) => ({ episodeNumber: e.episode_number, episodeTitle: e.name }));
      },
      null,
      `TMDB episodes for show ${tmdbId} season ${seasonNumber}`
    );
  },
};
