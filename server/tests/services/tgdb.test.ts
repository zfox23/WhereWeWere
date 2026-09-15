import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgdb } from '../../src/services/tgdb';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

function gameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 53,
    game_title: 'Sonic the Hedgehog',
    release_date: '1991-06-23',
    platform: 18,
    overview: 'Join Sonic as he races through six zones.',
    rating: 'E - Everyone',
    players: 1,
    coop: 'No',
    genres: [1, 8],
    developers: [1296],
    publishers: [1],
    ...overrides,
  };
}

function searchResponse(rows: Record<string, unknown>[]) {
  return {
    data: { count: rows.length, games: rows },
    include: {
      boxart: {
        base_url: { medium: 'https://cdn.thegamesdb.net/images/medium/' },
        data: { '53': [{ type: 'boxart', side: 'front', filename: 'boxart/front/53-1.jpg' }] },
      },
      platform: { data: { '18': { id: 18, name: 'Sega Genesis', alias: 'sega-genesis' } } },
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  tgdb.clearAll();
});

describe('tgdb.searchGames', () => {
  it('requests the widened fields param', async () => {
    mockFetchOnce(searchResponse([]));

    await tgdb.searchGames('key-123', 'sonic');

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/v1.1/Games/ByGameName?');
    expect(url).toContain('fields=platform,overview,players,rating,coop');
    expect(url).toContain('include=boxart,platform');
  });

  it('maps the new metadata fields off the base payload', async () => {
    // 1) search, 2) genres by id, 3) developers by id, 4) publishers by id
    mockFetchOnce(searchResponse([gameRow()]));
    mockFetchOnce({ data: { count: 2, genres: { '1': { id: 1, name: 'Action' }, '8': { id: 8, name: 'Platform' } } } });
    mockFetchOnce({ data: { count: 1, developers: { '1296': { id: 1296, name: 'Sega' } } } });
    mockFetchOnce({ data: { count: 1, publishers: { '1': { id: 1, name: 'Sega' } } } });

    const result = await tgdb.searchGames('key-123', 'sonic');

    expect(result).toEqual([
      {
        externalId: '53',
        title: 'Sonic the Hedgehog',
        releaseYear: 1991,
        imageUrl: 'https://cdn.thegamesdb.net/images/medium/boxart/front/53-1.jpg',
        externalUrl: 'https://thegamesdb.net/game.php?id=53',
        platform: 'Sega Genesis',
        overview: 'Join Sonic as he races through six zones.',
        contentRating: 'E - Everyone',
        players: 1,
        coop: 'No',
        genres: ['Action', 'Platform'],
        developers: ['Sega'],
        publishers: ['Sega'],
      },
    ]);
  });

  it('batches name lookups: one By*ID call per category for all candidate rows', async () => {
    // Two games sharing genre id 1 but with different developer ids → the
    // batched call must carry the union of ids, and only 3 extra calls total.
    mockFetchOnce(searchResponse([gameRow({ developers: [1296] }), gameRow({ id: 432, game_title: 'Sonic 2', developers: [99], genres: [1] })]));
    mockFetchOnce({ data: { count: 1, genres: { '1': { id: 1, name: 'Action' } } } });
    mockFetchOnce({ data: { count: 2, developers: { '1296': { id: 1296, name: 'Sega' }, '99': { id: 99, name: 'Other' } } } });
    mockFetchOnce({ data: { count: 1, publishers: { '1': { id: 1, name: 'Sega' } } } });

    const result = await tgdb.searchGames('key-123', 'sonic');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const devUrl = fetchMock.mock.calls[2][0] as string;
    expect(devUrl).toContain('/v1/Developers/ByDeveloperID?');
    expect(devUrl).toContain('id=1296%2C99');
    expect(result?.[0].developers).toEqual(['Sega']);
    expect(result?.[1].developers).toEqual(['Other']);
    expect(result?.[1].genres).toEqual(['Action']);
  });

  it('skips name lookups when rows carry no id arrays', async () => {
    mockFetchOnce(searchResponse([gameRow({ genres: undefined, developers: undefined, publishers: undefined })]));

    const result = await tgdb.searchGames('key-123', 'sonic');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.[0].genres).toBeNull();
    expect(result?.[0].developers).toBeNull();
    expect(result?.[0].publishers).toBeNull();
  });

  it('drops unknown ids; null when a category fully fails to resolve', async () => {
    mockFetchOnce(searchResponse([gameRow({ genres: [1, 424242] })]));
    mockFetchOnce({ data: { count: 1, genres: { '1': { id: 1, name: 'Action' } } } });
    mockFetchOnce({ data: { count: 0, developers: {} } });
    mockFetchOnce({ data: { count: 1, publishers: { '1': { id: 1, name: 'Sega' } } } });

    const result = await tgdb.searchGames('key-123', 'sonic');

    expect(result?.[0].genres).toEqual(['Action']);
  });

  it('reuses resolved names across calls without extra API hits', async () => {
    mockFetchOnce(searchResponse([gameRow()]));
    mockFetchOnce({ data: { count: 2, genres: { '1': { id: 1, name: 'Action' }, '8': { id: 8, name: 'Platform' } } } });
    mockFetchOnce({ data: { count: 1, developers: { '1296': { id: 1296, name: 'Sega' } } } });
    mockFetchOnce({ data: { count: 1, publishers: { '1': { id: 1, name: 'Sega' } } } });
    await tgdb.searchGames('key-123', 'sonic');

    // Second search for a different title: the response cache misses, but the
    // persistent name maps serve every id → exactly one fetch.
    fetchMock.mockClear();
    mockFetchOnce(searchResponse([gameRow()]), true);
    const result = await tgdb.searchGames('key-123', 'sonic the hedgehog');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.[0].genres).toEqual(['Action', 'Platform']);
  });

  it('returns null without an API key', async () => {
    const result = await tgdb.searchGames(null, 'sonic');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tgdb.getGameDetails', () => {
  it('requests the widened fields param on the v1 ByGameID endpoint', async () => {
    mockFetchOnce(searchResponse([gameRow()]));
    mockFetchOnce({ data: { count: 2, genres: { '1': { id: 1, name: 'Action' }, '8': { id: 8, name: 'Platform' } } } });
    mockFetchOnce({ data: { count: 1, developers: { '1296': { id: 1296, name: 'Sega' } } } });
    mockFetchOnce({ data: { count: 1, publishers: { '1': { id: 1, name: 'Sega' } } } });

    const result = await tgdb.getGameDetails('key-123', '53');

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/v1/Games/ByGameID?');
    expect(url).toContain('fields=platform,overview,players,rating,coop');
    expect(result?.overview).toBe('Join Sonic as he races through six zones.');
    expect(result?.contentRating).toBe('E - Everyone');
    expect(result?.players).toBe(1);
    expect(result?.coop).toBe('No');
    expect(result?.genres).toEqual(['Action', 'Platform']);
  });

  it('returns null when the id lookup yields no games', async () => {
    mockFetchOnce(searchResponse([]));
    const result = await tgdb.getGameDetails('key-123', '999999');
    expect(result).toBeNull();
  });

  it('degrades to null on API failure', async () => {
    mockFetchOnce(null, false, 403);
    const result = await tgdb.getGameDetails('key-123', '53');
    expect(result).toBeNull();
  });
});
