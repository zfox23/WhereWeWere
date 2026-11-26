import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { getMusicSettings } from '../../services/scrobbles';
import { setSpotifyTransport } from '../../services/spotifyApi';
import { runSpotifySync } from '../../services/spotifySync';
import { server } from '../../server';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z
const api = (path: string) => `/api/v1/music${path}`;
const CLIENT_ID = 'a'.repeat(32);
const CLIENT_SECRET = 'b'.repeat(32);
const ORIGIN = 'https://www.example.com';

// ---------------------------------------------------------------------------
// A fake Spotify
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  url: URL;
  body: any;
  auth: string | null;
}
type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

let calls: Call[] = [];
const callsTo = (method: string, path: string | RegExp) =>
  calls.filter((c) => c.method === method && (typeof path === 'string' ? c.url.pathname === path : path.test(c.url.pathname)));

/** What the fake knows; tests change it. */
let world: {
  tracks: { id: string; name: string; artists: string[]; album: string }[];
  albums: { id: string; name: string; artists: string[]; tracks: string[] }[];
  artists: { id: string; name: string }[];
  playlists: Record<string, unknown>[];
  items: Record<string, unknown[]>;
  inLibrary: boolean;
  refreshFails: boolean;
  /** Playlists whose items answer with this instead (e.g. a rate limit). */
  itemsFail: Record<string, Answer>;
};

function resetWorld() {
  world = {
    tracks: [
      { id: 'trkSun', name: 'Sun & Moon', artists: ['Above & Beyond', 'Richard Bedford'], album: 'Group Therapy' },
      { id: 'trkLove', name: 'Thing Called Love', artists: ['Above & Beyond'], album: 'Group Therapy' },
    ],
    albums: [{ id: 'albGt', name: 'Group Therapy', artists: ['Above & Beyond'], tracks: ['trkSun', 'trkLove', 'trkOther'] }],
    artists: [{ id: 'artAb', name: 'Above & Beyond' }],
    playlists: [],
    items: {},
    inLibrary: true,
    refreshFails: false,
    itemsFail: {},
  };
}

/** A search answer: Spotify's field filters, roughly. */
function search(q: string, type: string): unknown {
  const field = (name: string) => new RegExp(`${name}:"([^"]*)"`).exec(q)?.[1]?.toLowerCase() ?? '';
  const artist = field('artist');
  const credits = (names: string[]) => names.some((n) => n.toLowerCase() === artist);
  if (type === 'track') {
    const title = field('track');
    const items = world.tracks
      .filter((t) => t.name.toLowerCase() === title && credits(t.artists))
      .map((t) => ({ id: t.id, type: 'track', name: t.name, artists: t.artists.map((name) => ({ name })), album: { name: t.album } }));
    return { tracks: { items } };
  }
  if (type === 'album') {
    const album = field('album');
    const items = world.albums
      .filter((a) => a.name.toLowerCase() === album && credits(a.artists))
      .map((a) => ({ id: a.id, name: a.name, album_type: 'album', artists: a.artists.map((name) => ({ name })) }));
    return { albums: { items } };
  }
  return { artists: { items: world.artists.filter((a) => a.name.toLowerCase() === artist) } };
}

