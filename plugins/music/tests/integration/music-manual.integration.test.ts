import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { getMusicSettings } from '../../services/scrobbles';
import { setSuggestFetch } from '../../services/suggest';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z
let key = '';

const manual = (over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/v1/music/scrobbles')
    .send({ title: 'Sun & Moon', artists: ['Above & Beyond'], album: 'Group Therapy', played_at: new Date(T0 * 1000).toISOString(), timezone: 'America/Chicago', ...over });
const push = (title: string, offsetMin: number, artists = ['Above & Beyond']) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, time: T0 + offsetMin * 60, key });
const rows = async () => (await query('SELECT title, source, note, timezone FROM music_scrobbles ORDER BY played_at')).rows;

describe('hand-entered plays', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterEach(() => setSuggestFetch(null));
  afterAll(teardownIntegrationDatabase);

  it('records a song with its note, place and companions, in the zone it was heard in', async () => {
    const res = await manual({
      note: 'Heard it at the farmers market', companions: ['Sam', 'sam', ' Riley '], latitude: 41.8781, longitude: -87.6298, location_accuracy: 35,
      track_length: 321,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(String), session_id: expect.any(String) });
    const row = (await query('SELECT * FROM music_scrobbles')).rows[0];
    expect(row).toMatchObject({
      source: 'manual', note: 'Heard it at the farmers market', timezone: 'America/Chicago',
      latitude: 41.8781, longitude: -87.6298, location_accuracy: 35, track_length: 321, album: 'Group Therapy',
    });
    expect((await query(`SELECT name FROM companions WHERE checkin_type = 'music' AND checkin_id = $1 ORDER BY name`, [row.id])).rows.map((r: any) => r.name)).toEqual(['Riley', 'Sam']);
  });

  it('always shows a session with a hand-entered play on the timeline, however short', async () => {
    await manual({ companions: ['Sam'] });
    await push('Other', 600); // a lone scrobbler play: a one-track session, below the minimum
    const feed = (await request(app).get('/api/v1/timeline')).body.filter((i: any) => i.type === 'music');
    expect(feed).toHaveLength(1);
    expect(feed[0].data.track_count).toBe(1);
    expect(feed[0].companions).toEqual(['Sam']);
    expect((await query('SELECT has_manual FROM music_sessions ORDER BY started_at')).rows.map((r: any) => r.has_manual)).toEqual([true, false]);
  });

  it('lists its note, companions and place with the session tracks', async () => {
    await manual({ note: 'hi', companions: ['Sam'], latitude: 1, longitude: 2 });
    await push('Neighbour', 2);
    const id = (await query('SELECT id FROM music_sessions')).rows[0].id;
    const tracks = (await request(app).get(`/api/v1/music/sessions/${id}/tracks`)).body;
    const mine = tracks.find((t: any) => t.title === 'Sun & Moon');
    expect(mine).toMatchObject({ manual: true, note: 'hi', companions: ['Sam'], latitude: 1, longitude: 2, id: expect.any(String) });
    expect(tracks.find((t: any) => t.title === 'Neighbour')).toMatchObject({ manual: false, note: null, companions: [] });
  });

  it('shows it in the listening-before preview of another check-in even when the session is short', async () => {
    const res = await manual();
    expect(res.status).toBe(201);
    const A = '00000000-0000-4000-8000-0000000000aa';
    const { getListeningBefore } = await import('../../services/scrobbles');
    const found = await getListeningBefore(DEFAULT_USER_ID, [{ id: A, time: new Date((T0 + 300) * 1000) }], 30, 3);
    expect(found.get(A)?.tracks.map((t) => t.title)).toEqual(['Sun & Moon']);
  });

  describe('near-duplicates', () => {
    it('reports a play of the same song around then instead of storing it, unless forced', async () => {
      await push('Sun & Moon', 3);
      const res = await manual();
      expect(res.status).toBe(409);
      expect(res.body.duplicate).toMatchObject({ title: 'Sun & Moon', source: 'multi-scrobbler' });
      expect((await rows()).length).toBe(1);
      expect((await manual({ force: true })).status).toBe(201);
      expect((await rows()).map((r: any) => r.source)).toEqual(['manual', 'multi-scrobbler']);
    });

    it('treats a different song, a different artist or a distant play as new', async () => {
      await push('Other Song', 2);
      await push('Sun & Moon', 3, ['Somebody Else']);
      await push('Sun & Moon', 60);
      expect((await manual()).status).toBe(201);
    });

    it('skips the scrobbler\'s copy of a song already written down, but not other songs or far-off plays', async () => {
      await manual({ note: 'mine' });
      const dup = await push('Sun & Moon', 4);
      expect(dup.status).toBe(200); // the scrobbler is told it worked
      expect((await push('Sun & Moon', 7)).status).toBe(200); // beyond the window: a separate listen
      expect((await push('Different', 1)).status).toBe(200);
      expect((await rows()).map((r: any) => [r.title, r.source])).toEqual([
        ['Sun & Moon', 'manual'], ['Different', 'multi-scrobbler'], ['Sun & Moon', 'multi-scrobbler'],
      ]);
      expect((await rows())[0].note).toBe('mine');
    });

    it('does not make an import skip plays', async () => {
      await manual();
      const { insertScrobblesBulk } = await import('../../services/scrobbles');
      expect(await insertScrobblesBulk(DEFAULT_USER_ID, [{ playedAt: new Date((T0 + 60) * 1000), title: 'Sun & Moon', artists: ['Above & Beyond'], source: 'import' }])).toBe(1);
    });
  });

  it('validates the request', async () => {
    expect((await manual({ title: '  ' })).status).toBe(400);
    expect((await manual({ artists: [] })).status).toBe(400);
    expect((await manual({ played_at: 'yesterday-ish' })).status).toBe(400);
    expect((await manual({ played_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })).status).toBe(400);
    // Bad optional values are dropped rather than refused.
    const ok = await manual({ track_length: -5, latitude: 500, longitude: 2, timezone: 'Not/AZone', note: '   ' });
    expect(ok.status).toBe(201);
    expect((await query('SELECT track_length, latitude, longitude, note FROM music_scrobbles')).rows[0]).toEqual({ track_length: null, latitude: null, longitude: null, note: null });
  });

  it('infers the zone from other check-ins when none is sent', async () => {
    const res = await manual({ timezone: undefined });
    expect(res.status).toBe(201);
    expect((await rows())[0].timezone).toEqual(expect.any(String));
  });

  describe('taking one back', () => {
    it('removes a hand-entered play, its companions, and rebuilds the sessions', async () => {
      const created = await manual({ companions: ['Sam'] });
      await push('Neighbour', 2);
      expect((await request(app).delete(`/api/v1/music/scrobbles/${created.body.id}`)).status).toBe(200);
      expect((await rows()).map((r: any) => r.title)).toEqual(['Neighbour']);
      expect((await query(`SELECT 1 FROM companions WHERE checkin_type = 'music'`)).rowCount).toBe(0);
      const sessions = (await query('SELECT track_count, has_manual FROM music_sessions')).rows;
      expect(sessions).toEqual([{ track_count: 1, has_manual: false }]);
    });

    it('removes a scrobbler\'s play too, and refuses unknown ids', async () => {
      await push('Sun & Moon', 0);
      await push('Neighbour', 2);
      const id = (await query(`SELECT id FROM music_scrobbles WHERE title = 'Sun & Moon'`)).rows[0].id;
      expect((await request(app).delete(`/api/v1/music/scrobbles/${id}`)).status).toBe(200);
      expect((await rows()).map((r: any) => r.title)).toEqual(['Neighbour']);
      expect((await query('SELECT track_count FROM music_sessions')).rows).toEqual([{ track_count: 1 }]);
      expect((await request(app).delete(`/api/v1/music/scrobbles/${id}`)).status).toBe(404);
      expect((await request(app).delete('/api/v1/music/scrobbles/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await request(app).delete('/api/v1/music/scrobbles/nope')).status).toBe(400);
    });
  });

  describe('a play\'s own page', () => {
    const detail = (id: string) => request(app).get(`/api/v1/music/scrobbles/${id}`);
    const idOf = async (title: string) => (await query('SELECT id FROM music_scrobbles WHERE title = $1 ORDER BY played_at LIMIT 1', [title])).rows[0].id;

    it('describes the play, your history with the song, and its place in the session', async () => {
      await push('First', 0);
      await manual({ note: 'at the market', companions: ['Sam'], latitude: 1.5, longitude: 2.5, location_accuracy: 20, track_length: 321, played_at: new Date((T0 + 120) * 1000).toISOString() });
      await push('Last', 4);
      await push('Sun & Moon', 600); // another play of the song, in a later session
      const res = await detail(await idOf('Sun & Moon'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: 'Sun & Moon', artists: ['Above & Beyond'], album: 'Group Therapy', source: 'manual', note: 'at the market',
        companions: ['Sam'], latitude: 1.5, longitude: 2.5, location_accuracy: 20, track_length: 321, timezone: 'America/Chicago',
        album_ref: 'group therapy|above & beyond', art_id: null,
      });
      expect(res.body.song_key).toEqual(expect.any(String));
      expect(res.body.history).toMatchObject({ plays: 2 });
      expect(new Date(res.body.history.first_played_at).getTime()).toBe((T0 + 120) * 1000);
      expect(new Date(res.body.history.last_played_at).getTime()).toBe((T0 + 600 * 60) * 1000);
      expect(res.body.session).toMatchObject({ position: 2, count: 3, previous: { title: 'First' }, next: { title: 'Last' } });
      expect(res.body.session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('has no neighbours at the ends of a session, and works for a scrobbled play', async () => {
      await push('Only', 0);
      const res = await detail(await idOf('Only'));
      expect(res.body).toMatchObject({ source: 'multi-scrobbler', note: null, companions: [], latitude: null });
      expect(res.body.session).toMatchObject({ position: 1, count: 1, previous: null, next: null });
    });

    it('404s for no such play and 400s for a bad id', async () => {
      expect((await detail('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await detail('nope')).status).toBe(400);
    });
  });

  describe('correcting a play', () => {
    const edit = (id: string, over: Record<string, unknown> = {}) =>
      request(app).put(`/api/v1/music/scrobbles/${id}`).send({
        title: 'Sun & Moon', artists: ['Above & Beyond'], album: 'Group Therapy', played_at: new Date(T0 * 1000).toISOString(), ...over,
      });
    const first = async (title: string) => (await query('SELECT * FROM music_scrobbles WHERE title = $1', [title])).rows[0];

    it('changes the song, album, length, note, companions and place of any play, including a scrobbler\'s', async () => {
      await push('Wrong Title', 0);
      const id = (await first('Wrong Title')).id;
      const res = await edit(id, { album: 'Right Album', track_length: 200, note: 'fixed', companions: ['Riley'], latitude: 3, longitude: 4, timezone: 'Europe/Paris' });
      expect(res.status).toBe(200);
      const row = await first('Sun & Moon');
      expect(row).toMatchObject({ id, source: 'multi-scrobbler', album: 'Right Album', track_length: 200, note: 'fixed', latitude: 3, longitude: 4, timezone: 'Europe/Paris' });
      expect((await query(`SELECT name FROM companions WHERE checkin_id = $1`, [id])).rows.map((r: any) => r.name)).toEqual(['Riley']);
      // Clearing optional fields works too.
      await edit(id, { album: null, note: null, companions: [], latitude: null, longitude: null });
      expect(await first('Sun & Moon')).toMatchObject({ album: null, note: null, latitude: null });
      expect((await query(`SELECT 1 FROM companions WHERE checkin_id = $1`, [id])).rowCount).toBe(0);
    });

    it('regroups the sessions when the time moves', async () => {
      await push('A', 0);
      await push('B', 5);
      const mover = await manual({ title: 'Mover', played_at: new Date((T0 + 10 * 60) * 1000).toISOString() });
      await push('Far', 600);
      const counts = async () => (await query('SELECT track_count FROM music_sessions ORDER BY started_at')).rows.map((r: any) => r.track_count);
      expect(await counts()).toEqual([3, 1]);
      // Move it next to the far play: the first session shrinks, the second grows.
      expect((await edit(mover.body.id, { title: 'Mover', played_at: new Date((T0 + 601 * 60) * 1000).toISOString() })).status).toBe(200);
      expect(await counts()).toEqual([2, 2]);
      const sessions = (await query('SELECT has_manual FROM music_sessions ORDER BY started_at')).rows.map((r: any) => r.has_manual);
      expect(sessions).toEqual([false, true]);
    });

    it('refuses a change that collides with another play, and unknown ids and bad input', async () => {
      await push('Sun & Moon', 0);
      await push('Other', 10);
      const other = (await first('Other')).id;
      expect((await edit(other, { title: 'Sun & Moon' })).status).toBe(409);
      expect((await first('Other')).id).toBe(other); // unchanged
      expect((await edit('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await edit('nope')).status).toBe(400);
      expect((await edit(other, { title: ' ' })).status).toBe(400);
    });
  });

  describe('autocomplete', () => {
    const deezer = (tracks: unknown[]) => async () => ({ ok: true, status: 200, json: async () => ({ data: tracks }) });
    const track = (title: string, artist: string, album: string, duration = 200) => ({ title, artist: { name: artist }, album: { title: album, cover_small: 'https://cdn/c.jpg' }, duration });
    const suggest = (q: Record<string, string>) => request(app).get('/api/v1/music/suggest').query(q);

    it('offers songs you play first, then the catalog, without repeating one', async () => {
      await push('Sun & Moon', 0);
      await push('Sun & Moon', 60);
      await request(app).post(`${BASE}/newscrobble`).send({ title: 'Sundial', artists: ['Someone'], album: 'Dial', time: T0 + 7200, length: 180, key });
      setSuggestFetch(deezer([track('Sun and Moon', 'Above & Beyond', 'Group Therapy'), track('Sun Is Shining', 'Bob Marley', 'Exodus', 270)]) as any);
      const res = await suggest({ title: 'sun' });
      expect(res.body.catalog_unavailable).toBe(false);
      expect(res.body.suggestions.map((s: any) => [s.source, s.title, s.plays])).toEqual([
        ['library', 'Sun & Moon', 2], ['library', 'Sundial', 1], ['deezer', 'Sun Is Shining', null],
      ]);
      expect(res.body.suggestions[1]).toMatchObject({ album: 'Dial', length: 180 });
      expect(res.body.suggestions[2]).toMatchObject({ artists: ['Bob Marley'], album: 'Exodus', length: 270, cover_url: 'https://cdn/c.jpg' });
    });

    it('filters by artist and title together, and ignores LIKE wildcards', async () => {
      await push('Sun & Moon', 0);
      await push('100% Pure', 60, ['Other']);
      expect((await suggest({ artist: 'above', title: 'moon' })).body.suggestions.map((s: any) => s.title)).toEqual(['Sun & Moon']);
      expect((await suggest({ artist: 'other', title: 'moon' })).body.suggestions).toEqual([]);
      expect((await suggest({ title: '%' })).body.suggestions).toEqual([]);
      expect((await suggest({ title: '100%' })).body.suggestions.map((s: any) => s.title)).toEqual(['100% Pure']);
    });

    it('still answers from your library when the catalog is down, and says so', async () => {
      await push('Sun & Moon', 0);
      setSuggestFetch((async () => { throw new Error('offline'); }) as any);
      const res = await suggest({ title: 'sun' });
      expect(res.body.catalog_unavailable).toBe(true);
      expect(res.body.suggestions.map((s: any) => s.title)).toEqual(['Sun & Moon']);
    });

    it('answers nothing to a very short query', async () => {
      await push('Sun & Moon', 0);
      expect((await suggest({ title: 's' })).body.suggestions).toEqual([]);
    });
  });

  describe('backups', () => {
    it('keeps ids, notes and places so companions stay attached', async () => {
      const created = await manual({ note: 'n', latitude: 3, longitude: 4, location_accuracy: 12, companions: ['Sam'] });
      const { server } = await import('../../server');
      const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
      await query('DELETE FROM music_scrobbles');
      await query('DELETE FROM music_sessions');
      await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
      const row = (await query('SELECT id, source, note, latitude, longitude, location_accuracy FROM music_scrobbles')).rows[0];
      expect(row).toEqual({ id: created.body.id, source: 'manual', note: 'n', latitude: 3, longitude: 4, location_accuracy: 12 });
      expect((await query('SELECT has_manual FROM music_sessions')).rows[0].has_manual).toBe(true);
      expect((await query(`SELECT name FROM companions WHERE checkin_id = $1`, [created.body.id])).rows[0].name).toBe('Sam');
    });

    it('is removed by Start Over, companions included', async () => {
      await manual({ companions: ['Sam'] });
      const { server } = await import('../../server');
      await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
      expect((await query(`SELECT 1 FROM companions WHERE checkin_type = 'music'`)).rowCount).toBe(0);
    });
  });
});
