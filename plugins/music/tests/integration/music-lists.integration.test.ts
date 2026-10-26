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
async function identities(title: string) {
  const r = await query(`SELECT ${songKeySql()} AS song_key, ${albumRefSql()} AS album_ref FROM music_scrobbles WHERE title = $1`, [title]);
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

  it('removes and reorders items, keeping unlisted ones in order at the end', async () => {
    for (const [i, t] of ['A', 'B', 'C', 'D'].entries()) await push(t, `Album ${t}`, ['X'], i * 60);
    const id = await newList();
    for (const t of ['A', 'B', 'C', 'D']) {
      const { album_ref } = await identities(t);
      await request(app).post(api(`/${id}/items`)).send({ kind: 'album', album_ref });
    }
    const titles = async () => (await request(app).get(api())).body[0].items.map((i: any) => i.title);
    expect(await titles()).toEqual(['Album A', 'Album B', 'Album C', 'Album D']);
    const ids = (await request(app).get(api())).body[0].items.map((i: any) => i.id) as string[];

    expect((await request(app).put(api(`/${id}/order`)).send({ item_ids: [ids[3], ids[1]] })).status).toBe(200);
    expect(await titles()).toEqual(['Album D', 'Album B', 'Album A', 'Album C']);
    expect((await request(app).put(api(`/${id}/order`)).send({ item_ids: ['nope'] })).status).toBe(400);

    expect((await request(app).delete(api(`/${id}/items/${ids[1]}`))).status).toBe(200);
    expect((await request(app).delete(api(`/${id}/items/${ids[1]}`))).status).toBe(404);
    expect(await titles()).toEqual(['Album D', 'Album A', 'Album C']);
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
});
