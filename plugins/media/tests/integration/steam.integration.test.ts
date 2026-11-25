import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { runSteamSync } from '../../services/steamSync';
import { igdb, clearIgdbToken } from '../../services/igdb';

const STEAM_ID = '76561197960287930';

interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
}

/** What the stubbed Steam API reports as owned (per SteamID64). */
let owned: Record<string, OwnedGame[]> = {};
/** IGDB external_games rows the stub answers with. */
let igdbExternal: { game: number; uid: string; external_game_source: number }[] = [];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stub Steam and IGDB; any other URL fails fast. */
function stubFetch() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.steampowered.com') {
      if (url.searchParams.get('key') !== 'good-key') return new Response('Forbidden', { status: 403 });
      if (url.pathname.includes('ResolveVanityURL')) {
        return url.searchParams.get('vanityurl') === 'gabe'
          ? jsonResponse({ response: { success: 1, steamid: STEAM_ID } })
          : jsonResponse({ response: { success: 42 } });
      }
      if (url.pathname.includes('GetPlayerSummaries')) {
        return jsonResponse({ response: { players: [{ personaname: 'Gabe' }] } });
      }
      if (url.pathname.includes('GetOwnedGames')) {
        const games = owned[url.searchParams.get('steamid') ?? ''] ?? [];
        return jsonResponse({ response: { game_count: games.length, games } });
      }
    }
    if (url.hostname === 'id.twitch.tv') return jsonResponse({ access_token: 'tok', expires_in: 5_184_000 });
    if (url.hostname === 'api.igdb.com' && url.pathname === '/v4/external_games') return jsonResponse(igdbExternal);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function setSetting(userId: string, key: string, value: unknown) {
  await query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
     VALUES ($1, 'media', $2, $3::jsonb)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, key, JSON.stringify(value)],
  );
}

async function connectSteam(userId = DEFAULT_USER_ID, steamId = STEAM_ID) {
  await setSetting(userId, 'steam_api_key', 'good-key');
  await setSetting(userId, 'steam_id', steamId);
}

async function createGame(
  title: string,
  opts: { userId?: string; minutes?: number | null; igdbId?: string; steamAppid?: number } = {},
): Promise<string> {
  const r = await query(
    `INSERT INTO media_items (user_id, media_type, external_source, external_id, title, time_played_minutes, steam_appid)
     VALUES ($1, 'game', $2, $3, $4, $5, $6) RETURNING id`,
    [opts.userId ?? DEFAULT_USER_ID, opts.igdbId ? 'igdb' : null, opts.igdbId ?? null, title,
      opts.minutes ?? null, opts.steamAppid ?? null],
  );
  return r.rows[0].id as string;
}

async function item(id: string) {
  const r = await query('SELECT time_played_minutes, steam_appid FROM media_items WHERE id = $1', [id]);
  return r.rows[0] as { time_played_minutes: number | null; steam_appid: number | null };
}

async function checkins(itemId: string) {
  const r = await query(
    `SELECT checkin_type, time_played_minutes, external_event_id, checked_in_at
       FROM media_checkins WHERE media_item_id = $1 ORDER BY created_at`,
    [itemId],
  );
  return r.rows;
}

