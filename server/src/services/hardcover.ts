import { ApiCache, MediaApiError, externalFetchPostJson, withDegradation } from './mediaApi';

// ============================================================================
// Hardcover (hardcover.app) client.
// API: GraphQL at https://api.hardcover.app/v1/graphql
// Auth: Authorization: Bearer <api_key>
// Docs: https://docs.hardcover.app/api/guides/searching/
//
// The `search` root field returns a SearchOutput whose `results` field is an
// untyped `jsonb` scalar containing raw Typesense results. We parse it
// defensively (array of documents, or { hits: [{ document }] } wrapper).
// ============================================================================

export interface HardcoverBookResult {
  externalId: string;
  title: string;
  author: string | null;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
  /** Page count of the default physical edition. */
  pageCount: number | null;
  /** Primary series name, if the book belongs to one. */
  seriesName: string | null;
  /** This book's number in its featured series. */
  seriesPosition: number | null;
  /** Total number of books in the featured series. */
  seriesCount: number | null;
}

/** A single search hit from the raw Typesense payload (fields are loose). */
interface RawBookHit {
  id?: number | string | null;
  title?: string | null;
  name?: string | null;
  author_names?: string | string[] | null;
  authors?: { name?: string | null }[] | string[] | string | null;
  release_year?: number | string | null;
  release_date_i?: number | string | null;
  release_date?: string | null;
  slug?: string | null;
  cached_image?: Record<string, unknown> | string | null;
  image?: { url?: string | null } | Record<string, unknown> | string | null;
  cover?: { url?: string | null } | string | null;
  pages?: number | string | null;
  series_names?: string | string[] | null;
  featured_series?: { name?: string | null; books_count?: number | string | null } | null;
  featured_series_position?: number | string | null;
}

interface GraphQlSearchResponse {
  data?: {
    search?: {
      error?: string | null;
      results?: unknown;
    } | null;
  };
  errors?: { message?: string }[];
}

const GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';

const SEARCH_QUERY = `
  query SearchBooks($q: String!) {
    search(query: $q, query_type: "Book", per_page: 10, page: 1) {
      results
    }
  }
`;

const cache = new ApiCache(60 * 60 * 1000);

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function extractYear(hit: RawBookHit): number | null {
  if (hit.release_year != null) return toNumber(hit.release_year);
  // release_date_i is a Unix timestamp in seconds
  if (hit.release_date_i != null) {
    const secs = Number(hit.release_date_i);
    if (Number.isFinite(secs) && secs > 0) return new Date(secs * 1000).getUTCFullYear();
  }
  return hit.release_date ? toNumber(hit.release_date) : null;
}

function extractAuthor(hit: RawBookHit): string | null {
  if (Array.isArray(hit.author_names) && hit.author_names.length > 0) {
    return hit.author_names.map((a) => String(a).trim()).filter(Boolean).join(', ') || null;
  }
  if (typeof hit.author_names === 'string' && hit.author_names.trim()) {
    return hit.author_names.trim() || null;
  }
  if (Array.isArray(hit.authors)) {
    const names = hit.authors.map((a) => (typeof a === 'string' ? a : a?.name || '')).filter(Boolean);
    return names.join(', ') || null;
  }
  return null;
}

function extractPageCount(hit: RawBookHit): number | null {
  return toNumber(hit.pages);
}

function extractSeriesName(hit: RawBookHit): string | null {
  const featured = hit.featured_series;
  if (featured && typeof featured === 'object' && typeof featured.name === 'string' && featured.name.trim()) {
    return featured.name.trim();
  }
  if (Array.isArray(hit.series_names) && hit.series_names.length > 0) {
    return String(hit.series_names[0]).trim() || null;
  }
  if (typeof hit.series_names === 'string' && hit.series_names.trim()) {
    return hit.series_names.trim();
  }
  return null;
}

function imageFieldToUrl(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // cached_image / image objects often carry the URL under `url` or nested keys
    return imageFieldToUrl(obj.url) || imageFieldToUrl(obj.large) || imageFieldToUrl(obj.original);
  }
  return null;
}

function extractImageUrl(hit: RawBookHit): string | null {
  return (
    imageFieldToUrl(hit.image) ||
    imageFieldToUrl(hit.cached_image) ||
    imageFieldToUrl(hit.cover)
  );
}

function hitToResult(hit: RawBookHit): HardcoverBookResult | null {
  const id = hit.id != null ? String(hit.id) : null;
  const title = hit.title?.trim() || hit.name?.trim() || null;
  if (!id || !title) return null;
  const featured = hit.featured_series && typeof hit.featured_series === 'object' ? hit.featured_series : null;
  return {
    externalId: id,
    title,
    author: extractAuthor(hit),
    releaseYear: extractYear(hit),
    imageUrl: extractImageUrl(hit),
    // The web app uses /books/{slug} (plural); /book/{id} and /book/{slug}
    // both 404. Slug is always present in search results; fall back to the
    // numeric id if it's ever missing.
    externalUrl: hit.slug ? `https://hardcover.app/books/${hit.slug}` : `https://hardcover.app/books/${id}`,
    pageCount: extractPageCount(hit),
    seriesName: extractSeriesName(hit),
    seriesPosition: toNumber(hit.featured_series_position),
    seriesCount: featured ? toNumber(featured.books_count) : null,
  };
}

/**
 * `results` is untyped jsonb from Typesense. Handle both a plain array of
 * documents and the wrapped { hits: [{ document }] } shape.
 */
function parseResults(results: unknown): RawBookHit[] {
  if (Array.isArray(results)) return results as RawBookHit[];
  if (results && typeof results === 'object') {
    const obj = results as Record<string, unknown>;
    if (Array.isArray(obj.hits)) {
      return (obj.hits as { document?: unknown }[]).map((h) => h.document ?? h);
    }
  }
  return [];
}

export const hardcover = {
  get cache() {
    return cache;
  },

  async searchBooks(apiKey: string | null, query: string): Promise<HardcoverBookResult[] | null> {
    if (!apiKey) return null;
    return withDegradation(
      async () => {
        const json = await cache.get<GraphQlSearchResponse>(`hardcover:search:${query.toLowerCase()}`, async () => {
          const res = await externalFetchPostJson<GraphQlSearchResponse>(
            GRAPHQL_URL,
            { query: SEARCH_QUERY, variables: { q: query } },
            { Authorization: `Bearer ${apiKey}` }
          );
          if (res.errors?.length) {
            throw new MediaApiError(`Hardcover GraphQL error: ${res.errors.map((e) => e.message).join('; ')}`);
          }
          if (res.data?.search?.error) {
            throw new MediaApiError(`Hardcover search error: ${res.data.search.error}`);
          }
          return res;
        });
        return parseResults(json.data?.search?.results)
          .map(hitToResult)
          .filter((r): r is HardcoverBookResult => r !== null);
      },
      null,
      `Hardcover book search "${query}"`
    );
  },
};
