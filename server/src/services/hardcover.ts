import { ApiCache, externalFetchJson, withDegradation } from './mediaApi';

// ============================================================================
// Hardcover (hardcover.app) client.
// API: https://api.hardcover.app/v1
// Auth: Authorization: Bearer <api_key>
// ============================================================================

export interface HardcoverBookResult {
  externalId: string;
  title: string;
  author: string | null;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
}

interface HardcoverAuthor {
  name?: string;
  slug?: string;
}

interface HardcoverBookRow {
  id: number | string;
  name?: string;
  title?: string;
  authors?: HardcoverAuthor[];
  published?: { date?: string | null; year?: number | null } | string | number | null;
  cover?: { url?: string | null } | string | null;
  slug?: string;
}

const cache = new ApiCache(60 * 60 * 1000);

function extractYear(published: HardcoverBookRow['published']): number | null {
  if (published == null) return null;
  if (typeof published === 'number') return published;
  if (typeof published === 'string') {
    const match = published.match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }
  if (typeof published.year === 'number') return published.year;
  if (published.date) {
    const match = published.date.match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }
  return null;
}

function bookToResult(row: HardcoverBookRow): HardcoverBookResult {
  const id = String(row.id);
  const authors = (row.authors || []).map((a) => a.name).filter(Boolean).join(', ');
  return {
    externalId: id,
    title: row.name || row.title || 'Untitled',
    author: authors || null,
    releaseYear: extractYear(row.published),
    imageUrl: typeof row.cover === 'string' ? row.cover : row.cover?.url || null,
    externalUrl: `https://hardcover.app/book/${id}`,
  };
}

export const hardcover = {
  get cache() {
    return cache;
  },

  async searchBooks(apiKey: string | null, query: string): Promise<HardcoverBookResult[] | null> {
    if (!apiKey) return null;
    const url = `https://api.hardcover.app/v1/books/search?query=${encodeURIComponent(query)}`;
    return withDegradation(
      async () => {
        const data = await cache.get<{ data?: HardcoverBookRow[] }>(`hardcover:search:${query.toLowerCase()}`, async () => {
          const json = await externalFetchJson<{ data?: HardcoverBookRow[] }>(url, {
            Authorization: `Bearer ${apiKey}`,
          });
          return json;
        });
        return (data.data || []).map(bookToResult).filter((r) => r.title !== 'Untitled');
      },
      null,
      `Hardcover book search "${query}"`
    );
  },
};
