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
const T0 = 1714564800;
const DAY = 86_400;
let key = '';

const push = (title: string, artists: string[], offsetSeconds: number, album?: string) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: T0 + offsetSeconds, key });
const library = (params: Record<string, string | number> = {}) =>
  request(app).get('/api/v1/music/library').query({ view: 'songs', ...params });
const keyOf = async (title: string) => (await query('SELECT song_key FROM music_scrobbles WHERE title = $1 LIMIT 1', [title])).rows[0].song_key as string;

/** The way Spotify and Last.fm each wrote one song. */
async function seedKnownYouBefore() {
  for (let i = 0; i < 4; i++) await push('Known You Before (with Emilie Brandt)', ['Jason Ross'], i * DAY, 'Known You Before'); // Last.fm style
  for (let i = 0; i < 3; i++) await push('Known You Before', ['Jason Ross'], (10 + i) * DAY);
  await push('Known You Before', ['Jason Ross', 'Seven Lions', 'Emilie Brandt'], 20 * DAY, 'Known You Before'); // Spotify style, latest
  await push('Known You Before - Trivecta Remix', ['Jason Ross'], 30 * DAY); // a different version
}

describe('one song, however it was written', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterAll(teardownIntegrationDatabase);

  it('gives credit variants of a title and remaster tags the same identity, but not remixes or other artists', async () => {
    const keys = async (...pairs: [string, string[]][]) => {
      let t = 0;
      for (const [title, artists] of pairs) await push(title, artists, (t += 60));
      return (await query('SELECT song_key FROM music_scrobbles ORDER BY played_at')).rows.map((r: any) => r.song_key);
    };
    const [a, b, c, d, e, f, g, h] = await keys(
      ['Song', ['Artist']], ['Song (feat. Guest)', ['Artist']], ['SONG [ft. Guest & Other]', ['artist']], ['Song (with Guest)', ['Artist', 'Guest']],
      ['Song - Remastered 2009', ['Artist']], ['Song (2011 Remaster)', ['Artist']],
      ['Song - Live', ['Artist']], ['Song', ['Someone Else']],
    );
    expect(new Set([a, b, c, d, e, f]).size).toBe(1);
    expect(new Set([a, g, h]).size).toBe(3);
  });

  it('counts the plays together in the library, under the latest spelling and the fullest credit', async () => {
    await seedKnownYouBefore();
    const res = await library();
    expect(res.body.total).toBe(2); // the song and its remix
    const song = res.body.rows.find((r: any) => r.name === 'Known You Before');
    expect(song).toMatchObject({ plays: 8, artists: ['Jason Ross', 'Seven Lions', 'Emilie Brandt'], album: 'Known You Before' });
    expect(res.body.rows.find((r: any) => r.name.includes('Trivecta'))).toMatchObject({ plays: 1 });
    expect((await request(app).get('/api/v1/music/stats')).body.totals.unique_tracks).toBe(2);
  });

  it("shows a play's page the same count as the library, from any of its spellings", async () => {
    await seedKnownYouBefore();
    const recent = (await query(`SELECT id FROM music_scrobbles WHERE array_length(artists, 1) = 3`)).rows[0].id;
    const older = (await query(`SELECT id FROM music_scrobbles WHERE title LIKE '%(with Emilie%' LIMIT 1`)).rows[0].id;
    for (const id of [recent, older]) {
      const detail = (await request(app).get(`/api/v1/music/scrobbles/${id}`)).body;
      expect(detail.history.plays).toBe(8);
      expect(new Date(detail.history.first_played_at).getTime()).toBe(T0 * 1000);
      expect(new Date(detail.history.last_played_at).getTime()).toBe((T0 + 20 * DAY) * 1000);
    }
    // And "Show in library" (a filter on the title) finds that same row.
    expect((await library({ q: 'known you before' })).body.rows.find((r: any) => r.plays === 8)).toBeTruthy();
  });

  it('merges the album view across spellings too', async () => {
    await seedKnownYouBefore();
    const view = (await request(app).get('/api/v1/music/album-view').query({ ref: 'known you before|jason ross' })).body;
    const song = view.tracks.find((t: any) => t.title === 'Known You Before');
    // This album's plays of it (three Spotify plays carried no album), all spellings together.
    expect(song).toMatchObject({ plays: 5 });
    expect(view.tracks.filter((t: any) => t.title.startsWith('Known You Before')).length).toBe(1);
  });

  it('treats a near-identical play in another spelling as the same listen', async () => {
    await push('Known You Before (with Emilie Brandt)', ['Jason Ross'], 0);
    const res = await request(app)
      .post('/api/v1/music/scrobbles')
      .send({ title: 'Known You Before', artists: ['Jason Ross', 'Seven Lions'], played_at: new Date((T0 + 120) * 1000).toISOString() });
    expect(res.status).toBe(409);
    // ...and the other way round.
    await request(app).post('/api/v1/music/scrobbles').send({ title: 'Elsewhere', artists: ['X'], played_at: new Date((T0 + 9000) * 1000).toISOString() });
    await push('Elsewhere (feat. Y)', ['X'], 9060);
    expect((await query(`SELECT 1 FROM music_scrobbles WHERE title LIKE 'Elsewhere%'`)).rowCount).toBe(1);
  });

  it('lets a song on a list count every spelling of it', async () => {
    await seedKnownYouBefore();
    const list = (await request(app).post('/api/v1/music/lists').send({ name: 'Favs' })).body.id;
    const song_key = await keyOf('Known You Before');
    const added = await request(app).post(`/api/v1/music/lists/${list}/items`).send({ kind: 'song', song_key });
    expect(added.status).toBe(201);
    const items = (await request(app).get(`/api/v1/music/lists/${list}/items`)).body;
    expect(items[0]).toMatchObject({ kind: 'song', item_key: `song:${song_key}`, plays: 8 });
    // The spelling saved is the most recent one.
    expect(items[0].title).toBe('Known You Before');
  });

  it('re-keys a restored list item from the old backup format to the new identity', async () => {
    await seedKnownYouBefore();
    const { server } = await import('../../server');
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, {
      scrobbles: [],
      lists: [{ name: 'Old', items: [
        { kind: 'song', title: 'Known You Before (with Emilie Brandt)', artists: ['Jason Ross'], album: null, item_key: 'song:known you before (with emilie brandt)\u001fjason ross', album_ref: null, rank: 1 },
        { kind: 'song', title: 'Known You Before', artists: ['Jason Ross', 'Seven Lions'], album: null, item_key: 'song:known you before\u001fjason ross\u001fseven lions', album_ref: null, rank: 2 },
      ] }],
    });
    const items = (await request(app).get('/api/v1/music/lists')).body[0].items;
    expect(items).toHaveLength(1); // the two spellings are one song
    expect(items[0].item_key).toBe(`song:${await keyOf('Known You Before')}`);
  });

  describe('searching a big library', () => {
    beforeEach(async () => {
      // 1,500 songs by 30 artists, each played once, plus a favourite played 40 times.
      await query(
        `INSERT INTO music_scrobbles (user_id, played_at, title, artists, source, timezone)
         SELECT $1, to_timestamp($2::bigint + g * 60), 'Song ' || lpad(g::text, 4, '0'), ARRAY['Artist ' || (g % 30)], 'import', 'UTC'
         FROM generate_series(1, 1500) g`,
        [DEFAULT_USER_ID, T0],
      );
      await query(
        `INSERT INTO music_scrobbles (user_id, played_at, title, artists, source, timezone)
         SELECT $1, to_timestamp($2::bigint + 1000000 + g * 60), 'Favourite', ARRAY['Fav Artist'], 'import', 'UTC' FROM generate_series(1, 40) g`,
        [DEFAULT_USER_ID, T0],
      );
    });

    it('finds a song far beyond the most-played rows, and reports the total', async () => {
      const res = await library({ q: 'song 1337' });
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0]).toMatchObject({ name: 'Song 1337', plays: 1 });
      const all = await library({ limit: 10 });
      expect(all.body.total).toBe(1501);
      expect(all.body.rows).toHaveLength(10);
      expect(all.body.rows[0]).toMatchObject({ name: 'Favourite', plays: 40 });
    });

    it('searches artists and albums, ignoring case, and treats % and _ literally', async () => {
      expect((await library({ q: 'FAV ARTIST' })).body.rows.map((r: any) => r.name)).toEqual(['Favourite']);
      expect((await library({ q: 'artist 7' })).body.total).toBe(50); // "Artist 7" and "Artist 7x"? only 7: songs with g % 30 = 7
      expect((await library({ q: '%' })).body.total).toBe(0);
      expect((await library({ q: 'song_1337' })).body.total).toBe(0);
    });

    it('sorts and pages on the server', async () => {
      const first = await library({ sort: 'name', dir: 'asc', limit: 3 });
      expect(first.body.rows.map((r: any) => r.name)).toEqual(['Favourite', 'Song 0001', 'Song 0002']);
      const second = await library({ sort: 'name', dir: 'asc', limit: 3, offset: 3 });
      expect(second.body.rows.map((r: any) => r.name)).toEqual(['Song 0003', 'Song 0004', 'Song 0005']);
      const last = await library({ sort: 'name', dir: 'desc', limit: 1 });
      expect(last.body.rows[0].name).toBe('Song 1500');
      const byLast = await library({ sort: 'last', dir: 'desc', limit: 1 });
      expect(byLast.body.rows[0].name).toBe('Favourite');
      // An unknown sort falls back to plays; the page size is capped.
      expect((await library({ sort: 'bogus', limit: 1 })).body.rows[0].name).toBe('Favourite');
      expect((await library({ limit: 100000 })).body.rows).toHaveLength(500);
    });
  });
});