describe('Steam integration', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
    owned = {};
    igdbExternal = [];
    igdb.clearAll();
    clearIgdbToken();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('settings', () => {
    it('verifies a custom URL name and resolves it to a SteamID64', async () => {
      owned[STEAM_ID] = [{ appid: 440, name: 'Team Fortress 2', playtime_forever: 10 }];
      const res = await request(app).post('/api/v1/media/steam/verify').send({ api_key: 'good-key', steam_id: 'gabe' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ steamid64: STEAM_ID, persona_name: 'Gabe', game_count: 1 });
    });

    it('reports a bad key as a 400 with a readable message', async () => {
      const res = await request(app).post('/api/v1/media/steam/verify').send({ api_key: 'bad', steam_id: STEAM_ID });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/rejected the API key/);
    });

    it('stores only a SteamID64 in steam_id', async () => {
      const bad = await request(app).put('/api/v1/plugins/media/settings').send({ steam_id: 'gabe' });
      expect(bad.status).toBe(400);
      const ok = await request(app).put('/api/v1/plugins/media/settings')
        .send({ steam_api_key: 'good-key', steam_id: STEAM_ID, steam_auto_sync: false });
      expect(ok.status).toBe(200);
      const got = await request(app).get('/api/v1/plugins/media/settings');
      expect(got.body).toMatchObject({ steam_api_key: 'good-key', steam_id: STEAM_ID, steam_auto_sync: false });
    });
  });

  describe('time played merge', () => {
    it('raises time played to Steam but never lowers it', async () => {
      await connectSteam();
      const lower = await createGame('Hades', { minutes: 300 });
      const higher = await createGame('Celeste', { minutes: 500 });
      const empty = await createGame('Portal 2');
      owned[STEAM_ID] = [
        { appid: 1145360, name: 'Hades', playtime_forever: 600 },
        { appid: 504230, name: 'Celeste', playtime_forever: 200 },
        { appid: 620, name: 'Portal 2', playtime_forever: 45 },
      ];

      const summary = await runSteamSync(DEFAULT_USER_ID);

      expect(await item(lower)).toEqual({ time_played_minutes: 600, steam_appid: 1145360 });
      expect(await item(higher)).toEqual({ time_played_minutes: 500, steam_appid: 504230 });
      expect(await item(empty)).toEqual({ time_played_minutes: 45, steam_appid: 620 });
      expect(summary).toMatchObject({ games: 3, matched: 3, newly_matched: 3, time_updated: 2, checkins_created: 0, unmatched: 0 });
    });

    it('matches by stored app id, then IGDB id, then title', async () => {
      await connectSteam();
      await setSetting(DEFAULT_USER_ID, 'igdb_client_id', 'cid');
      await setSetting(DEFAULT_USER_ID, 'igdb_client_secret', 'secret');
      const byAppid = await createGame('Renamed In My Library', { steamAppid: 10 });
      const byIgdb = await createGame('The Witcher 3', { igdbId: '1942' });
      const byTitle = await createGame('Stardew Valley');
      igdbExternal = [{ game: 1942, uid: '292030', external_game_source: 1 }];
      owned[STEAM_ID] = [
        { appid: 10, name: 'Counter-Strike', playtime_forever: 5 },
        { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtime_forever: 6 },
        { appid: 413150, name: 'Stardew Valley', playtime_forever: 7 },
        { appid: 999, name: 'Unknown Game', playtime_forever: 8 },
      ];

      const summary = await runSteamSync(DEFAULT_USER_ID);

      expect((await item(byAppid)).time_played_minutes).toBe(5);
      expect(await item(byIgdb)).toEqual({ time_played_minutes: 6, steam_appid: 292030 });
      expect(await item(byTitle)).toEqual({ time_played_minutes: 7, steam_appid: 413150 });
      expect(summary).toMatchObject({ matched: 3, newly_matched: 2, unmatched: 1 });
    });
  });

  describe('auto check-ins', () => {
    const HOUR = 60 * 60 * 1000;
    // Syncs an hour apart, ending about now (manual check-ins get created_at = NOW()).
    const t0 = Date.now() - 4 * HOUR;
    const at = (hours: number) => ({ now: new Date(t0 + hours * HOUR) });
    const hades = (minutes: number, lastPlayed?: number) => {
      owned[STEAM_ID] = [{ appid: 1145360, name: 'Hades', playtime_forever: minutes, rtime_last_played: lastPlayed }];
    };

    it('adds one in_progress check-in per play session, once it ends', async () => {
      await connectSteam();
      const game = await createGame('Hades', { minutes: 0 });
      hades(100);
      await runSteamSync(DEFAULT_USER_ID, at(0));
      expect(await checkins(game)).toEqual([]);

      // A long session: Steam's total rises across two hourly syncs.
      hades(150);
      expect((await runSteamSync(DEFAULT_USER_ID, at(1))).checkins_created).toBe(0);
      hades(195);
      expect((await runSteamSync(DEFAULT_USER_ID, at(2))).checkins_created).toBe(0);
      expect(await checkins(game)).toEqual([]);
      expect((await item(game)).time_played_minutes).toBe(195);

      // A "Sync now" shortly after the last rise does not end the session yet.
      expect((await runSteamSync(DEFAULT_USER_ID, at(2.2))).checkins_created).toBe(0);

      // The total stopped rising: one check-in for the whole session.
      const lastPlayed = Math.floor((t0 + 2 * HOUR) / 1000);
      hades(195, lastPlayed);
      const summary = await runSteamSync(DEFAULT_USER_ID, at(3));
      expect(summary.checkins_created).toBe(1);
      const rows = await checkins(game);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ checkin_type: 'in_progress', time_played_minutes: 95, external_event_id: 'steam:1145360:195' });
      expect(new Date(rows[0].checked_in_at).getTime()).toBe(lastPlayed * 1000);

      // Nothing new played: nothing new recorded.
      await runSteamSync(DEFAULT_USER_ID, at(4));
      expect(await checkins(game)).toHaveLength(1);
    });

    it('skips the check-in when one was logged by hand during the session', async () => {
      await connectSteam();
      const game = await createGame('Hades');
      hades(100);
      await runSteamSync(DEFAULT_USER_ID, at(0));
      hades(160);
      await runSteamSync(DEFAULT_USER_ID, at(1));

      const manual = await request(app).post(`/api/v1/media/items/${game}/checkins`)
        .send({ checkin_type: 'in_progress', timezone: 'UTC', time_played_minutes: 60 });
      expect(manual.status).toBe(201);

      const later = (hours: number) => ({ now: new Date(Date.now() + hours * HOUR) });
      const summary = await runSteamSync(DEFAULT_USER_ID, later(1));
      expect(summary.checkins_created).toBe(0);
      expect(await checkins(game)).toHaveLength(1);
      expect((await item(game)).time_played_minutes).toBe(160);

      // The session is closed: later play starts a fresh one.
      hades(200);
      await runSteamSync(DEFAULT_USER_ID, later(2));
      expect((await runSteamSync(DEFAULT_USER_ID, later(3))).checkins_created).toBe(1);
      expect((await checkins(game)).map((r) => r.time_played_minutes)).toEqual([60, 40]);
    });
  });

  describe('review list', () => {
    beforeEach(async () => {
      await connectSteam();
      owned[STEAM_ID] = [
        { appid: 1, name: 'Played Game', playtime_forever: 90 },
        { appid: 2, name: 'Second Game', playtime_forever: 30 },
        { appid: 3, name: 'Never Played', playtime_forever: 0 },
      ];
      await runSteamSync(DEFAULT_USER_ID);
    });

    it('lists played unmatched games, most played first', async () => {
      const res = await request(app).get('/api/v1/media/steam/games?status=unmatched');
      expect(res.status).toBe(200);
      expect(res.body.map((g: { appid: number }) => g.appid)).toEqual([1, 2]);
      const all = await request(app).get('/api/v1/media/steam/games?status=unmatched&include_unplayed=true');
      expect(all.body).toHaveLength(3);
      const status = await request(app).get('/api/v1/media/steam/status');
      expect(status.body).toMatchObject({ configured: true, unmatched: 2, unmatched_all: 3, ignored: 0, last_error: null });
    });

    it('links a Steam game to an existing game', async () => {
      const game = await createGame('Some Other Title', { minutes: 20 });
      const res = await request(app).post('/api/v1/media/steam/games/1/link').send({ media_item_id: game });
      expect(res.status).toBe(200);
      expect(await item(game)).toEqual({ time_played_minutes: 90, steam_appid: 1 });

      // The next sync keeps the link.
      owned[STEAM_ID][0].playtime_forever = 120;
      await runSteamSync(DEFAULT_USER_ID);
      expect((await item(game)).time_played_minutes).toBe(120);
    });

    it('adds a Steam game to the library (local-only without IGDB)', async () => {
      const res = await request(app).post('/api/v1/media/steam/games/2/add');
      expect(res.status).toBe(201);
      const created = await query('SELECT title, platform, time_played_minutes, steam_appid FROM media_items WHERE id = $1', [res.body.media_item_id]);
      expect(created.rows[0]).toEqual({ title: 'Second Game', platform: 'PC', time_played_minutes: 30, steam_appid: 2 });
      const list = await request(app).get('/api/v1/media/steam/games?status=unmatched');
      expect(list.body.map((g: { appid: number }) => g.appid)).toEqual([1]);
    });

    it('remembers ignored games across syncs, and can unignore them', async () => {
      expect((await request(app).post('/api/v1/media/steam/games/1/ignore')).status).toBe(200);
      // A library game with the same title appears later: still ignored.
      await createGame('Played Game');
      await runSteamSync(DEFAULT_USER_ID);
      const ignored = await request(app).get('/api/v1/media/steam/games?status=ignored');
      expect(ignored.body.map((g: { appid: number }) => g.appid)).toEqual([1]);

      expect((await request(app).post('/api/v1/media/steam/games/1/unignore')).status).toBe(200);
      await runSteamSync(DEFAULT_USER_ID);
      const status = await query(`SELECT status FROM media_steam_games WHERE user_id = $1 AND appid = 1`, [DEFAULT_USER_ID]);
      expect(status.rows[0].status).toBe('matched');
    });
  });

  it('records a failed sync for the settings page', async () => {
    await setSetting(DEFAULT_USER_ID, 'steam_api_key', 'bad');
    await setSetting(DEFAULT_USER_ID, 'steam_id', STEAM_ID);
    await expect(runSteamSync(DEFAULT_USER_ID)).rejects.toThrow(/rejected the API key/);
    const status = await request(app).get('/api/v1/media/steam/status');
    expect(status.body.last_error).toMatch(/rejected the API key/);
    expect(status.body.last_synced_at).toBeNull();
  });

  it('keeps each user\'s Steam data separate', async () => {
    const other = await createTestUser('steam-other');
    const otherId = '76561197960287931';
    await connectSteam();
    await connectSteam(other.id, otherId);
    const mine = await createGame('Hades', { minutes: 10 });
    const theirs = await createGame('Hades', { userId: other.id, minutes: 10 });
    owned[STEAM_ID] = [{ appid: 1145360, name: 'Hades', playtime_forever: 100 }];
    owned[otherId] = [{ appid: 1145360, name: 'Hades', playtime_forever: 50 }];

    await runSteamSync(DEFAULT_USER_ID);
    expect((await item(mine)).time_played_minutes).toBe(100);
    expect((await item(theirs)).time_played_minutes).toBe(10);

    await runSteamSync(other.id);
    expect((await item(theirs)).time_played_minutes).toBe(50);

    const list = await request(app).get('/api/v1/media/steam/games?status=unmatched').set('Cookie', other.cookie);
    expect(list.body).toEqual([]);
    const link = await request(app).post('/api/v1/media/steam/games/1145360/link')
      .set('Cookie', other.cookie).send({ media_item_id: mine });
    expect(link.status).toBe(409);
  });

  it('runs as a job from the Sync button', async () => {
    await connectSteam();
    const game = await createGame('Hades');
    owned[STEAM_ID] = [{ appid: 1145360, name: 'Hades', playtime_forever: 42 }];
    const start = await request(app).post('/api/v1/jobs').send({ type: 'steam-sync' });
    expect(start.status).toBe(201);
    let job = start.body;
    for (let i = 0; i < 50 && (job.status === 'pending' || job.status === 'running'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await request(app).get(`/api/v1/jobs/${start.body.id}`)).body;
    }
    expect(job.status).toBe('completed');
    expect((await item(game)).time_played_minutes).toBe(42);
  });
});
