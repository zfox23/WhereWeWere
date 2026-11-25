import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOwnedGames, parseSteamIdInput, resolveSteamId, SteamError } from '../services/steam';
import { steamSessionStep, SESSION_IDLE_MS } from '../services/steamSync';
import { igdb, clearIgdbToken } from '../services/igdb';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ID = '76561197960287930';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  igdb.clearAll();
  clearIgdbToken();
});

describe('parseSteamIdInput', () => {
  it.each([
    [ID, { kind: 'steamid', steamid: ID }],
    [`  ${ID} `, { kind: 'steamid', steamid: ID }],
    [`https://steamcommunity.com/profiles/${ID}/`, { kind: 'steamid', steamid: ID }],
    [`steamcommunity.com/profiles/${ID}`, { kind: 'steamid', steamid: ID }],
    ['https://steamcommunity.com/id/gabelogannewell/', { kind: 'vanity', vanity: 'gabelogannewell' }],
    ['http://www.steamcommunity.com/id/some_name?l=en', { kind: 'vanity', vanity: 'some_name' }],
    ['gabelogannewell', { kind: 'vanity', vanity: 'gabelogannewell' }],
  ])('reads %s', (input, expected) => {
    expect(parseSteamIdInput(input)).toEqual(expected);
  });

  it.each(['', '   ', 'https://steamcommunity.com/profiles/123', 'has spaces in it', 'https://example.com/id/x'])(
    'rejects %j',
    (input) => {
      expect(parseSteamIdInput(input)).toBeNull();
    },
  );
});

describe('resolveSteamId', () => {
  it('returns a SteamID64 without calling Steam', async () => {
    expect(await resolveSteamId('key', ID)).toBe(ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a custom URL name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: { success: 1, steamid: ID } }));
    expect(await resolveSteamId('key', 'gabe')).toBe(ID);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/ISteamUser/ResolveVanityURL/v1/');
    expect(url).toContain('vanityurl=gabe');
  });

  it('reports an unknown custom URL name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: { success: 42, message: 'No match' } }));
    await expect(resolveSteamId('key', 'nobody')).rejects.toThrow(/No Steam profile uses the custom URL "nobody"/);
  });

  it('reports a rejected API key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Forbidden</html>', { status: 403 }));
    await expect(resolveSteamId('bad', 'gabe')).rejects.toBeInstanceOf(SteamError);
  });
});

describe('getOwnedGames', () => {
  it('maps games with playtime, last played and icon', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      response: {
        game_count: 2,
        games: [
          { appid: 440, name: 'Team Fortress 2', playtime_forever: 1234, rtime_last_played: 1700000000, img_icon_url: 'abc' },
          { appid: 620, name: 'Portal 2', playtime_forever: 0, rtime_last_played: 0, img_icon_url: '' },
        ],
      },
    }));
    const games = await getOwnedGames('key', ID);
    expect(games).toEqual([
      {
        appid: 440,
        name: 'Team Fortress 2',
        playtimeMinutes: 1234,
        lastPlayedAt: new Date(1700000000 * 1000),
        iconUrl: 'https://media.steampowered.com/steamcommunity/public/images/apps/440/abc.jpg',
      },
      { appid: 620, name: 'Portal 2', playtimeMinutes: 0, lastPlayedAt: null, iconUrl: null },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('include_appinfo=1');
    expect(url).toContain('include_played_free_games=1');
  });

  it('explains a private profile (Steam answers with an empty response)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: {} }));
    await expect(getOwnedGames('key', ID)).rejects.toThrow(/Game details/);
  });

  it('accepts an account that owns no games', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ response: { game_count: 0 } }));
    expect(await getOwnedGames('key', ID)).toEqual([]);
  });
});

describe('steamSessionStep', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const base = { previous: 195, current: 195, baseline: 100, lastRiseAt: hourAgo, now, matched: true };

  it('keeps the session open while playtime rises', () => {
    expect(steamSessionStep({ ...base, previous: 150 })).toEqual({ kind: 'playing' });
  });

  it('ends the session once playtime stops rising, for the whole session', () => {
    expect(steamSessionStep(base)).toEqual({ kind: 'ended', minutes: 95 });
  });

  it('waits when the last rise was too recent to call the session over', () => {
    const recent = new Date(now.getTime() - SESSION_IDLE_MS + 60_000);
    expect(steamSessionStep({ ...base, lastRiseAt: recent })).toEqual({ kind: 'waiting' });
  });

  it('records nothing on the first sync (no previous total)', () => {
    expect(steamSessionStep({ ...base, previous: null, current: 300 })).toEqual({ kind: 'idle' });
  });

  it('is idle when nothing was played since the baseline', () => {
    expect(steamSessionStep({ ...base, baseline: 195 })).toEqual({ kind: 'idle' });
    expect(steamSessionStep({ ...base, current: 50, previous: 50 })).toEqual({ kind: 'idle' });
  });

  it('is idle for an unmatched game', () => {
    expect(steamSessionStep({ ...base, matched: false })).toEqual({ kind: 'idle' });
    expect(steamSessionStep({ ...base, previous: 150, matched: false })).toEqual({ kind: 'idle' });
  });
});

describe('igdb.steamAppIdsToIgdb', () => {
  it('maps Steam rows only, by either source field', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 5_184_000 }))
      .mockResolvedValueOnce(jsonResponse([
        { game: 11, uid: '440', external_game_source: 1 },
        { game: 22, uid: '620', category: 1 },
        // A GOG row that shares a uid with a Steam app is not Steam.
        { game: 99, uid: '730', external_game_source: 5 },
      ]));
    const map = await igdb.steamAppIdsToIgdb('id', 'secret', [440, 620, 730]);
    expect(map).toEqual(new Map([[440, '11'], [620, '22']]));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe('https://api.igdb.com/v4/external_games');
    expect(String((init as RequestInit).body)).toContain('where uid = ("440","620","730")');
  });

  it('returns null without IGDB credentials', async () => {
    expect(await igdb.steamAppIdsToIgdb(null, null, [440])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
