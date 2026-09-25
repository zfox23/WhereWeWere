import { beforeEach, describe, expect, it, vi } from 'vitest';
import { igdb, pickIgdbCandidate, clearIgdbToken, type IgdbGameResult } from '../services/igdb';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const CLIENT_ID = 'client-id-123';
const CLIENT_SECRET = 'secret-456';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Respond in order: first to the token endpoint, then to /v4/games. */
function mockTokenThenQuery(tokenBody: unknown, queryBody: unknown, queryOk = true, queryStatus = 200) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(tokenBody))
    .mockResolvedValueOnce(jsonResponse(queryBody, queryOk, queryStatus));
}

function gameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1942,
    name: 'Halo',
    slug: 'halo',
    summary: '<p>Master Chief defends <b>Earth</b>.</p>',
    first_release_date: 1036444800, // 2002-07-05
    release_dates: [{ y: 2002, date: 1036444800 }],
    cover: { image_id: 'abc123' },
    platforms: [{ name: 'PC' }],
    genres: [{ name: 'Shooter' }],
    involved_companies: [
      { developer: true, publisher: false, company: { name: 'Bungie' } },
      { developer: false, publisher: true, company: { name: 'Microsoft' } },
    ],
    age_ratings: [{ organization: 'ESRB', rating_category: { rating: 'T' } }],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  igdb.clearAll();
  clearIgdbToken();
});

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