function answer(c: Call): Answer {
  const path = c.url.pathname;
  if (c.url.host === 'accounts.spotify.com' && path === '/api/token') {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    if (c.auth !== `Basic ${basic}`) return { status: 400, body: { error: 'invalid_client' } };
    if (c.body.grant_type === 'client_credentials') return { status: 200, body: { access_token: 'app-token', expires_in: 3600 } };
    if (c.body.grant_type === 'authorization_code') {
      if (c.body.code !== 'good-code' || c.body.redirect_uri !== `${ORIGIN}/api/v1/music/spotify/callback`) {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      return { status: 200, body: { access_token: 'user-token', refresh_token: 'refresh-1', expires_in: 3600, scope: 'playlist-read-private' } };
    }
    if (c.body.grant_type === 'refresh_token') {
      if (world.refreshFails) return { status: 400, body: { error: 'invalid_grant' } };
      return { status: 200, body: { access_token: 'user-token-2', expires_in: 3600 } };
    }
  }
  if (c.url.host !== 'api.spotify.com') return { status: 404 };
  const p = path.replace(/^\/v1/, '');
  if (p === '/me') return { status: 200, body: { id: 'me', display_name: 'Zach' } };
  if (p === '/search') return { status: 200, body: search(c.url.searchParams.get('q') ?? '', c.url.searchParams.get('type') ?? '') };
  if (p === '/me/playlists' && c.method === 'GET') {
    // Two pages, to follow `next`.
    const offset = Number(c.url.searchParams.get('offset') ?? 0);
    const page = world.playlists.slice(offset, offset + 2);
    const next = offset + 2 < world.playlists.length ? `https://api.spotify.com/v1/me/playlists?limit=2&offset=${offset + 2}` : null;
    return { status: 200, body: { items: page, next } };
  }
  if (p === '/me/playlists' && c.method === 'POST') return { status: 201, body: { id: `made${callsTo('POST', '/v1/me/playlists').length}` } };
  if (p === '/me/library/contains') return { status: 200, body: [world.inLibrary] };
  const items = /^\/playlists\/([^/]+)\/items$/.exec(p);
  if (items && c.method === 'GET') {
    if (world.itemsFail[items[1]]) return world.itemsFail[items[1]];
    const list = world.items[items[1]];
    return list ? { status: 200, body: { items: list, next: null } } : { status: 403, body: { error: { message: 'Forbidden' } } };
  }
  if (items) return { status: 201, body: { snapshot_id: 'snap' } };
  const albumTracks = /^\/albums\/([^/]+)\/tracks$/.exec(p);
  if (albumTracks) {
    const album = world.albums.find((a) => a.id === albumTracks[1]);
    return { status: 200, body: { items: (album?.tracks ?? []).map((id) => ({ id, uri: `spotify:track:${id}` })), next: null } };
  }
  return { status: 404, body: { error: { message: 'Not found' } } };
}

function installFake() {
  setSpotifyTransport(async (url, init) => {
    const u = new URL(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = typeof init?.body === 'string' ? init.body : null;
    const body = raw
      ? headers['Content-Type'] === 'application/json'
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw))
      : null;
    const call: Call = { method: init?.method ?? 'GET', url: u, body, auth: headers.Authorization ?? null };
    calls.push(call);
    const a = answer(call);
    return new Response(a.status === 204 || a.body === undefined ? null : JSON.stringify(a.body), {
      status: a.status,
      headers: { 'Content-Type': 'application/json', ...(a.headers ?? {}) },
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let key = '';
const push = (title: string, album: string | undefined, artists: string[], offset = 0) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: T0 + offset, key });

const songKey = async (title: string) =>
  (await query(`SELECT song_key FROM music_scrobbles WHERE title = $1 LIMIT 1`, [title])).rows[0].song_key as string;
const albumKey = async (album: string) =>
  (await query(`SELECT album_key FROM music_scrobbles WHERE album = $1 LIMIT 1`, [album])).rows[0].album_key as string;

const saveApp = () => request(app).put(api('/spotify/credentials')).send({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });

async function connect() {
  expect((await saveApp()).status).toBe(200);
  const auth = await request(app).post(api('/spotify/authorize')).send({ origin: ORIGIN });
  expect(auth.status).toBe(200);
  const state = new URL(auth.body.url).searchParams.get('state');
  return request(app).get(api(`/spotify/callback?code=good-code&state=${state}`));
}

const entry = (id: string | null, name: string, artists: string[], added: string, album = 'Group Therapy') => ({
  added_at: added,
  is_local: id === null,
  track: true,
  item: { id, type: 'track', name, artists: artists.map((n) => ({ name: n })), album: { name: album }, duration_ms: 240000 },
});

describe('music: Spotify', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    calls = [];
    resetWorld();
    installFake();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
    await push('Sun & Moon', 'Group Therapy', ['Above & Beyond', 'Richard Bedford'], 0);
    await push('Sun & Moon', 'Group Therapy', ['Above & Beyond', 'Richard Bedford'], 86_400);
    await push('Thing Called Love', 'Group Therapy', ['Above & Beyond'], 300);
    await push('Obscure B-Side', 'Rarities', ['Above & Beyond'], 600);
  });
  afterEach(() => setSpotifyTransport(null));
  afterAll(teardownIntegrationDatabase);

  describe('setting up', () => {
    it('is off until the app is saved, and checks the credentials with Spotify', async () => {
      expect((await request(app).get(api('/spotify/status'))).body).toMatchObject({ configured: false, connected: false });
      expect((await request(app).get(api(`/spotify/link?kind=artist&name=${encodeURIComponent('Above & Beyond')}`))).status).toBe(404);

      expect((await request(app).put(api('/spotify/credentials')).send({ client_id: 'short', client_secret: 'x' })).status).toBe(400);
      const wrong = await request(app).put(api('/spotify/credentials')).send({ client_id: CLIENT_ID, client_secret: 'c'.repeat(32) });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error).toMatch(/rejected/);

      const ok = await saveApp();
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ configured: true, connected: false, client_id: CLIENT_ID });
      expect(ok.body).not.toHaveProperty('client_secret');
    });

    it('signs in: sends the browser to Spotify with a state, then trades the code for tokens', async () => {
      await saveApp();
      const auth = await request(app).post(api('/spotify/authorize')).send({ origin: ORIGIN });
      const url = new URL(auth.body.url);
      expect(url.host).toBe('accounts.spotify.com');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/music/spotify/callback`);
      expect(url.searchParams.get('scope')).toContain('playlist-modify-private');
      const state = url.searchParams.get('state') as string;

      // A forged state is refused, and spends the real one.
      const forged = await request(app).get(api('/spotify/callback?code=good-code&state=forged'));
      expect(forged.status).toBe(302);
      expect(decodeURIComponent(forged.headers.location)).toMatch(/spotify_error=That Spotify sign-in expired/);
      const replay = await request(app).get(api(`/spotify/callback?code=good-code&state=${state}`));
      expect(replay.headers.location).toMatch(/spotify_error=/);

      const res = await connect();
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/settings?tab=plugin:music&spotify=connected');
      expect((await request(app).get(api('/spotify/status'))).body).toMatchObject({ connected: true, display_name: 'Zach' });
    });

    it('reports a denied sign-in on the settings page', async () => {
      await saveApp();
      const auth = await request(app).post(api('/spotify/authorize')).send({ origin: ORIGIN });
      const state = new URL(auth.body.url).searchParams.get('state');
      const res = await request(app).get(api(`/spotify/callback?error=access_denied&state=${state}`));
      expect(decodeURIComponent(res.headers.location)).toContain('spotify_error=Spotify access was not allowed.');
      expect((await request(app).get(api('/spotify/status'))).body.connected).toBe(false);
    });

    it('refreshes an expired token, and signs out when Spotify no longer accepts the sign-in', async () => {
      await connect();
      await query(`UPDATE music_spotify_accounts SET token_expires_at = NOW() - INTERVAL '1 minute'`);
      await runSpotifySync(DEFAULT_USER_ID);
      expect(callsTo('POST', '/api/token').some((c) => c.body.grant_type === 'refresh_token')).toBe(true);
      expect(calls.filter((c) => c.url.host === 'api.spotify.com').at(-1)?.auth).toBe('Bearer user-token-2');

      world.refreshFails = true;
      await query(`UPDATE music_spotify_accounts SET token_expires_at = NOW() - INTERVAL '1 minute'`);
      await expect(runSpotifySync(DEFAULT_USER_ID)).rejects.toThrow(/Connect your account again/);
      const status = (await request(app).get(api('/spotify/status'))).body;
      expect(status).toMatchObject({ configured: true, connected: false });
      expect(status.last_error).toMatch(/Connect your account again/);
    });
  });

  describe('Open in Spotify', () => {
    beforeEach(async () => {
      await saveApp();
    });

    it('opens the matching track, album and artist, searching only once', async () => {
      const song = await request(app).get(api(`/spotify/link?kind=song&song_key=${encodeURIComponent(await songKey('Sun & Moon'))}`));
      expect(song.body).toEqual({ url: 'https://open.spotify.com/track/trkSun', matched: true });
      const album = await request(app).get(api(`/spotify/link?kind=album&ref=${encodeURIComponent(await albumKey('Group Therapy'))}`));
      expect(album.body).toEqual({ url: 'https://open.spotify.com/album/albGt', matched: true });
      const artist = await request(app).get(api(`/spotify/link?kind=artist&name=${encodeURIComponent('Above & Beyond')}`));
      expect(artist.body).toEqual({ url: 'https://open.spotify.com/artist/artAb', matched: true });
      // A featured artist has an artist page too.
      expect((await request(app).get(api('/spotify/link?kind=artist&name=Richard%20Bedford'))).body.matched).toBe(false);

      const searches = callsTo('GET', '/v1/search').length;
      await request(app).get(api(`/spotify/link?kind=song&song_key=${encodeURIComponent(await songKey('Sun & Moon'))}`));
      expect(callsTo('GET', '/v1/search').length).toBe(searches);
      // Without signing in, search uses the app's own token.
      expect(callsTo('GET', '/v1/search')[0].auth).toBe('Bearer app-token');
    });

    it('falls back to a Spotify search, remembered as "no match"', async () => {
      const ref = encodeURIComponent(await songKey('Obscure B-Side'));
      const res = await request(app).get(api(`/spotify/link?kind=song&song_key=${ref}`));
      expect(res.body).toEqual({ url: `https://open.spotify.com/search/${encodeURIComponent('Above & Beyond Obscure B-Side')}`, matched: false });
      const searches = callsTo('GET', '/v1/search').length;
      await request(app).get(api(`/spotify/link?kind=song&song_key=${ref}`));
      expect(callsTo('GET', '/v1/search').length).toBe(searches);
    });

    it('gives a search link without caching when Spotify is down', async () => {
      setSpotifyTransport(async () => new Response(null, { status: 503 }));
      const ref = encodeURIComponent(await songKey('Sun & Moon'));
      const res = await request(app).get(api(`/spotify/link?kind=song&song_key=${ref}`));
      expect(res.status).toBe(200);
      expect(res.body.matched).toBe(false);
      expect((await query('SELECT 1 FROM music_spotify_links')).rowCount).toBe(0);
    }, 15_000);

    it("refuses music the user hasn't played and unknown albums", async () => {
      expect((await request(app).get(api('/spotify/link?kind=song&song_key=nothing'))).status).toBe(404);
      expect((await request(app).get(api('/spotify/link?kind=artist&name=Nobody'))).status).toBe(404);
      expect((await request(app).get(api('/spotify/link?kind=album&ref=%7Cabove%20%26%20beyond'))).status).toBe(404);
      expect((await request(app).get(api('/spotify/link?kind=bogus&name=x'))).status).toBe(400);
    });
  });

  describe('playlists', () => {
    beforeEach(async () => {
      await connect();
      world.playlists = [
        { id: 'plMine', name: 'Trance', owner: { id: 'me', display_name: 'Zach' }, snapshot_id: 's1', items: { total: 4 }, images: [{ url: 'https://i.scdn.co/a', width: 300 }] },
        { id: 'plFollowed', name: 'Editorial', owner: { id: 'spotify', display_name: 'Spotify' }, snapshot_id: 'f1', items: { total: 50 } },
        { id: 'plCollab', name: 'Road Trip', owner: { id: 'friend', display_name: 'Friend' }, collaborative: true, snapshot_id: 'c1', items: { total: 1 } },
      ];
      world.items = {
        plMine: [
          entry('trkSun', 'Sun & Moon', ['Above & Beyond', 'Richard Bedford'], '2024-01-01T00:00:00Z'),
          entry('trkLove', 'Thing Called Love', ['Above & Beyond'], '2024-03-01T00:00:00Z'),
          entry('trkNew', 'Never Played', ['Above & Beyond'], '2024-02-01T00:00:00Z'),
          entry(null, 'My Demo', [], '2024-02-15T00:00:00Z', ''),
        ],
        plCollab: [entry('trkSun', 'Sun & Moon - Remastered 2011', ['Above & Beyond'], '2023-06-01T00:00:00Z')],
      };
    });

    it('syncs the library in Spotify order with plays of each playlist, followed ones without tracks', async () => {
      const summary = await runSpotifySync(DEFAULT_USER_ID);
      expect(summary).toEqual({ playlists: 3, read: 2, unavailable: 1, tracks: 5 });
      // Both shapes of the paged list were followed.
      expect(callsTo('GET', '/v1/me/playlists').length).toBe(2);

      const rows = (await request(app).get(api('/spotify/playlists'))).body;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(['Trance', 'Editorial', 'Road Trip']);
      expect(rows[0]).toMatchObject({
        mine: true,
        has_cover: true,
        tracks_available: true,
        total_tracks: 4,
        plays: 3,
        played_songs: 2,
        unplayed_songs: 2,
        last_modified_at: '2024-03-01T00:00:00.000Z',
        url: 'https://open.spotify.com/playlist/plMine',
      });
      expect(rows[1]).toMatchObject({ mine: false, tracks_available: false, total_tracks: 50, plays: 0, owner_name: 'Spotify' });
      // A remaster tag on Spotify's title is still the same song.
      expect(rows[2]).toMatchObject({ mine: true, plays: 2, unplayed_songs: 0 });

      const status = (await request(app).get(api('/spotify/status'))).body;
      expect(status).toMatchObject({ playlists: 3, last_error: null, last_summary: summary });
    });

    it('shows a playlist with each track’s plays, and its plays per day', async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      const res = await request(app).get(api('/spotify/playlists/plMine'));
      expect(res.status).toBe(200);
      const byTitle = Object.fromEntries(res.body.tracks.map((t: { title: string }) => [t.title, t]));
      expect(byTitle['Sun & Moon']).toMatchObject({
        plays: 2,
        position: 0,
        url: 'https://open.spotify.com/track/trkSun',
        first_played_at: '2024-05-01T12:00:00.000Z',
        last_played_at: '2024-05-02T12:00:00.000Z',
      });
      expect(byTitle['Never Played']).toMatchObject({ plays: 0, last_played_at: null });
      expect(byTitle['My Demo']).toMatchObject({ is_local: true, spotify_id: null, url: null });
      expect(res.body.daily).toEqual([
        { date: '2024-05-01', plays: 2 },
        { date: '2024-05-02', plays: 1 },
      ]);
      expect((await request(app).get(api('/spotify/playlists/nope'))).status).toBe(404);
      expect((await request(app).get(api('/spotify/playlists/bad%20id'))).status).toBe(400);
    });

    it('re-reads only playlists whose snapshot changed, and drops playlists that left the library', async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      const reads = () => callsTo('GET', /\/items$/).length;
      const before = reads();
      const again = await runSpotifySync(DEFAULT_USER_ID);
      expect(again.read).toBe(0);
      expect(reads()).toBe(before);

      world.playlists = [{ ...world.playlists[0], snapshot_id: 's2' }];
      world.items.plMine = world.items.plMine.slice(0, 1);
      const third = await runSpotifySync(DEFAULT_USER_ID);
      expect(third).toMatchObject({ playlists: 1, read: 1, tracks: 1 });
      const rows = (await request(app).get(api('/spotify/playlists'))).body;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ total_tracks: 1, plays: 2, unplayed_songs: 0 });
    });

    it("never asks for the tracks of playlists the user doesn't own", async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      expect(callsTo('GET', '/v1/playlists/plFollowed/items')).toHaveLength(0);
      expect(callsTo('GET', '/v1/playlists/plMine/items')).toHaveLength(1);
    });

    it('keeps a playlist’s tracks when reading them fails, and reads them again next time', async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      world.playlists[0] = { ...world.playlists[0], snapshot_id: 's2' };
      world.itemsFail.plMine = { status: 429, headers: { 'Retry-After': '3600' }, body: {} };
      await expect(runSpotifySync(DEFAULT_USER_ID)).rejects.toThrow('Spotify is rate limiting requests; try again in about 60 minutes.');
      world.itemsFail.plMine = { status: 403, body: { error: { message: 'Forbidden' } } };
      await expect(runSpotifySync(DEFAULT_USER_ID)).rejects.toThrow(/Forbidden/);

      const mine = () => request(app).get(api('/spotify/playlists')).then((r) => r.body[0]);
      expect(await mine()).toMatchObject({ name: 'Trance', tracks_available: true, plays: 3, unplayed_songs: 2 });
      expect((await request(app).get(api('/spotify/status'))).body.last_error).toMatch(/Forbidden/);

      delete world.itemsFail.plMine;
      world.items.plMine = world.items.plMine.slice(0, 2);
      expect(await runSpotifySync(DEFAULT_USER_ID)).toMatchObject({ read: 1 });
      expect(await mine()).toMatchObject({ tracks_available: true, total_tracks: 2, unplayed_songs: 0 });
    });

    it('re-reads the user’s own playlists that were left without tracks', async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      // What a rate-limited sync used to leave behind: same snapshot, no tracks.
      await query(`UPDATE music_spotify_playlists SET tracks_available = false WHERE spotify_id = 'plMine'`);
      await query(`DELETE FROM music_spotify_playlist_tracks WHERE playlist_id = 'plMine'`);
      expect(await runSpotifySync(DEFAULT_USER_ID)).toMatchObject({ read: 1, tracks: 4, unavailable: 1 });
      expect((await request(app).get(api('/spotify/playlists'))).body[0]).toMatchObject({ tracks_available: true, plays: 3 });
    });

    it('runs as the spotify-sync job', async () => {
      const start = await request(app).post('/api/v1/jobs').send({ type: 'spotify-sync' });
      expect(start.status).toBeLessThan(300);
      let job = start.body;
      for (let i = 0; i < 50 && (job.status === 'pending' || job.status === 'running'); i++) {
        await new Promise((r) => setTimeout(r, 100));
        job = (await request(app).get(`/api/v1/jobs/${start.body.id}`)).body;
      }
      expect(job.status).toBe('completed');
      expect(job.progress.message).toMatch(/Synced 3 playlists/);
    });

    it("keeps one user's playlists from another", async () => {
      await runSpotifySync(DEFAULT_USER_ID);
      const other = await createTestUser('other');
      expect((await request(app).get(api('/spotify/playlists')).set('Cookie', other.cookie)).body).toEqual([]);
      expect((await request(app).get(api('/spotify/playlists/plMine')).set('Cookie', other.cookie)).status).toBe(404);
      expect((await request(app).get(api('/spotify/status')).set('Cookie', other.cookie)).body.configured).toBe(false);
    });
  });

  describe('exporting a list', () => {
    let listId = '';

    beforeEach(async () => {
      await connect();
      listId = (await request(app).post(api('/lists')).send({ name: 'Favourites' })).body.id;
      await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'song', song_key: await songKey('Sun & Moon') });
      await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'album', album_ref: await albumKey('Group Therapy') });
      await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'song', song_key: await songKey('Obscure B-Side') });
    });

    it('creates a private playlist, then updates the same one', async () => {
      expect((await request(app).get(api(`/spotify/exports/${listId}`))).body).toBeNull();

      const first = await request(app).post(api(`/spotify/exports/${listId}`));
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        created: true,
        spotify_playlist_id: 'made1',
        url: 'https://open.spotify.com/playlist/made1',
        // The song, then the album's tracks (the song once).
        track_count: 3,
        unmatched: [{ kind: 'song', title: 'Obscure B-Side', artists: ['Above & Beyond'] }],
      });
      const made = callsTo('POST', '/v1/me/playlists')[0];
      expect(made.body).toMatchObject({ name: 'Favourites', public: false });
      expect(callsTo('PUT', '/v1/playlists/made1/items')[0].body.uris).toEqual([
        'spotify:track:trkSun',
        'spotify:track:trkLove',
        'spotify:track:trkOther',
      ]);

      const second = await request(app).post(api(`/spotify/exports/${listId}`));
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ created: false, spotify_playlist_id: 'made1' });
      expect(callsTo('POST', '/v1/me/playlists')).toHaveLength(1);
      expect((await request(app).get(api(`/spotify/exports/${listId}`))).body.spotify_playlist_id).toBe('made1');
    });

    it('starts a new playlist when the old one left the Spotify library', async () => {
      await request(app).post(api(`/spotify/exports/${listId}`));
      world.inLibrary = false;
      const res = await request(app).post(api(`/spotify/exports/${listId}`));
      expect(res.body).toMatchObject({ created: true, spotify_playlist_id: 'made2' });
    });

    it('needs a Spotify sign-in, and the list to be the user’s', async () => {
      await request(app).post(api('/spotify/disconnect'));
      const res = await request(app).post(api(`/spotify/exports/${listId}`));
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Connect your Spotify account/);
      await connect();
      const other = await createTestUser('other');
      expect((await request(app).post(api(`/spotify/exports/${listId}`)).set('Cookie', other.cookie)).status).toBe(404);
    });
  });

  describe('backups and Start Over', () => {
    it('backs up matches and exports but never credentials, tokens or playlists, and restores them', async () => {
      await connect();
      const listId = (await request(app).post(api('/lists')).send({ name: 'Favourites' })).body.id;
      await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'song', song_key: await songKey('Sun & Moon') });
      await request(app).post(api(`/spotify/exports/${listId}`));

      const payload = (await runAsUser(DEFAULT_USER_ID, () => server.backupExport!({ user_id: DEFAULT_USER_ID }))) as Record<string, unknown>;
      const text = JSON.stringify(payload);
      expect(text).not.toContain(CLIENT_SECRET);
      expect(text).not.toContain('refresh-1');
      expect(payload.spotify_links).toEqual([expect.objectContaining({ kind: 'song', spotify_id: 'trkSun' })]);
      expect(payload.spotify_exports).toEqual([expect.objectContaining({ list_name: 'Favourites', spotify_playlist_id: 'made1' })]);

      const other = await createTestUser('restorer');
      await runAsUser(other.id, () => server.backupImport!({ user_id: other.id }, payload));
      expect((await query('SELECT spotify_id FROM music_spotify_links WHERE user_id = $1', [other.id])).rows).toEqual([{ spotify_id: 'trkSun' }]);
      const restored = await query(
        `SELECT e.spotify_playlist_id FROM music_spotify_exports e JOIN music_lists l ON l.id = e.list_id WHERE l.user_id = $1`,
        [other.id],
      );
      expect(restored.rows).toEqual([{ spotify_playlist_id: 'made1' }]);
    });

    it('Start Over removes matches and playlists; resetting settings forgets the app', async () => {
      await connect();
      world.playlists = [{ id: 'pl', name: 'P', owner: { id: 'me' }, snapshot_id: 's', items: { total: 0 } }];
      world.items = { pl: [] };
      await runSpotifySync(DEFAULT_USER_ID);
      await request(app).get(api(`/spotify/link?kind=song&song_key=${encodeURIComponent(await songKey('Sun & Moon'))}`));

      await runAsUser(DEFAULT_USER_ID, () => server.deleteUserData!({ user_id: DEFAULT_USER_ID }));
      expect((await query('SELECT 1 FROM music_spotify_links')).rowCount).toBe(0);
      expect((await query('SELECT 1 FROM music_spotify_playlists')).rowCount).toBe(0);
      expect((await request(app).get(api('/spotify/status'))).body.connected).toBe(true);

      await runAsUser(DEFAULT_USER_ID, () => server.resetSettings!({ user_id: DEFAULT_USER_ID }));
      expect((await request(app).get(api('/spotify/status'))).body.configured).toBe(false);
    });
  });
});
