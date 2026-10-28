import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { getMusicSettings } from '../../services/scrobbles';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z
const MIN = 60;

let key = '';

function push(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`${BASE}/newscrobble`)
    .send({ title: 'Song', artists: ['Artist'], time: T0, key, ...overrides });
}

async function pushAt(offsetMinutes: number, title = `Song ${offsetMinutes}`, artists = ['Artist']) {
  const res = await push({ title, artists, time: T0 + offsetMinutes * MIN });
  expect(res.status).toBe(200);
}

const sessions = async () =>
  (await query('SELECT track_count, started_at, ended_at FROM music_sessions ORDER BY started_at')).rows;

describe('music plugin', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('scrobbler protocol', () => {
    it('reports server info without a key', async () => {
      const res = await request(app).get(`${BASE}/serverinfo`);
      expect(res.status).toBe(200);
      expect(res.body.versionstring).toBe('3.2.9');
      expect(res.body.db_status.healthy).toBe(true);
    });

    it('tolerates the doubled slash multi-scrobbler sends after a bare host URL', async () => {
      expect((await request(app).get(`/${BASE}/serverinfo`)).status).toBe(200);
      expect((await request(app).get(`/${BASE}/test`).query({ key })).body).toEqual({ status: 'ok' });
      const res = await request(app)
        .post(`/${BASE}/newscrobble`)
        .send({ title: 'Song', artists: ['Artist'], time: T0, key });
      expect(res.status).toBe(200);
      expect((await request(app).get(`//apis/other/serverinfo`)).status).toBe(404);
    });

    it('accepts only the generated key', async () => {
      expect((await request(app).get(`${BASE}/test`).query({ key })).body).toEqual({ status: 'ok' });
      expect((await request(app).get(`${BASE}/test`).query({ key: 'nope' })).status).toBe(403);
      expect((await request(app).get(`${BASE}/test`)).status).toBe(403);
    });

    it('generates a stable key and rotates it on request', async () => {
      expect(key).toMatch(/^[0-9a-f]{48}$/);
      expect((await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key).toBe(key);
      const rotated = await request(app).post('/api/v1/music/settings/regenerate-key');
      expect(rotated.body.scrobbler_key).not.toBe(key);
      expect((await request(app).get(`${BASE}/test`).query({ key })).status).toBe(403);
    });

    it('rejects scrobbles with a bad key or a bad body', async () => {
      expect((await push({ key: 'nope' })).status).toBe(403);
      const bad = await push({ title: '' });
      expect(bad.status).toBe(400);
      expect(bad.body).toMatchObject({ status: 'failure', error: { type: 'invalid_scrobble' } });
      expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(0);
    });

    it('stores a scrobble and answers like a Maloja server', async () => {
      const res = await push({ album: 'Album', albumartists: ['Artist'], length: 200, duration: 190 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'success', track: { title: 'Song' } });
      const row = (await query('SELECT * FROM music_scrobbles')).rows[0];
      expect(row).toMatchObject({
        title: 'Song', artists: ['Artist'], album: 'Album', album_artists: ['Artist'],
        track_length: 200, listened_for: 190, source: 'multi-scrobbler',
      });
      expect(new Date(row.played_at).toISOString()).toBe('2024-05-01T12:00:00.000Z');
    });

    it('is idempotent for a repeated play', async () => {
      expect((await push()).status).toBe(200);
      expect((await push({ title: 'SONG' })).status).toBe(200);
      expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(1);
    });

    it('lists scrobbles newest first with pagination and date filters', async () => {
      for (let i = 0; i < 5; i++) await pushAt(i * 60);
      // No perpage: everything in range on one page, never a next_page that
      // multi-scrobbler can't follow.
      const all = await request(app).get(`${BASE}/scrobbles`);
      expect(all.body.list.length).toBeGreaterThan(2);
      expect(all.body.pagination.next_page).toBeNull();
      const first = await request(app).get(`${BASE}/scrobbles`).query({ perpage: 2, page: 0 });
      expect(first.body.status).toBe('ok');
      expect(first.body.list.map((s: any) => s.track.title)).toEqual(['Song 240', 'Song 180']);
      expect(first.body.pagination.next_page).toContain('page=1');
      const last = await request(app).get(`${BASE}/scrobbles`).query({ perpage: 2, page: 2 });
      expect(last.body.list).toHaveLength(1);
      expect(last.body.pagination.next_page).toBeNull();

      const day = await request(app).get(`${BASE}/scrobbles`).query({ in: '2024/05/01' });
      expect(day.body.list).toHaveLength(5);
      const none = await request(app).get(`${BASE}/scrobbles`).query({ in: '2024/05/04' }); // beyond the ±14h zone allowance
      expect(none.body.list).toEqual([]);
      const from = await request(app).get(`${BASE}/scrobbles`).query({ from: '2024/05/01', until: '2024/05/01' });
      expect(from.body.list).toHaveLength(5);
      expect((await request(app).get(`${BASE}/scrobbles`).query({ in: 'garbage' })).status).toBe(400);
    });
  });

  describe('listening sessions', () => {
    it('groups plays within the gap and splits beyond it', async () => {
      await pushAt(0);
      await pushAt(10);
      await pushAt(25);
      await pushAt(25 + 31);
      const rows = await sessions();
      expect(rows.map((r: any) => r.track_count)).toEqual([3, 1]);
    });

    it('merges two sessions bridged by a late-arriving play', async () => {
      await pushAt(0);
      await pushAt(50);
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([1, 1]);
      await pushAt(25);
      const rows = await sessions();
      expect(rows.map((r: any) => r.track_count)).toEqual([3]);
      const linked = await query('SELECT COUNT(*)::int AS n FROM music_scrobbles WHERE session_id IS NOT NULL');
      expect(linked.rows[0].n).toBe(3);
    });

    it('matches a from-scratch rebuild when plays arrive out of order', async () => {
      for (const offset of [90, 0, 40, 15, 200, 65]) await pushAt(offset);
      const incremental = (await sessions()).map((r: any) => r.track_count);
      // Force a full rebuild by changing the gap and changing it back.
      await request(app).put('/api/v1/music/settings').send({ session_gap_minutes: 31 });
      await request(app).put('/api/v1/music/settings').send({ session_gap_minutes: 30 });
      expect((await sessions()).map((r: any) => r.track_count)).toEqual(incremental);
      // 0/15/40/65/90 chain together (each gap <= 30m); 200 is on its own.
      expect(incremental).toEqual([5, 1]);
    });

    it('regroups history when the gap setting changes', async () => {
      await pushAt(0);
      await pushAt(45);
      expect(await sessions()).toHaveLength(2);
      const res = await request(app).put('/api/v1/music/settings').send({ session_gap_minutes: 60 });
      expect(res.status).toBe(200);
      expect(await sessions()).toHaveLength(1);
    });

    it('records the top artists of a session', async () => {
      await pushAt(0, 'a', ['Main']);
      await pushAt(1, 'b', ['Main', 'Guest']);
      await pushAt(2, 'c', ['Other']);
      const row = (await query('SELECT top_artists, search_text FROM music_sessions')).rows[0];
      expect(row.top_artists).toEqual(['Main', 'Guest', 'Other']);
      expect(row.search_text).toContain('Guest');
    });

    it('serves the tracks of a session in play order', async () => {
      await pushAt(10, 'second');
      await pushAt(0, 'first');
      const id = (await query('SELECT id FROM music_sessions')).rows[0].id;
      const res = await request(app).get(`/api/v1/music/sessions/${id}/tracks`);
      expect(res.body.map((t: any) => t.title)).toEqual(['second', 'first']); // newest first
      expect((await request(app).get('/api/v1/music/sessions/not-a-uuid/tracks')).status).toBe(400);
    });
  });

  describe('history lookup for duplicate detection', () => {
    it('finds a late-evening local play when asked for its local day', async () => {
      // 10:46 PM Eastern on Oct 25 is already Oct 26 in UTC.
      const time = Date.UTC(2026, 9, 26, 2, 46, 29) / 1000;
      await push({ title: 'Smoke Signals', artists: ['PRAANA'], time });
      for (let i = 0; i < 150; i++) await push({ title: `Filler ${i}`, artists: ['F'], time: time - 3600 - i * 60 });
      const res = await request(app).get(`${BASE}/scrobbles`).query({ from: '2026/10/25', until: '2026/10/25' });
      expect(res.body.pagination.next_page).toBeNull();
      expect(res.body.list.map((e: any) => e.track.title)).toContain('Smoke Signals');
    });
  });

  describe('reflect', () => {
    const play = (iso: string, title: string, timezone = 'UTC', artists = ['Artist']) =>
      query(
        `INSERT INTO music_scrobbles (user_id, played_at, title, artists, timezone) VALUES ($1, $2, $3, $4, $5)`,
        [DEFAULT_USER_ID, iso, title, artists, timezone],
      );
    const reflect = (date: string) => request(app).get('/api/v1/music/reflect').query({ date });

    it('ranks each earlier year\'s tracks by count, top seven, by the zone played in', async () => {
      // 2023-05-01: Song A x3 (one play at 02:00 UTC is still April 30 in Chicago, so use Chicago zone only for B)
      for (const h of [8, 9, 10]) await play(`2023-05-01T${String(h).padStart(2, '0')}:00:00Z`, 'Song A');
      await play('2023-05-01T11:00:00Z', 'song a'); // same song, different case
      for (const [i, t] of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].entries()) await play(`2023-05-01T${12 + i}:00:00Z`, `Song ${t}`);
      await play('2023-05-02T03:00:00Z', 'Evening in Chicago', 'America/Chicago'); // May 1 locally
      await play('2023-05-02T03:30:00Z', 'Late UTC', 'UTC'); // May 2: not this day
      await play('2022-05-01T12:00:00Z', 'Older', 'UTC', ['Other']);
      await play('2026-05-01T12:00:00Z', 'This year'); // not a reflection
      const res = await reflect('2026-05-01');
      expect(res.status).toBe(200);
      expect(res.body.map((y: any) => y.year)).toEqual([2023, 2022]);
      const tracks = res.body[0].tracks;
      expect(tracks).toHaveLength(7);
      expect(tracks[0]).toMatchObject({ title: 'song a', count: 4 }); // latest spelling
      expect(tracks.map((t: any) => t.title)).not.toContain('Late UTC');
      expect(res.body[1].tracks).toEqual([{ title: 'Older', artists: ['Other'], count: 1 }]);
      expect((await reflect('nope')).status).toBe(400);
    });
  });

  describe('home timeline', () => {
    const timeline = async (params: Record<string, string> = {}) =>
      (await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID, ...params })).body as any[];

    it('shows sessions but keeps short ones off the feed', async () => {
      await pushAt(0);
      await pushAt(5);
      await pushAt(10);
      await pushAt(500); // a lone play: a session, but below the default minimum of 3
      const items = (await timeline()).filter((i) => i.type === 'music');
      expect(items).toHaveLength(1);
      expect(items[0].data).toMatchObject({ track_count: 3, top_artists: ['Artist'] });
      expect(items[0].timezone).toBe('UTC');
      expect((await query('SELECT 1 FROM music_sessions')).rowCount).toBe(2);
    });

    it('pins the feed to listening sessions with the music filter param', async () => {
      for (const i of [0, 5, 10]) await pushAt(i);
      const items = await timeline({ from: '2024-05-01', to: '2024-05-01', music: 'sessions' });
      expect(items.map((i) => i.type)).toEqual(['music']);
    });

    it('honours the minimum-tracks setting and the type filter', async () => {
      await pushAt(0);
      await request(app).put('/api/v1/music/settings').send({ min_session_tracks: 1 });
      expect((await timeline()).filter((i) => i.type === 'music')).toHaveLength(1);
      await request(app).put('/api/v1/music/settings').send({ min_session_tracks: 2 });
      expect((await timeline()).filter((i) => i.type === 'music')).toHaveLength(0);
    });

    it('searches artists and titles', async () => {
      for (const i of [0, 1, 2]) await pushAt(i, `Track ${i}`, ['Khruangbin']);
      expect((await timeline({ q: 'khruang' })).filter((i) => i.type === 'music')).toHaveLength(1);
      expect((await timeline({ q: 'nothing' })).filter((i) => i.type === 'music')).toHaveLength(0);
    });
  });

  describe('listening before a check-in', () => {
    async function checkin(offsetMinutes: number) {
      const r = await query(
        `INSERT INTO sleep_entries (user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at)
         VALUES ($1, $2, 'UTC', $3, $3) RETURNING id`,
        [DEFAULT_USER_ID, Math.floor(Math.random() * 1e9), new Date((T0 + offsetMinutes * MIN) * 1000)],
      );
      return r.rows[0].id as string;
    }
    const around = async (...ids: string[]) =>
      (await request(app).get('/api/v1/music/around').query({ checkin_ids: ids.join(',') })).body as Record<string, any>;

    it('returns the last three plays on or before the check-in, newest first', async () => {
      for (const i of [0, 2, 4, 6, 8]) await pushAt(i, `Song ${i}`);
      const id = await checkin(7);
      const body = await around(id);
      expect(body[id].tracks.map((t: any) => t.title)).toEqual(['Song 6', 'Song 4', 'Song 2']);
      expect(body[id].tracks[0]).toMatchObject({ artists: ['Artist'], time: T0 + 6 * MIN });
      expect(body[id].has_more).toBe(true);
      const session = (await query('SELECT id FROM music_sessions')).rows[0].id;
      expect(body[id]).toMatchObject({ session_id: session, session_date: '2024-05-01', anchor_time: T0 + 7 * MIN });
    });

    it('reaches back only ten minutes, not the whole session gap', async () => {
      for (const i of [0, 5, 10]) await pushAt(i, `Song ${i}`);
      const id = await checkin(14);
      const body = await around(id);
      expect(body[id].tracks.map((t: any) => t.title)).toEqual(['Song 10', 'Song 5']);
      expect(body[id].has_more).toBe(true);
    });

    it('includes a play at the exact moment, excludes later ones, and has no more when all are shown', async () => {
      for (const i of [0, 2, 4, 6]) await pushAt(i, `Song ${i}`);
      const id = await checkin(4);
      const body = await around(id);
      expect(body[id].tracks.map((t: any) => t.title)).toEqual(['Song 4', 'Song 2', 'Song 0']);
      expect(body[id].has_more).toBe(false);
    });

    it('shows fewer than three when the session started recently', async () => {
      for (const i of [0, 2, 4, 6]) await pushAt(i, `Song ${i}`);
      const id = await checkin(2);
      const body = await around(id);
      expect(body[id].tracks.map((t: any) => t.title)).toEqual(['Song 2', 'Song 0']);
      expect(body[id].has_more).toBe(false);
    });

    it('stays within the session of the most recent play', async () => {
      for (const i of [0, 2, 4]) await pushAt(i, `Old ${i}`);
      for (const i of [100, 102, 104]) await pushAt(i, `New ${i}`);
      const id = await checkin(103);
      const body = await around(id);
      expect(body[id].tracks.map((t: any) => t.title)).toEqual(['New 102', 'New 100']);
      expect(body[id].has_more).toBe(false);
    });

    it('omits check-ins with no recent play, or whose session is not on the timeline', async () => {
      for (const i of [0, 2, 4]) await pushAt(i, `Song ${i}`);
      const tooLate = await checkin(4 + 11); // last play was more than ten minutes before
      const justInside = await checkin(4 + 10);
      const tooEarly = await checkin(-5);
      const body = await around(tooLate, justInside, tooEarly);
      expect(Object.keys(body)).toEqual([justInside]);
      // A session below the minimum track count is not a timeline item, so there is nothing to jump to.
      await request(app).put('/api/v1/music/settings').send({ min_session_tracks: 4 });
      expect(await around(justInside)).toEqual({});
    });

    it('handles several check-ins at once and returns nothing for unknown ids or no ids', async () => {
      for (const i of [0, 2, 4]) await pushAt(i, `A${i}`);
      for (const i of [200, 202, 204]) await pushAt(i, `B${i}`);
      const first = await checkin(5);
      const second = await checkin(205);
      const body = await around(first, second);
      expect(body[first].tracks[0].title).toBe('A4');
      expect(body[second].tracks[0].title).toBe('B204');
      expect(body[first].session_id).not.toBe(body[second].session_id);
      expect(await around('11111111-1111-4111-8111-111111111111')).toEqual({});
      expect((await request(app).get('/api/v1/music/around')).body).toEqual({});
    });
  });

  describe('profile stats and library', () => {
    beforeEach(async () => {
      await push({ title: 'Hit', artists: ['A', 'B'], album: 'Album One', albumartists: ['A'], time: T0, duration: 100 });
      await push({ title: 'Hit', artists: ['A', 'B'], album: 'Album One', albumartists: ['A'], time: T0 + 3600, duration: 100 });
      await push({ title: 'Deep Cut', artists: ['A'], album: 'Album One', albumartists: ['A'], time: T0 + 7200, duration: 50 });
      await push({ title: 'Other', artists: ['C'], time: T0 + 86400 * 3 });
    });

    it('totals and ranks the period', async () => {
      const res = await request(app).get('/api/v1/music/stats');
      expect(res.body.totals).toEqual({ scrobbles: 4, listened_seconds: 250, unique_artists: 3, unique_tracks: 3 });
      expect(res.body.top_songs[0]).toMatchObject({ name: 'Hit', artists: ['A', 'B'], plays: 2 });
      expect(res.body.top_artists.map((a: any) => [a.name, a.plays])).toEqual([['A', 3], ['B', 2], ['C', 1]]);
      expect(res.body.top_albums).toHaveLength(1);
      expect(res.body.top_albums[0]).toMatchObject({ name: 'Album One', artists: ['A'], plays: 3, unique_tracks: 2 });
    });

    it('limits stats to the selected period', async () => {
      const res = await request(app).get('/api/v1/music/stats').query({ from: '2024-05-01', to: '2024-05-01' });
      expect(res.body.totals.scrobbles).toBe(3);
      expect(res.body.top_artists.map((a: any) => a.name)).toEqual(['A', 'B']);
      const empty = await request(app).get('/api/v1/music/stats').query({ from: '2020-01-01', to: '2020-01-31' });
      expect(empty.body.totals).toMatchObject({ scrobbles: 0, listened_seconds: 0 });
      expect(empty.body.top_songs).toEqual([]);
    });

    it('serves each library view', async () => {
      const songs = await request(app).get('/api/v1/music/library').query({ view: 'songs' });
      expect(songs.body.total).toBe(3);
      // Ties go to the most recently played.
      expect(songs.body.rows.map((r: any) => [r.name, r.plays])).toEqual([['Hit', 2], ['Other', 1], ['Deep Cut', 1]]);
      expect(songs.body.rows[0]).toMatchObject({ album: 'Album One', listened_seconds: 200 });
      const artists = await request(app).get('/api/v1/music/library').query({ view: 'artists' });
      expect(artists.body.rows[0]).toMatchObject({ name: 'A', plays: 3, unique_tracks: 2 });
      const albums = await request(app).get('/api/v1/music/library').query({ view: 'albums' });
      expect(albums.body.rows).toHaveLength(1);
      expect(albums.body.total).toBe(1);
      const fallback = await request(app).get('/api/v1/music/library').query({ view: 'bogus' });
      expect(fallback.body.rows[0].name).toBe('Hit');
    });

    it('exposes the earliest scrobble date for the all-time selector', async () => {
      const res = await request(app).get('/api/v1/stats/earliest-dates').query({ user_id: DEFAULT_USER_ID });
      expect(res.body.music).toBe('2024-05-01');
    });
  });

  describe('import', () => {
    const exportFile = (scrobbles: unknown[]) =>
      Buffer.from(JSON.stringify({ maloja: { version: '3.2.9' }, scrobbles }));
    const entry = (offsetMinutes: number, title = `Imported ${offsetMinutes}`) => ({
      time: T0 + offsetMinutes * MIN,
      track: { artists: ['Artist'], title, album: { albumtitle: 'Album', artists: ['Artist'] }, length: 200 },
      duration: 190,
      origin: 'client:spotify',
    });
    const upload = (buf: Buffer, name = 'maloja.json') =>
      request(app).post('/api/v1/music/import/scrobbles').attach('file', buf, name);

    it('imports a Maloja export and builds sessions', async () => {
      const res = await upload(exportFile([entry(0), entry(5), entry(10), entry(400)]));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ parsed: 4, inserted: 4, duplicates: 0, skipped: 0 });
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([3, 1]);
    });

    it('is idempotent and merges with live scrobbles', async () => {
      await pushAt(0, 'Imported 0');
      const res = await upload(exportFile([entry(0), entry(5)]));
      expect(res.body).toMatchObject({ parsed: 2, inserted: 1, duplicates: 1 });
      expect((await upload(exportFile([entry(0), entry(5)]))).body.inserted).toBe(0);
      expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(2);
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([2]);
    });

    it('reports unreadable rows and rejects bad files', async () => {
      const mixed = await upload(exportFile([entry(0), { time: 'x' }]));
      expect(mixed.body).toMatchObject({ inserted: 1, skipped: 1 });
      expect((await upload(Buffer.from('nope'))).status).toBe(400);
      expect((await upload(Buffer.from('{}'))).status).toBe(400);
      expect((await upload(exportFile([entry(0)]), 'export.txt')).status).toBe(400);
    });
  });

  describe('per-play timezones', () => {
    const CHICAGO = 'America/Chicago';
    const AUCKLAND = 'Pacific/Auckland';

    async function addCheckin(timezone: string, epoch: number) {
      const venue = await query(
        `INSERT INTO venues (name, latitude, longitude) VALUES ('V', 1, 1) RETURNING id`,
      );
      await query(
        `INSERT INTO checkins (user_id, venue_id, checked_in_at, checkin_timezone) VALUES ($1, $2, $3, $4)`,
        [DEFAULT_USER_ID, venue.rows[0].id, new Date(epoch * 1000), timezone],
      );
    }
    const zones = async () =>
      (await query('SELECT title, timezone FROM music_scrobbles ORDER BY played_at')).rows.map(
        (r: any) => [r.title, r.timezone],
      );

    it('gives a live play the zone of the latest check-in at or before it', async () => {
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 3600);
      await pushAt(0, 'before trip'); // Chicago
      await pushAt(120, 'after landing'); // Auckland
      expect(await zones()).toEqual([['before trip', CHICAGO], ['after landing', AUCKLAND]]);
    });

    it('uses the fallback before the first check-in, and ignores UTC-labelled check-ins', async () => {
      await request(app).put('/api/v1/music/settings').send({ timezone: 'Europe/Paris' });
      await addCheckin('UTC', T0 - 3600); // an import's unknown zone is no evidence
      await addCheckin(CHICAGO, T0 + 3600);
      await pushAt(0, 'early');
      await pushAt(90, 'later');
      expect(await zones()).toEqual([['early', 'Europe/Paris'], ['later', CHICAGO]]);
    });

    it('keeps each play in its own zone through sessions, days and stats', async () => {
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 3 * 3600);
      await pushAt(0, 'chicago play'); // 12:00Z = 07:00 on 05-01 in Chicago
      await pushAt(6 * 60, 'auckland play'); // 18:00Z = 06:00 on 05-02 in Auckland
      const rows = (await query('SELECT timezone FROM music_sessions ORDER BY started_at')).rows;
      expect(rows.map((r: any) => r.timezone)).toEqual([CHICAGO, AUCKLAND]);

      const stats = await request(app).get('/api/v1/music/stats').query({ from: '2024-05-02', to: '2024-05-02' });
      expect(stats.body.totals.scrobbles).toBe(1);
      expect(stats.body.top_songs[0].name).toBe('auckland play');
      const library = await request(app).get('/api/v1/music/library').query({ from: '2024-05-01', to: '2024-05-01' });
      expect(library.body.rows.map((r: any) => r.name)).toEqual(['chicago play']);
    });

    it('takes a session\'s zone from its first play and reports each track\'s own', async () => {
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 20 * 60);
      await pushAt(0, 'one');
      await pushAt(10, 'two');
      await pushAt(30, 'three'); // lands after the zone change, but within the gap
      const session = (await query('SELECT id, timezone FROM music_sessions')).rows;
      expect(session).toHaveLength(1);
      expect(session[0].timezone).toBe(CHICAGO);
      const tracks = await request(app).get(`/api/v1/music/sessions/${session[0].id}/tracks`);
      expect(tracks.body.map((t: any) => [t.title, t.timezone])).toEqual([
        ['three', AUCKLAND], ['two', CHICAGO], ['one', CHICAGO],
      ]);
    });

    it('buckets the earliest-date selector by local date', async () => {
      await addCheckin(CHICAGO, T0 - 86400);
      await push({ title: 'late night', time: Date.parse('2024-05-01T03:00:00Z') / 1000 });
      const res = await request(app).get('/api/v1/stats/earliest-dates').query({ user_id: DEFAULT_USER_ID });
      expect(res.body.music).toBe('2024-04-30');
    });

    it('assigns zones to imported history from the check-ins that cover it', async () => {
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 3600);
      const entry = (offsetMinutes: number, title: string) => ({
        time: T0 + offsetMinutes * MIN,
        track: { artists: ['Artist'], title },
        duration: 100,
      });
      const res = await request(app)
        .post('/api/v1/music/import/scrobbles')
        .attach('file', Buffer.from(JSON.stringify({ scrobbles: [entry(0, 'a'), entry(120, 'b')] })), 'x.json');
      expect(res.body.inserted).toBe(2);
      expect(await zones()).toEqual([['a', CHICAGO], ['b', AUCKLAND]]);
    });

    it('re-assigns zones from check-ins added afterwards', async () => {
      // An explicit fallback stops the first-use adoption from doing this for us.
      await request(app).put('/api/v1/music/settings').send({ timezone: 'UTC' });
      await pushAt(0, 'a');
      await pushAt(60, 'b');
      expect(await zones()).toEqual([['a', 'UTC'], ['b', 'UTC']]);
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 30 * MIN);
      const res = await request(app).post('/api/v1/music/timezones/refresh');
      expect(res.body).toEqual({ updated: 2 });
      expect(await zones()).toEqual([['a', CHICAGO], ['b', AUCKLAND]]);
      expect((await query('SELECT timezone FROM music_sessions ORDER BY started_at')).rows.map((r: any) => r.timezone))
        .toEqual([CHICAGO, AUCKLAND]);
      // Nothing left to change.
      expect((await request(app).post('/api/v1/music/timezones/refresh')).body).toEqual({ updated: 0 });
    });

    it('re-assigns fallback plays when the fallback zone changes', async () => {
      await pushAt(0, 'a');
      await request(app).put('/api/v1/music/settings').send({ timezone: 'Europe/Paris' });
      expect(await zones()).toEqual([['a', 'Europe/Paris']]);
      expect((await query('SELECT timezone FROM music_sessions')).rows[0].timezone).toBe('Europe/Paris');
    });

    it('keeps each play\'s zone through backup and restore, even without the check-ins', async () => {
      const { server } = await import('../../server');
      await addCheckin(CHICAGO, T0 - 86400);
      await addCheckin(AUCKLAND, T0 + 30 * MIN);
      await pushAt(0, 'a');
      await pushAt(60, 'b');
      const exported = await server.backupExport!({ user_id: DEFAULT_USER_ID });
      await query('DELETE FROM checkins');
      await query('DELETE FROM music_scrobbles');
      await query('DELETE FROM music_sessions');
      await server.backupImport!({ user_id: DEFAULT_USER_ID }, exported);
      expect(await zones()).toEqual([['a', CHICAGO], ['b', AUCKLAND]]);
    });

    it('falls back for restored plays from an older backup that has no zones', async () => {
      const { server } = await import('../../server');
      await addCheckin(CHICAGO, T0 - 86400);
      const row = { played_at: new Date(T0 * 1000).toISOString(), title: 'old', artists: ['Artist'] };
      await server.backupImport!({ user_id: DEFAULT_USER_ID }, [row]);
      expect(await zones()).toEqual([['old', CHICAGO]]);
    });
  });

  describe('settings', () => {
    it('reports connection details and counts', async () => {
      await pushAt(0);
      const res = await request(app).get('/api/v1/music/settings');
      expect(res.body).toMatchObject({
        scrobbler_key: key, session_gap_minutes: 30, min_session_tracks: 3,
        timezone: 'UTC', scrobbles: 1, scrobbler_path: BASE,
      });
    });

    it('adopts the timezone of the latest check-in until one is chosen', async () => {
      await pushAt(0);
      expect((await query('SELECT timezone FROM music_sessions')).rows[0].timezone).toBe('UTC');
      // Nothing to infer from yet: the default stays unstored.
      expect((await request(app).get('/api/v1/music/settings')).body.timezone).toBe('UTC');
      expect((await query(`SELECT 1 FROM plugin_settings WHERE plugin_id = 'music' AND key = 'timezone'`)).rowCount).toBe(0);

      const venue = await query(`INSERT INTO venues (name, latitude, longitude) VALUES ('Home', 41, -87) RETURNING id`);
      await query(
        `INSERT INTO checkins (user_id, venue_id, checked_in_at, checkin_timezone) VALUES ($1, $2, $3, 'America/Chicago')`,
        [DEFAULT_USER_ID, venue.rows[0].id, new Date((T0 - 86400) * 1000)],
      );
      expect((await request(app).get('/api/v1/music/settings')).body.timezone).toBe('America/Chicago');
      // Sessions built under the UTC default were regrouped.
      expect((await query('SELECT timezone FROM music_sessions')).rows[0].timezone).toBe('America/Chicago');

      // An explicit choice sticks, even UTC.
      await request(app).put('/api/v1/music/settings').send({ timezone: 'UTC' });
      expect((await request(app).get('/api/v1/music/settings')).body.timezone).toBe('UTC');
    });

    it('validates updates', async () => {
      const put = (body: object) => request(app).put('/api/v1/music/settings').send(body);
      expect((await put({ session_gap_minutes: 0 })).status).toBe(400);
      expect((await put({ session_gap_minutes: 2.5 })).status).toBe(400);
      expect((await put({ min_session_tracks: 'many' })).status).toBe(400);
      expect((await put({ timezone: 'Mars/Olympus' })).status).toBe(400);
      expect((await put({ timezone: 'America/Chicago' })).body.timezone).toBe('America/Chicago');
    });
  });

  describe('backup and start-over', () => {
    it('round-trips scrobbles through backup export/import', async () => {
      const { server } = await import('../../server');
      for (const i of [0, 5, 10]) await pushAt(i);
      const exported = (await server.backupExport!({ user_id: DEFAULT_USER_ID })) as { scrobbles: unknown[] };
      expect(exported.scrobbles).toHaveLength(3);
      await query('DELETE FROM music_scrobbles');
      await query('DELETE FROM music_sessions');
      const restored = await server.backupImport!({ user_id: DEFAULT_USER_ID }, exported);
      expect(restored).toBe(3);
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([3]);
      expect(await server.backupImport!({ user_id: DEFAULT_USER_ID }, exported)).toBe(0);
    });

    it('restores through the HTTP backup path with the backed-up session settings', async () => {
      await request(app).put('/api/v1/music/settings').send({ session_gap_minutes: 90, timezone: 'America/Chicago' });
      for (const i of [0, 60, 120]) await pushAt(i);
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([3]);

      const zip = await new Promise<Buffer>((resolve, reject) => {
        request(app)
          .get('/api/v1/backup/export')
          .buffer(true)
          .parse((res: any, cb: any) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
            res.on('error', reject);
          })
          .end((err: any, res: any) => (err ? reject(err) : resolve(res.body as Buffer)));
      });

      // A fresh database: no scrobbles, no music settings rows at all.
      await resetIntegrationDatabase();
      expect((await query(`SELECT 1 FROM plugin_settings WHERE plugin_id = 'music'`)).rowCount).toBe(0);

      const imported = await request(app)
        .post('/api/v1/backup/import')
        .attach('file', zip, 'wherewewere-backup.zip')
        .set('Content-Type', 'application/zip');
      expect(imported.status).toBe(200);

      const settings = (await request(app).get('/api/v1/music/settings')).body;
      expect(settings).toMatchObject({ session_gap_minutes: 90, timezone: 'America/Chicago', scrobbles: 3 });
      // Built with the backed-up gap (90m), not the default (30m).
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([3]);
      expect((await query('SELECT timezone FROM music_sessions')).rows[0].timezone).toBe('America/Chicago');
    });

    it('imports a Last.fm CSV, idempotently, with whole artist credits', async () => {
      const csv = [
        'uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid',
        `"${T0}","x","Above & Beyond","","Group Therapy","","Sun & Moon",""`,
        `"${T0 + 240}","x","Above & Beyond","","Group Therapy","","Oceanic",""`,
        `"${T0 + 480}","x","Above & Beyond","","","","Alone Tonight",""`,
      ].join('\n');
      const post = () => request(app).post('/api/v1/music/import/lastfm').attach('file', Buffer.from(csv), 'lastfm.csv');
      const first = await post();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ parsed: 3, inserted: 3, duplicates: 0 });
      expect((await post()).body).toMatchObject({ inserted: 0, duplicates: 3 });
      const rows = (await query('SELECT DISTINCT artists FROM music_scrobbles')).rows;
      expect(rows).toEqual([{ artists: ['Above & Beyond'] }]);
      expect((await sessions()).map((r: any) => r.track_count)).toEqual([3]);
      const bad = await request(app).post('/api/v1/music/import/lastfm').attach('file', Buffer.from('a,b\n1,2'), 'x.csv');
      expect(bad.status).toBe(400);
    });

    it('removes every scrobble and session through POST /backup/start-over', async () => {
      for (const i of [0, 5, 10, 200]) await pushAt(i);
      expect((await sessions()).length).toBe(2);
      const res = await request(app)
        .post('/api/v1/backup/start-over')
        .send({
          first_confirmation: 'DELETE MY DATA',
          second_confirmation: 'START OVER',
          options: { delete_music_checkins: true },
        });
      expect(res.status).toBe(200);
      expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(0);
      expect((await query('SELECT 1 FROM music_sessions')).rowCount).toBe(0);
    });

    it('deletes scrobbles and sessions on start-over', async () => {
      const { server } = await import('../../server');
      await pushAt(0);
      expect(await server.deleteUserData!({ user_id: DEFAULT_USER_ID })).toBe(1);
      expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(0);
      expect((await query('SELECT 1 FROM music_sessions')).rowCount).toBe(0);
    });
  });
});
