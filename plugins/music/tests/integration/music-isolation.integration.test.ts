import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { getMusicSettings } from '../../services/scrobbles';
import { albumRefSql, songKeySql } from '../../services/identity';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z

describe('music: one user never sees or touches another user’s music', () => {
  let other: TestUser;
  let key = '';
  let manualId = '';
  let sessionId = '';
  let listId = '';
  let itemId = '';
  let albumRef = '';

  /** A request signed in as the other user. */
  const as = (r: request.Test) => r.set('Cookie', other.cookie);
  const scrobbleCount = async (userId: string) =>
    (await query('SELECT COUNT(*)::int AS n FROM music_scrobbles WHERE user_id = $1', [userId])).rows[0].n as number;

  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
    // The owner's music: two scrobbled plays, a hand entry with companions, a list.
    for (const [title, offset] of [['Sun & Moon', 0], ['Thing Called Love', 240]] as const) {
      await request(app).post(`${BASE}/newscrobble`).send({ title, artists: ['Above & Beyond'], album: 'Group Therapy', time: T0 + offset, key });
    }
    const manual = await request(app).post('/api/v1/music/scrobbles').send({
      title: 'Alone Tonight', artists: ['Above & Beyond'], album: 'Group Therapy', note: 'Private note',
      played_at: new Date((T0 + 480) * 1000).toISOString(), companions: ['Sam'],
    });
    expect(manual.status).toBe(201);
    manualId = manual.body.id;
    sessionId = manual.body.session_id;
    const ids = (await query(`SELECT ${songKeySql()} AS song_key, ${albumRefSql()} AS album_ref FROM music_scrobbles LIMIT 1`)).rows[0];
    albumRef = ids.album_ref;
    listId = (await request(app).post('/api/v1/music/lists').send({ name: 'Favorites' })).body.id;
    await request(app).post(`/api/v1/music/lists/${listId}/items`).send({ kind: 'album', album_ref: albumRef });
    itemId = (await query('SELECT id FROM music_list_items WHERE list_id = $1', [listId])).rows[0].id;
    await request(app).put(`/api/v1/music/lists/${listId}/rank-session`).send({ state: { mode: 'scratch', itemIds: [itemId], answers: [] } });
  });
  afterAll(teardownIntegrationDatabase);

  it('shows the other user none of it in settings, stats, library, reflection or suggestions', async () => {
    const settings = (await as(request(app).get('/api/v1/music/settings'))).body;
    expect(settings.scrobbles).toBe(0);
    expect(settings.scrobbler_key).not.toBe(key);

    const stats = (await as(request(app).get('/api/v1/music/stats'))).body;
    expect(stats.totals.scrobbles).toBe(0);
    expect(stats.top_songs).toEqual([]);
    for (const view of ['songs', 'artists', 'albums']) {
      const lib = (await as(request(app).get('/api/v1/music/library').query({ view, q: 'Beyond' }))).body;
      expect(lib.rows).toEqual([]);
    }
    expect((await as(request(app).get('/api/v1/music/reflect').query({ date: '2025-05-01' }))).body).toEqual([]);
    const suggest = (await as(request(app).get('/api/v1/music/suggest').query({ title: 'Sun' }))).body;
    expect(suggest.suggestions ?? []).toEqual([]);
    expect((await as(request(app).get('/api/v1/music/albums/status'))).body.albums.total).toBe(0);

    // ...while the owner still sees all of it.
    expect((await request(app).get('/api/v1/music/stats')).body.totals.scrobbles).toBe(3);
  });

  it("treats the owner's plays, sessions and albums as missing", async () => {
    expect((await as(request(app).get(`/api/v1/music/scrobbles/${manualId}`))).status).toBe(404);
    const edit = { title: 'Hijacked', artists: ['X'], played_at: new Date(T0 * 1000).toISOString(), companions: ['Mallory'] };
    expect((await as(request(app).put(`/api/v1/music/scrobbles/${manualId}`).send(edit))).status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/music/scrobbles/${manualId}`))).status).toBe(404);
    expect((await as(request(app).get(`/api/v1/music/sessions/${sessionId}/tracks`))).body).toEqual([]);
    expect((await as(request(app).get('/api/v1/music/album-view').query({ ref: albumRef }))).status).toBe(404);

    const mine = await request(app).get(`/api/v1/music/scrobbles/${manualId}`);
    expect(mine.body).toMatchObject({ title: 'Alone Tonight', note: 'Private note', companions: ['Sam'] });
    expect(await scrobbleCount(DEFAULT_USER_ID)).toBe(3);
  });

  it("can't read, change, rank or delete the owner's lists", async () => {
    expect((await as(request(app).get('/api/v1/music/lists'))).body).toEqual([]);
    expect((await as(request(app).get(`/api/v1/music/lists/${listId}/items`))).status).toBe(404);
    expect((await as(request(app).put(`/api/v1/music/lists/${listId}`).send({ name: 'Mine now' }))).status).toBe(404);
    expect((await as(request(app).post(`/api/v1/music/lists/${listId}/items`).send({ kind: 'album', album_ref: albumRef }))).status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/music/lists/${listId}/items/${itemId}`))).status).toBe(404);
    expect((await as(request(app).put(`/api/v1/music/lists/${listId}/ranks`).send({ ranked_ids: [itemId] }))).status).toBe(404);
    expect((await as(request(app).put(`/api/v1/music/lists/${listId}/items/${itemId}/rank`).send({ rank: 1 }))).status).toBe(404);
    expect((await as(request(app).get(`/api/v1/music/lists/${listId}/rank-session`))).status).toBe(404);
    expect((await as(request(app).put(`/api/v1/music/lists/${listId}/rank-session`).send({ state: { mode: 'scratch', itemIds: [itemId], answers: [] } }))).status).toBe(404);
    await as(request(app).delete(`/api/v1/music/lists/${listId}/rank-session`));
    expect((await as(request(app).delete(`/api/v1/music/lists/${listId}`))).status).toBe(404);

    const lists = (await request(app).get('/api/v1/music/lists')).body;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Favorites', item_count: 1 });
    expect(lists[0].items[0].rank).toBeNull();
    expect((await request(app).get(`/api/v1/music/lists/${listId}/rank-session`)).status).toBe(200);
  });

  it('only builds lists from the requesting user’s own plays', async () => {
    const res = await as(request(app).post('/api/v1/music/lists/from-items').send({ name: 'Copy', items: [{ kind: 'album', album_ref: albumRef }] }));
    expect(res.status).toBe(404);
    const own = await as(request(app).post('/api/v1/music/lists'))
      .send({ name: 'Mine' });
    expect((await as(request(app).post(`/api/v1/music/lists/${own.body.id}/items`).send({ kind: 'album', album_ref: albumRef }))).status).toBe(404);
  });

  it("keeps the owner's music off the other user's timeline", async () => {
    const feed = (await as(request(app).get('/api/v1/timeline'))).body as { type: string }[];
    expect(feed.filter((i) => i.type === 'music')).toEqual([]);
  });

  it("starts over only the user's own music", async () => {
    // The other user has music of their own, with a companion.
    const theirs = await as(request(app).post('/api/v1/music/scrobbles').send({
      title: 'Theirs', artists: ['Them'], played_at: new Date(T0 * 1000).toISOString(), companions: ['Pat'],
    }));
    expect(theirs.status).toBe(201);
    const { server } = await import('../../server');
    await runAsUser(other.id, () => server.deleteUserData!({ user_id: other.id }));

    expect(await scrobbleCount(other.id)).toBe(0);
    expect(await scrobbleCount(DEFAULT_USER_ID)).toBe(3);
    const companions = (await query(`SELECT name FROM companions WHERE checkin_type = 'music' ORDER BY name`)).rows;
    expect(companions).toEqual([{ name: 'Sam' }]);
    expect((await query('SELECT 1 FROM music_lists WHERE id = $1', [listId])).rowCount).toBe(1);
  });

  it("restores another user's backup as the restorer's own copy, leaving the original alone", async () => {
    const { server } = await import('../../server');
    const payload = await runAsUser(DEFAULT_USER_ID, () => server.backupExport!({ user_id: DEFAULT_USER_ID }));
    await runAsUser(other.id, () => server.backupImport!({ user_id: other.id }, payload));

    // The play ids in the backup are the owner's: those rows are skipped, never taken over.
    expect(await scrobbleCount(DEFAULT_USER_ID)).toBe(3);
    expect((await query('SELECT user_id FROM music_scrobbles WHERE id = $1', [manualId])).rows[0].user_id).toBe(DEFAULT_USER_ID);
    // Lists come across as the restorer's own.
    const theirLists = (await as(request(app).get('/api/v1/music/lists'))).body;
    expect(theirLists.map((l: any) => l.name)).toEqual(['Favorites']);
    expect(theirLists[0].id).not.toBe(listId);
    expect((await request(app).get('/api/v1/music/lists')).body).toHaveLength(1);
  });
});
