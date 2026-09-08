import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tgdb } from '../../src/services/tgdb';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const searchBody = {
  code: 200,
  status: 'Success',
  remaining_monthly_allowance: 249,
  extra_allowance: 0,
  data: {
    count: 2,
    games: [
      { id: 53, game_title: 'Sonic the Hedgehog', release_date: '1991-06-23', platform: 18 },
      { id: 53, game_title: 'Sonic the Hedgehog', release_date: '1991-06-23', platform: 19, region_id: 2 },
      { id: 432, game_title: 'Sonic the Hedgehog 2', release_date: '1992-11-24', platform: 18 },
    ],
  },
  include: {
    boxart: {
      base_url: {
        medium: 'https://cdn.thegamesdb.net/images/medium/',
      },
      data: {
        '53': [{ id: 1, type: 'boxart', side: 'front', filename: 'boxart/front/53-1.jpg' }],
        '432': [{ id: 2, type: 'screenshot', side: null, filename: 'screenshots/432-1.jpg' }],
      },
    },
    platform: {
      data: {
        '18': { id: 18, name: 'Sega Genesis', alias: 'sega-genesis' },
        '19': { id: 19, name: 'Sega Saturn', alias: 'sega-saturn' },
      },
    },
  },
};

describe('tgdb.searchGames', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(searchBody));
    vi.stubGlobal('fetch', fetchMock);
    tgdb.cache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    tgdb.cache.clear();
  });

  it('returns null without an API key and does not fetch', async () => {
    await expect(tgdb.searchGames(null, 'ssx')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the v1.1 ByGameName endpoint with apikey and name', async () => {
    await tgdb.searchGames('KEY', 'ssx');
    const url = fetchMock.mock.calls[0][0] as string;
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.thegamesdb.net');
    expect(parsed.pathname).toBe('/v1.1/Games/ByGameName');
    expect(parsed.searchParams.get('apikey')).toBe('KEY');
    expect(parsed.searchParams.get('name')).toBe('ssx');
    expect(parsed.searchParams.get('fields')).toBe('platform');
    expect(parsed.searchParams.get('include')).toBe('boxart,platform');
  });

  it('maps rows, dedupes by game id, and picks front boxart', async () => {
    const results = await tgdb.searchGames('KEY', 'ssx');
    expect(results).toEqual([
      {
        externalId: '53',
        title: 'Sonic the Hedgehog',
        releaseYear: 1991,
        imageUrl: 'https://cdn.thegamesdb.net/images/medium/boxart/front/53-1.jpg',
        externalUrl: 'https://www.thegamesdb.net/game/53',
        platform: 'Sega Genesis',
      },
      {
        externalId: '432',
        title: 'Sonic the Hedgehog 2',
        releaseYear: 1992,
        imageUrl: null,
        externalUrl: 'https://www.thegamesdb.net/game/432',
        platform: 'Sega Genesis',
      },
    ]);
  });

  it('leaves platform null when the game has no platform or the platform list omits it', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        data: {
          games: [
            { id: 9, game_title: 'SSX Tricky', release_date: '2001-10-09' },
            { id: 10, game_title: 'Mystery', release_date: '2001-10-09', platform: 7 },
          ],
        },
      })
    );
    const results = await tgdb.searchGames('KEY', 'ssx-platform');
    expect(results).toEqual([
      {
        externalId: '9',
        title: 'SSX Tricky',
        releaseYear: 2001,
        imageUrl: null,
        externalUrl: 'https://www.thegamesdb.net/game/9',
        platform: null,
      },
      {
        externalId: '10',
        title: 'Mystery',
        releaseYear: 2001,
        imageUrl: null,
        externalUrl: 'https://www.thegamesdb.net/game/10',
        platform: null,
      },
    ]);
  });

  it('keeps the row with the earliest release date on dedupe', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        data: {
          games: [
            { id: 7, game_title: 'SSX', release_date: '2005-12-01', platform: 1 },
            { id: 7, game_title: 'SSX', release_date: '2002-10-08', platform: 2 },
          ],
        },
      })
    );
    const results = await tgdb.searchGames('KEY', 'ssx-2');
    expect(results).toHaveLength(1);
    expect(results![0].releaseYear).toBe(2002);
  });

  it('falls back to the default CDN base url when base_url is omitted', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        data: {
          games: [{ id: 9, game_title: 'SSX Tricky', release_date: null }],
        },
        include: {
          boxart: {
            data: { '9': [{ id: 1, type: 'boxart', side: 'front', filename: 'boxart/front/9-1.jpg' }] },
          },
        },
      })
    );
    const results = await tgdb.searchGames('KEY', 'ssx-3');
    expect(results![0].imageUrl).toBe('https://cdn.thegamesdb.net/images/medium/boxart/front/9-1.jpg');
  });

  it('serves the fallback (null) when the API returns a non-2xx status', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 404 }));
    await expect(tgdb.searchGames('KEY', 'ssx-4')).resolves.toBeNull();
  });

  it('caches responses per lowercased query', async () => {
    await tgdb.searchGames('KEY', 'SSX');
    await tgdb.searchGames('KEY', 'ssx');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
