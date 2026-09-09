import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hardcover } from '../../src/services/hardcover';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function graphQlResponse(results: unknown) {
  return { data: { search: { results } } };
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  hardcover.cache.clear();
});

describe('hardcover.searchBooks', () => {
  it('returns null without an API key (no network call)', async () => {
    const result = await hardcover.searchBooks(null, 'dune');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a GraphQL query to the documented endpoint', async () => {
    mockFetchOnce(graphQlResponse([]));

    await hardcover.searchBooks('key-123', 'Dune');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.hardcover.app/v1/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key-123', 'Content-Type': 'application/json' });
    const payload = JSON.parse(init.body as string) as { query: string; variables: { q: string } };
    expect(payload.query).toContain('search(query: $q, query_type: "Book"');
    expect(payload.variables).toEqual({ q: 'Dune' });
  });

  it('parses an array of raw search documents', async () => {
    mockFetchOnce(
      graphQlResponse([
        {
          id: 9297,
          title: 'Dune',
          author_names: 'Frank Herbert',
          release_year: 1965,
          slug: 'dune',
          cached_image: { url: 'https://covers.example/dune.jpg' },
        },
      ])
    );

    const result = await hardcover.searchBooks('key-123', 'dune');
    expect(result).toEqual([
      {
        externalId: '9297',
        title: 'Dune',
        author: 'Frank Herbert',
        releaseYear: 1965,
        imageUrl: 'https://covers.example/dune.jpg',
        externalUrl: 'https://hardcover.app/books/dune',
        pageCount: null,
        seriesName: null,
        seriesPosition: null,
        seriesCount: null,
      },
    ]);
  });

  it('extracts page count and featured series info', async () => {
    mockFetchOnce(
      graphQlResponse([
        {
          id: 101,
          title: 'Terra Ignota: The Crying Stone',
          author_names: 'Adrian Tchaikovsky',
          release_year: 2019,
          slug: 'terra-ignota-the-crying-stone',
          pages: 736,
          series_names: ['Terra Ignota'],
          featured_series: { name: 'Terra Ignota', books_count: 4 },
          featured_series_position: 2,
        },
      ])
    );

    const result = await hardcover.searchBooks('key-123', 'terra ignota');
    expect(result).toEqual([
      {
        externalId: '101',
        title: 'Terra Ignota: The Crying Stone',
        author: 'Adrian Tchaikovsky',
        releaseYear: 2019,
        imageUrl: null,
        externalUrl: 'https://hardcover.app/books/terra-ignota-the-crying-stone',
        pageCount: 736,
        seriesName: 'Terra Ignota',
        seriesPosition: 2,
        seriesCount: 4,
      },
    ]);
  });

  it('falls back to series_names when featured_series has no name', async () => {
    mockFetchOnce(
      graphQlResponse([
        {
          id: 102,
          title: 'Half a Life',
          slug: 'half-a-life',
          series_names: ['A Darker Shade of Magic'],
          featured_series: { books_count: 5 },
          featured_series_position: '1',
        },
      ])
    );

    const result = await hardcover.searchBooks('key-123', 'half a life');
    expect(result).toEqual([
      {
        externalId: '102',
        title: 'Half a Life',
        author: null,
        releaseYear: null,
        imageUrl: null,
        externalUrl: 'https://hardcover.app/books/half-a-life',
        pageCount: null,
        seriesName: 'A Darker Shade of Magic',
        seriesPosition: 1,
        seriesCount: 5,
      },
    ]);
  });

  it('parses the wrapped Typesense { hits: [{ document }] } shape', async () => {
    mockFetchOnce(
      graphQlResponse({
        hits: [
          {
            document: {
              id: '555',
              title: 'Neuromancer',
              author_names: ['William Gibson'],
              slug: 'neuromancer',
              release_date_i: '463872000',
            },
          },
        ],
      })
    );

    const result = await hardcover.searchBooks('key-123', 'neuromancer');
    expect(result).toEqual([
      {
        externalId: '555',
        title: 'Neuromancer',
        author: 'William Gibson',
        releaseYear: 1984,
        imageUrl: null,
        externalUrl: 'https://hardcover.app/books/neuromancer',
        pageCount: null,
        seriesName: null,
        seriesPosition: null,
        seriesCount: null,
      },
    ]);
  });

  it('drops hits missing id or title', async () => {
    mockFetchOnce(
      graphQlResponse([
        { title: 'No Id' },
        { id: 1 },
        { id: 2, title: 'Real Book', author_names: 'Someone' },
      ])
    );

    const result = await hardcover.searchBooks('key-123', 'x');
    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe('Real Book');
  });

  it('returns null (degraded) on non-2xx responses', async () => {
    mockFetchOnce(null, false, 401);
    const result = await hardcover.searchBooks('bad-key', 'dune');
    expect(result).toBeNull();
  });

  it('returns null on GraphQL-level errors', async () => {
    mockFetchOnce({ errors: [{ message: 'Invalid token' }] });
    const result = await hardcover.searchBooks('bad-key', 'dune');
    expect(result).toBeNull();
  });

  it('returns null when SearchOutput.error is set', async () => {
    mockFetchOnce({ data: { search: { error: 'boom', results: null } } });
    const result = await hardcover.searchBooks('key-123', 'dune');
    expect(result).toBeNull();
  });

  it('returns an empty list when results are null', async () => {
    mockFetchOnce(graphQlResponse(null));
    const result = await hardcover.searchBooks('key-123', 'zzz-no-match');
    expect(result).toEqual([]);
  });

  it('caches results for identical queries', async () => {
    mockFetchOnce(graphQlResponse([{ id: 1, title: 'Cached' }]));
    await hardcover.searchBooks('key-123', 'cached');
    mockFetchOnce(graphQlResponse([]));
    const second = await hardcover.searchBooks('key-123', 'CACHED');
    expect(second).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
