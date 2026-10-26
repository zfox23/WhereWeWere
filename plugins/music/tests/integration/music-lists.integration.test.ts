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
import { albumRefSql, songKeySql } from '../../services/identity';

const BASE = '/apis/mlj_1';
const T0 = 1714564800;
let key = '';

const push = (title: string, album: string | undefined, artists = ['Above & Beyond'], offset = 0) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: T0 + offset, key });
const api = (path = '') => `/api/v1/music/lists${path}`;

/** The opaque identities the server hands out, read the way the API does. */
async function identities(title: string, artist = 'Above & Beyond') {
  const r = await query(`SELECT ${songKeySql()} AS song_key, ${albumRefSql()} AS album_ref FROM music_scrobbles WHERE title = $1 AND artists[1] IN ($2, 'X', 'Some Artist')`, [title, artist]);
  return r.rows[0] as { song_key: string; album_ref: string };
}
const newList = async (name = 'Favorites') => (await request(app).post(api()).send({ name })).body.id as string;

describe('music lists', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterAll(teardownIntegrationDatabase);

  it('creates, renames and deletes lists, refusing blank and duplicate names', async () => {
    const created = await request(app).post(api()).send({ name: '  Favorites  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Favorites', items: [] });
    expect((await request(app).post(api()).send({ name: 'favorites' })).status).toBe(409);
    expect((await request(app).post(api()).send({ name: '   ' })).status).toBe(400);
    expect((await request(app).post(api()).send({ name: 'x'.repeat(101) })).status).toBe(400);

    const other = await newList('Road trip');
    expect((await request(app).put(api(`/${other}`)).send({ name: 'FAVORITES' })).status).toBe(409);
    expect((await request(app).put(api(`/${other}`)).send({ name: 'Long drives' })).body.name).toBe('Long drives');
    expect((await request(app).put(api('/00000000-0000-4000-8000-000000000000')).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).put(api('/nope')).send({ name: 'x' })).status).toBe(400);

    expect((await request(app).delete(api(`/${other}`))).status).toBe(200);
    expect((await request(app).delete(api(`/${other}`))).status).toBe(404);
    expect((await request(app).get(api())).body.map((l: any) => l.name)).toEqual(['Favorites']);
  });

  it('adds an album and a song from their opaque identities, once each', async () => {
    await push('Sun & Moon', 'Group Therapy');
    const id = await newList();
    const { song_key, album_ref } = await identities('Sun & Moon');

    expect((await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref })).status).toBe(201);
    expect((await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref })).status).toBe(200); // already there
    expect((await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key, album_ref })).status).toBe(201);

    const [list] = (await request(app).get(api())).body;
    expect(list.items.map((i: any) => [i.kind, i.title, i.artists, i.album, i.item_key])).toEqual([
      ['album', 'Group Therapy', ['Above & Beyond'], 'Group Therapy', `album:${album_ref}`],
      ['song', 'Sun & Moon', ['Above & Beyond'], 'Group Therapy', `song:${song_key}`],
    ]);
  });

  it('gives plays with no album an "Unknown album" per artist, and matches case and spacing', async () => {
    await push('Loose Single', undefined, ['Some Artist']);
    await push('LOOSE single', undefined, ['some artist'], 60); // the same song, differently written
    const id = await newList();
    const { song_key, album_ref } = await identities('Loose Single');
    expect(album_ref).toBe('|some artist');
    await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
    await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key, album_ref });
    const items = (await request(app).get(api())).body[0].items;
    expect(items.map((i: any) => [i.kind, i.title, i.album])).toEqual([
      ['album', 'Unknown album', null],
      ['song', 'LOOSE single', null], // latest spelling
    ]);
  });

  it('takes display fields from the plays, never the request, and refuses unplayed music', async () => {
    await push('Sun & Moon', 'Group Therapy');
    const id = await newList();
    const { song_key, album_ref } = await identities('Sun & Moon');
    const sneaky = await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key, album_ref, title: 'Injected', artists: ['Nobody'] });
    expect(sneaky.status).toBe(201);
    expect((await request(app).get(api())).body[0].items[0]).toMatchObject({ title: 'Sun & Moon', artists: ['Above & Beyond'] });

    for (const body of [
      { kind: 'album', album_ref: 'never played|nobody' },
      { kind: 'song', song_key: 'never played\u001fnobody' },
    ]) {
      expect((await request(app).post(api(`/${id}/items`)).send(body)).status).toBe(404);
    }
    expect((await request(app).post(api(`/${id}/items`)).send({ kind: 'playlist' })).status).toBe(400);
    expect((await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key: 'x'.repeat(2001) })).status).toBe(400);
    expect((await request(app).post(api('/00000000-0000-4000-8000-000000000000/items')).send({ kind: 'album', album_ref })).status).toBe(404);
  });

  it('keeps a song on the album it was added from, falling back to its latest album', async () => {
    await push('Shared Song', 'Studio Album');
    await push('Shared Song', 'Live Album', ['Above & Beyond'], 600);
    const id = await newList();
    const { song_key } = await identities('Shared Song');
    await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key, album_ref: 'studio album|above & beyond' });
    await request(app).delete(api(`/${id}/items/${(await request(app).get(api())).body[0].items[0].id}`));
    await request(app).post(api(`/${id}/items`)).send({ kind: 'song', song_key, album_ref: 'not an album of this song|x' });
    const items = (await request(app).get(api())).body[0].items;
    expect(items[0].album).toBe('Live Album'); // invalid context ignored: latest play wins
  });

  it('ranks items by drag order, leaving the rest unranked, and keeps ranks gap-free on removal', async () => {
    for (const [i, t] of ['A', 'B', 'C', 'D'].entries()) await push(t, `Album ${t}`, ['X'], i * 60);
    const id = await newList();
    for (const t of ['A', 'B', 'C', 'D']) {
      const { album_ref } = await identities(t);
      await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
    }
    const view = async () => (await request(app).get(api())).body[0].items.map((i: any) => [i.title, i.rank]);
    // New items arrive unranked, in the order added.
    expect(await view()).toEqual([['Album A', null], ['Album B', null], ['Album C', null], ['Album D', null]]);
    const ids = (await request(app).get(api())).body[0].items.map((i: any) => i.id) as string[];

    expect((await request(app).put(api(`/${id}/ranks`)).send({ ranked_ids: [ids[3], ids[1], ids[3]] })).status).toBe(200);
    expect(await view()).toEqual([['Album D', 1], ['Album B', 2], ['Album A', null], ['Album C', null]]);
    expect((await request(app).put(api(`/${id}/ranks`)).send({ ranked_ids: ['nope'] })).status).toBe(400);
    expect((await request(app).put(api('/00000000-0000-4000-8000-000000000000/ranks')).send({ ranked_ids: [] })).status).toBe(404);

    // An id from elsewhere is ignored and doesn't leave a hole.
    const other = await newList('Other');
    await request(app).post(api(`/${other}/items`)).send({ kind: 'album', album_ref: (await identities('A')).album_ref });
    const foreign = (await request(app).get(api())).body[1].items[0].id;
    await request(app).put(api(`/${id}/ranks`)).send({ ranked_ids: [foreign, ids[2], ids[0]] });
    expect(await view()).toEqual([['Album C', 1], ['Album A', 2], ['Album B', null], ['Album D', null]]);

    // Removing a ranked item closes the gap.
    expect((await request(app).delete(api(`/${id}/items/${ids[2]}`))).status).toBe(200);
    expect((await request(app).delete(api(`/${id}/items/${ids[2]}`))).status).toBe(404);
    expect(await view()).toEqual([['Album A', 1], ['Album B', null], ['Album D', null]]);
    // Clearing the ranking.
    await request(app).put(api(`/${id}/ranks`)).send({ ranked_ids: [] });
    expect((await view()).every(([, r]: any) => r === null)).toBe(true);
  });

  it('summarises lists for the index: count, updated time and up to four distinct covers', async () => {
    for (let i = 0; i < 6; i++) await push(`T${i}`, `Album ${i}`, ['X'], i * 60);
    const id = await newList();
    const before = (await request(app).get(api())).body[0];
    expect(before).toMatchObject({ item_count: 0, covers: [] });
    for (let i = 0; i < 6; i++) {
      const { album_ref } = await identities(`T${i}`);
      await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
      if (i < 5) {
        await query(`INSERT INTO music_albums (user_id, album_key, status, provider, external_id, thumb_file) VALUES ($1, $2, 'matched', 'deezer', $3, $4)`, [DEFAULT_USER_ID, album_ref, String(i), `deezer-${i}-thumb.jpg`]);
      }
    }
    await new Promise((r) => setTimeout(r, 15));
    const after = (await request(app).get(api())).body[0];
    expect(after.item_count).toBe(6);
    expect(after.covers).toHaveLength(4);
    expect(new Set(after.covers).size).toBe(4);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });

  it('gives each list item its all-time plays, listening time and last play', async () => {
    await push('Sun & Moon', 'Group Therapy');
    await push('Sun & Moon', 'Group Therapy', ['Above & Beyond'], 600);
    await push('Oceanic', 'Group Therapy', ['Above & Beyond'], 1200);
    await push('Sun & Moon', 'Other Album', ['Someone Else'], 1800); // same title, different artist: not the same song
    await request(app).post(`${BASE}/newscrobble`).send({ title: 'Oceanic', artists: ['Above & Beyond'], album: 'Group Therapy', time: T0 + 2400, length: 250, key });
    const id = await newList();
    const sun = await identities('Sun & Moon');
    await request(app).post(api(`/${id}/items`)).send({ kind: 'song', ...sun });
    await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref: sun.album_ref });
    const res = await request(app).get(api(`/${id}/items`));
    expect(res.status).toBe(200);
    const byKind = Object.fromEntries(res.body.map((i: any) => [i.kind, i]));
    expect(byKind.song).toMatchObject({ title: 'Sun & Moon', plays: 2, listened_seconds: 0 });
    expect(new Date(byKind.song.last_played_at).getTime()).toBe((T0 + 600) * 1000);
    expect(byKind.album).toMatchObject({ plays: 4, listened_seconds: 250 });
    expect((await request(app).get(api('/00000000-0000-4000-8000-000000000000/items'))).status).toBe(404);
    expect((await request(app).get(api('/nope/items'))).status).toBe(400);
  });

  it('shows a matched album\'s cover id on list items', async () => {
    await push('Sun & Moon', 'Group Therapy');
    const id = await newList();
    const { album_ref } = await identities('Sun & Moon');
    await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
    expect((await request(app).get(api())).body[0].items[0].art_id).toBeNull();
    await query(
      `INSERT INTO music_albums (user_id, album_key, status, provider, external_id, thumb_file) VALUES ($1, $2, 'matched', 'deezer', '1', 'deezer-1-thumb.jpg')`,
      [DEFAULT_USER_ID, album_ref],
    );
    const artId = (await query('SELECT id FROM music_albums')).rows[0].id;
    expect((await request(app).get(api())).body[0].items[0].art_id).toBe(artId);
  });

  it('is removed by Start Over along with its items', async () => {
    await push('Sun & Moon', 'Group Therapy');
    const id = await newList();
    const { album_ref } = await identities('Sun & Moon');
    await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
    const res = await request(app)
      .post('/api/v1/backup/start-over')
      .send({ first_confirmation: 'DELETE MY DATA', second_confirmation: 'START OVER', options: { delete_music_checkins: true } });
    expect(res.status).toBe(200);
    expect((await query('SELECT 1 FROM music_lists')).rowCount).toBe(0);
    expect((await query('SELECT 1 FROM music_list_items')).rowCount).toBe(0);
  });

  it('survives resetting the music settings', async () => {
    await push('Sun & Moon', 'Group Therapy');
    await newList();
    await request(app)
      .post('/api/v1/backup/start-over')
      .send({ first_confirmation: 'DELETE MY DATA', second_confirmation: 'START OVER', options: { reset_music_settings: true } });
    expect((await query('SELECT 1 FROM music_lists')).rowCount).toBe(1);
  });

  describe('in backups', () => {
  const seedLists = async () => {
    await push('Sun & Moon', 'Group Therapy');
    await push('Oceanic', 'Group Therapy', ['Above & Beyond'], 60);
    const fav = await newList('Favorites');
    const road = await newList('Road trip');
    const sun = await identities('Sun & Moon');
    const ocean = await identities('Oceanic');
    await request(app).post(api(`/${fav}/items`)).send({ kind: 'song', ...ocean });
    await request(app).post(api(`/${fav}/items`)).send({ kind: 'album', album_ref: sun.album_ref });
    await request(app).post(api(`/${fav}/items`)).send({ kind: 'song', ...sun });
    await request(app).post(api(`/${road}/items`)).send({ kind: 'album', album_ref: sun.album_ref });
  };
  const summary = async () =>
    (await request(app).get(api())).body.map((l: any) => [l.name, l.items.map((i: any) => `${i.kind}:${i.title}`)]);

  it('round-trips lists with their item order', async () => {
    const { server } = await import('../../server');
    await seedLists();
    const before = await summary();
    const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
    await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
    expect(await summary()).toEqual([]);
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect(await summary()).toEqual(before);
    expect(before[0]).toEqual(['Favorites', ['song:Oceanic', 'album:Group Therapy', 'song:Sun & Moon']]);
  });

  it('restores ranks for lists it creates, but leaves an existing list\'s ranking alone', async () => {
    const { server } = await import('../../server');
    await seedLists();
    const fav = (await request(app).get(api())).body[0];
    // Rank: Sun & Moon (song) first, then the album; Oceanic stays unranked.
    await request(app).put(api(`/${fav.id}/ranks`)).send({ ranked_ids: [fav.items[2].id, fav.items[1].id] });
    const ranks = async () => (await request(app).get(api())).body[0].items.map((i: any) => [i.title, i.rank]);
    const before = await ranks();
    expect(before).toEqual([['Sun & Moon', 1], ['Group Therapy', 2], ['Oceanic', null]]);
    const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
    await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect(await ranks()).toEqual(before);

    // Merging into a list that exists takes new items unranked and keeps its ranks.
    await request(app).put(api(`/${(await request(app).get(api())).body[0].id}/ranks`)).send({ ranked_ids: [] });
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect((await ranks()).every(([, r]: any) => r === null)).toBe(true);
  });

  it('merges into existing lists on a repeated restore instead of duplicating', async () => {
    const { server } = await import('../../server');
    await seedLists();
    const before = await summary();
    const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect(await summary()).toEqual(before);
  });

  it('skips malformed lists and items', async () => {
    const { server } = await import('../../server');
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, {
      scrobbles: [],
      lists: [
        null,
        { name: '   ', items: [] },
        { name: 'Good', items: [
          { kind: 'album', title: 'Ok', item_key: 'album:x|y', artists: ['y', 5] },
          { kind: 'album', title: 'Wrong key', item_key: 'song:x' },
          { kind: 'playlist', title: 'Bad kind', item_key: 'playlist:x' },
          { kind: 'song', item_key: 'song:nothing' },
        ] },
      ],
    });
    expect(await summary()).toEqual([['Good', ['album:Ok']]]);
  });

  it('restores lists through the HTTP backup path', async () => {
    await seedLists();
    const before = await summary();
    const zip = await new Promise<Buffer>((resolve, reject) => {
      request(app).get('/api/v1/backup/export').buffer(true)
        .parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
        .end((err: any, res: any) => (err ? reject(err) : resolve(res.body as Buffer)));
    });
    const { server } = await import('../../server');
    await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
    const res = await request(app).post('/api/v1/backup/import').attach('file', zip, 'backup.zip').set('Content-Type', 'application/zip');
    expect(res.status).toBe(200);
    expect(await summary()).toEqual(before);
  });
});
});