describe('igdb token cache', () => {
  it('exchanges client credentials once and reuses the token', async () => {
    mockTokenThenQuery({ access_token: 'tok-1', expires_in: 5_184_000 }, [gameRow()]);
    mockTokenThenQuery({ access_token: 'tok-1', expires_in: 5_184_000 }, [gameRow()]);

    await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');
    await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('id.twitch.tv'));
    expect(tokenCalls).toHaveLength(1);
    const [url, init] = tokenCalls[0] as unknown as [string, RequestInit];
    expect(url).toContain('grant_type=client_credentials');
    expect(url).toContain(`client_id=${CLIENT_ID}`);
    expect(url).toContain(`client_secret=${CLIENT_SECRET}`);
    expect(init.method).toBe('POST');
  });

  it('refetches the token after it expires', async () => {
    vi.useFakeTimers();
    try {
      // expires_in = 1800s → below the 1h refresh margin → cached with the
      // 60s floor; advance past that floor to force a refetch.
      mockTokenThenQuery({ access_token: 'tok-old', expires_in: 1800 }, [gameRow()]);
      mockTokenThenQuery({ access_token: 'tok-new', expires_in: 5_184_000 }, [gameRow()]);

      await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');
      igdb.cache.clear(); // don't let the response cache mask the token refetch
      vi.advanceTimersByTime(61_000);
      await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');
    } finally {
      vi.useRealTimers();
    }

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('id.twitch.tv'));
    expect(tokenCalls).toHaveLength(2);
  });

  it('refreshes the token once after a 401 from the games endpoint', async () => {
    mockTokenThenQuery({ access_token: 'tok-old', expires_in: 5_184_000 }, null, false, 401);
    mockTokenThenQuery({ access_token: 'tok-new', expires_in: 5_184_000 }, [gameRow()]);

    const result = await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');
    expect(result?.externalId).toBe('1942');

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('id.twitch.tv'));
    expect(tokenCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// searchGames
// ---------------------------------------------------------------------------

describe('igdb.searchGames', () => {
  it('returns null without credentials (no network call)', async () => {
    expect(await igdb.searchGames(null, 'secret', 'halo')).toBeNull();
    expect(await igdb.searchGames(CLIENT_ID, null, 'halo')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an escaped APICalypse search excluding versions/editions', async () => {
    mockTokenThenQuery({ access_token: 'tok', expires_in: 5_184_000 }, [gameRow()]);

    await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'The "Legend" of Zelda');

    const gameCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v4/games'));
    expect(gameCall).toBeDefined();
    const [url, init] = gameCall as unknown as [string, RequestInit];
    expect(url).toBe('https://api.igdb.com/v4/games');
    expect(init.headers).toMatchObject({ 'Client-ID': CLIENT_ID, Authorization: 'Bearer tok', 'Content-Type': 'text/plain' });
    const body = init.body as string;
    expect(body).toContain('search "The ""Legend"" of Zelda";');
    expect(body).toContain('where version_parent = null;');
    expect(body).toContain('genres.name');
    expect(body).toContain('involved_companies.company.name');
    expect(body).toContain('age_ratings.rating_category.rating');
    expect(body).toContain('limit 25;');
  });

  it('filters out description-only hits (no strict title match)', async () => {
    mockTokenThenQuery(
      { access_token: 'tok', expires_in: 5_184_000 },
      [
        gameRow({ id: 1, name: 'Halo', slug: 'halo' }),
        gameRow({ id: 2, name: 'Halo Wars 2', slug: 'halo-wars-2' }),
        gameRow({ id: 3, name: 'Starcraft: Wings of Liberty', slug: 'sc2-wol' }),
      ]
    );

    const result = await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo');
    expect(result?.map((r) => r.title)).toEqual(['Halo']);
  });

  it('orders exact matches before edition matches', async () => {
    mockTokenThenQuery(
      { access_token: 'tok', expires_in: 5_184_000 },
      [
        // "Remastered" is an edition qualifier; both survive the strict filter.
        gameRow({ id: 2, name: 'Halo Remastered', slug: 'halo-remastered' }),
        gameRow({ id: 1, name: 'Halo', slug: 'halo' }),
      ]
    );

    const result = (await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo'))!;
    expect(result.map((r) => r.title)).toEqual(['Halo', 'Halo Remastered']);
  });

  it('filters by platform, falling back to unfiltered when nothing matches', async () => {
    mockTokenThenQuery(
      { access_token: 'tok', expires_in: 5_184_000 },
      [gameRow({ id: 1, name: 'Halo', platforms: [{ name: 'PC' }, { name: 'PlayStation 5' }] })]
    );

    const ps5 = await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo', 'PS5');
    expect(ps5?.map((r) => r.title)).toEqual(['Halo']);

    const x360 = await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo', 'Xbox 360');
    expect(x360?.map((r) => r.title)).toEqual(['Halo']);
  });

  it('maps fields: cover image, release year, ESRB rating, companies, html-stripped overview', async () => {
    mockTokenThenQuery({ access_token: 'tok', expires_in: 5_184_000 }, [gameRow()]);

    const result = await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo');
    expect(result).toEqual([
      {
        externalId: '1942',
        title: 'Halo',
        releaseYear: 2002,
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
        externalUrl: 'https://www.igdb.com/games/halo',
        platform: 'PC',
        overview: 'Master Chief defends Earth.',
        contentRating: 'T',
        players: null,
        coop: null,
        genres: ['Shooter'],
        developers: ['Bungie'],
        publishers: ['Microsoft'],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getGameDetails
// ---------------------------------------------------------------------------

describe('igdb.getGameDetails', () => {
  it('fetches a single game by id and maps it', async () => {
    mockTokenThenQuery({ access_token: 'tok', expires_in: 5_184_000 }, [gameRow()]);

    const result = await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942');
    expect(result?.externalId).toBe('1942');
    expect(result?.title).toBe('Halo');

    const gameCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v4/games'));
    expect(gameCall).toBeDefined();
    expect(gameCall![1].body).toContain('where id = 1942;');
  });

  it('returns null when the id is unknown', async () => {
    mockTokenThenQuery({ access_token: 'tok', expires_in: 5_184_000 }, []);
    expect(await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '999999')).toBeNull();
  });

  it('degrades to null on network failure (no throw)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 5_184_000 }));
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await igdb.getGameDetails(CLIENT_ID, CLIENT_SECRET, '1942')).toBeNull();
  });

  it('degrades to null when the token request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('bad credentials'));
    expect(await igdb.searchGames(CLIENT_ID, CLIENT_SECRET, 'halo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickIgdbCandidate
// ---------------------------------------------------------------------------

describe('pickIgdbCandidate', () => {
  const mk = (id: number, title: string, platforms: string[]): { result: IgdbGameResult; platforms: string[] } => ({
    result: {
      externalId: String(id),
      title,
      releaseYear: null,
      imageUrl: null,
      externalUrl: `https://www.igdb.com/games/${id}`,
      platform: platforms[0] ?? null,
      overview: null,
      contentRating: null,
      players: null,
      coop: null,
      genres: null,
      developers: null,
      publishers: null,
    },
    platforms,
  });

  it('returns null for no candidates', () => {
    expect(pickIgdbCandidate({ title: 'X' }, [])).toBeNull();
  });

  it('prefers the stored platform (alias-aware)', () => {
    const candidates = [mk(1, 'Zelda', ['Nintendo 64']), mk(2, 'Zelda', ['PC'])];
    const pick = pickIgdbCandidate({ title: 'Zelda', platform: 'PC' }, candidates);
    expect(pick?.result.externalId).toBe('2');
  });

  it('falls back to console history when no stored platform matches (PC > PS5 > … > GBC)', () => {
    const candidates = [
      mk(1, 'Game', ['Game Boy Color']),
      mk(2, 'Game', ['PlayStation 5']),
      mk(3, 'Game', ['PC']),
    ];
    // No stored platform → PC wins.
    expect(pickIgdbCandidate({ title: 'Game', platform: null }, candidates)?.result.externalId).toBe('3');
    // Stored platform that no candidate supports → console priority again.
    expect(pickIgdbCandidate({ title: 'Game', platform: 'Dreamcast' }, candidates)?.result.externalId).toBe('3');

    const noPc = [candidates[0], candidates[1]];
    expect(pickIgdbCandidate({ title: 'Game', platform: null }, noPc)?.result.externalId).toBe('2');
    expect(pickIgdbCandidate({ title: 'Game', platform: null }, [candidates[0]])?.result.externalId).toBe('1');
  });

  it('picks the first candidate arbitrarily when nothing else applies', () => {
    const candidates = [mk(1, 'Game', ['Dreamcast']), mk(2, 'Game', ['Sega Saturn'])];
    expect(pickIgdbCandidate({ title: 'Game', platform: null }, candidates)?.result.externalId).toBe('1');
  });
});
