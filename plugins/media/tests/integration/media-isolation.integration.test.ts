import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../../../server/src/index';
import { pool, query } from '../../../../server/src/db';
import { exportPluginData, importPluginData } from '../../../../server/src/plugins/backup';
import { runAsUser } from '../../../../server/src/auth/context';
import { server } from '../../server';
import { executeYamtrackImport } from '../../../../server/src/routes/import-yamtrack';
import { parseYamtrackCsv, planYamtrackImport } from '../../../../server/src/services/yamtrack';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

/**
 * Media libraries are private: another account must see the default user's
 * items, check-ins and lists exactly as if they did not exist (404 / empty),
 * and must never be able to change them.
 */
describe('media isolation between users', () => {
  let other: TestUser;
  let itemId: string;
  let checkinId: string;
  let listId: string;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');

    // The default user's library: a TV show with a rated check-in, on a ranked
    // list with a paused ranking session.
    const item = await request(app).post('/api/v1/media/items').send({
      media_type: 'tv_show', title: 'Private Show', external_source: 'tmdb', external_id: '4242',
    });
    expect(item.status).toBe(201);
    itemId = item.body.id;
    const checkin = await request(app).post(`/api/v1/media/items/${itemId}/checkins`).send({
      checkin_type: 'completed', rating: 4, notes: 'secret note', timezone: 'UTC',
      checked_in_at: '2024-05-01T12:00:00Z',
    });
    expect(checkin.status).toBe(201);
    checkinId = checkin.body.id;
    const list = await request(app).post('/api/v1/media/lists').send({ name: 'Favorites' });
    listId = list.body.id;
    await request(app).post(`/api/v1/media/lists/${listId}/items`).send({ media_item_id: itemId });
    await request(app).put(`/api/v1/media/lists/${listId}/ranks`).send({ ranked_ids: [itemId] });
    const session = await request(app)
      .put(`/api/v1/media/lists/${listId}/rank-session`)
      .send({ state: rankSession() });
    expect(session.status).toBe(200);
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  const rankSession = () => ({ mode: 'scratch', initialRanks: {}, itemIds: [itemId], answers: [] });

  const as = (user: TestUser) => ({
    get: (url: string) => request(app).get(url).set('Cookie', user.cookie),
    post: (url: string) => request(app).post(url).set('Cookie', user.cookie),
    put: (url: string) => request(app).put(url).set('Cookie', user.cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', user.cookie),
  });

  async function defaultDataIntact() {
    const item = await query('SELECT title, rating FROM media_items WHERE id = $1', [itemId]);
    expect(item.rows).toEqual([{ title: 'Private Show', rating: null }]);
    const checkin = await query('SELECT rating, notes FROM media_checkins WHERE id = $1', [checkinId]);
    expect(checkin.rows).toEqual([{ rating: 4, notes: 'secret note' }]);
    const list = await query(
      `SELECT l.name, mli.media_item_id, mli.rank
       FROM media_lists l JOIN media_list_items mli ON mli.list_id = l.id WHERE l.id = $1`,
      [listId]
    );
    expect(list.rows).toEqual([{ name: 'Favorites', media_item_id: itemId, rank: 1 }]);
  }

  it('hides items, check-ins and stats from another user', async () => {
    const o = as(other);
    expect((await o.get(`/api/v1/media/items/${itemId}`)).status).toBe(404);
    expect((await o.get(`/api/v1/media/items/${itemId}/checkins`)).body).toEqual([]);
    expect((await o.get(`/api/v1/media/tv/${itemId}/seasons`)).status).toBe(404);
    expect((await o.post(`/api/v1/media/items/${itemId}/sync`).send({})).status).toBe(404);

    const library = await o.get('/api/v1/media/library');
    expect(library.body).toEqual({ total: 0, rows: [] });
    const dated = await o.get('/api/v1/media/library?from=2024-01-01&to=2024-12-31');
    expect(dated.body.total).toBe(0);

    const stats = await o.get('/api/v1/media/stats');
    expect(stats.body.tv_episodes_completed).toBe(0);
    expect(stats.body.top_media).toEqual([]);

    const search = await o.get('/api/v1/media/search?type=tv_show&q=Private');
    expect(search.body.results.filter((r: { source: string }) => r.source === 'local')).toEqual([]);

    // The owner still sees everything.
    const mine = await request(app).get('/api/v1/media/library');
    expect(mine.body.rows.map((r: { id: string }) => r.id)).toEqual([itemId]);
    const myStats = await request(app).get('/api/v1/media/stats');
    expect(myStats.body.tv_episodes_completed).toBe(1);
  });

  it('cannot change or delete another user\'s items and check-ins', async () => {
    const o = as(other);
    expect((await o.put(`/api/v1/media/items/${itemId}`).send({ title: 'Hijacked', rating: 1 })).status).toBe(404);
    expect((await o.post(`/api/v1/media/items/${itemId}/checkins`).send({ checkin_type: 'completed' })).status).toBe(404);
    expect((await o.put(`/api/v1/media/checkins/${checkinId}`).send({ rating: 1, notes: 'x' })).status).toBe(404);
    expect((await o.put(`/api/v1/media/checkins/${checkinId}`).send({})).status).toBe(404);
    expect((await o.delete(`/api/v1/media/checkins/${checkinId}`)).status).toBe(404);

    const dryRun = await o.post('/api/v1/media/items/bulk-delete').send({ ids: [itemId], dryRun: true });
    expect(dryRun.body).toEqual({ deleted_items: 0, deleted_checkins: 0, deleted_list_memberships: 0 });
    const real = await o.post('/api/v1/media/items/bulk-delete').send({ ids: [itemId] });
    expect(real.body).toEqual({ deleted_items: 0, deleted_checkins: 0, deleted_list_memberships: 0 });

    await defaultDataIntact();
  });

  it('keeps lists, list items and rankings private', async () => {
    const o = as(other);
    expect((await o.get('/api/v1/media/lists')).body).toEqual([]);
    expect((await o.get(`/api/v1/media/lists/${listId}/items`)).status).toBe(404);
    expect((await o.put(`/api/v1/media/lists/${listId}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await o.post(`/api/v1/media/lists/${listId}/items`).send({ media_item_id: itemId })).status).toBe(404);
    expect((await o.delete(`/api/v1/media/lists/${listId}/items/${itemId}`)).status).toBe(404);
    expect((await o.put(`/api/v1/media/lists/${listId}/ranks`).send({ ranked_ids: [] })).status).toBe(404);
    expect((await o.put(`/api/v1/media/lists/${listId}/items/${itemId}/rank`).send({ rank: null })).status).toBe(404);
    expect((await o.get(`/api/v1/media/lists/${listId}/rank-session`)).status).toBe(404);
    expect((await o.put(`/api/v1/media/lists/${listId}/rank-session`).send({ state: rankSession() })).status).toBe(404);
    await o.delete(`/api/v1/media/lists/${listId}/rank-session`);
    expect((await o.delete(`/api/v1/media/lists/${listId}`)).status).toBe(404);

    // Their own list can't take the default user's item either.
    const own = await o.post('/api/v1/media/lists').send({ name: 'Favorites' });
    expect(own.status).toBe(201);
    expect((await o.post(`/api/v1/media/lists/${own.body.id}/items`).send({ media_item_id: itemId })).status).toBe(404);

    // And the default user can't touch theirs.
    expect((await request(app).get(`/api/v1/media/lists/${own.body.id}/items`)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/media/lists/${own.body.id}`)).status).toBe(404);

    await defaultDataIntact();
    // The paused session survived the other user's delete attempt.
    expect((await request(app).get(`/api/v1/media/lists/${listId}/rank-session`)).status).toBe(200);
  });

  it('gives each user their own copy of the same provider item', async () => {
    const theirs = await as(other).post('/api/v1/media/items').send({
      media_type: 'tv_show', title: 'Private Show', external_source: 'tmdb', external_id: '4242',
    });
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(itemId);
    const owners = await query(
      `SELECT user_id FROM media_items WHERE external_id = '4242' ORDER BY user_id = $1 DESC`,
      [DEFAULT_USER_ID]
    );
    expect(owners.rows.map((r) => r.user_id)).toEqual([DEFAULT_USER_ID, other.id]);
  });

  it('imports Yamtrack rows into the signed-in user\'s library only', async () => {
    // The default user already has this movie; the import must not reuse it.
    const mine = await request(app).post('/api/v1/media/items').send({
      media_type: 'movie', title: 'Dune', external_source: 'tmdb', external_id: '550',
    });
    const csv = [
      'media_id,source,media_type,title,image,season_number,episode_number,score,status,notes,start_date,end_date,progress',
      '550,tmdb,movie,Dune,,,,8,Completed,,2024-01-01,2024-01-02,',
    ].join('\n');
    const outcome = await runAsUser(other.id, () => executeYamtrackImport(planYamtrackImport(parseYamtrackCsv(csv))));
    expect(outcome.imported_checkins).toBe(1);
    const ids = outcome.results.map((p) => p.media_item_id).filter(Boolean);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(mine.body.id);
    const owners = await query('SELECT DISTINCT user_id FROM media_items WHERE id = ANY($1::uuid[])', [ids]);
    expect(owners.rows).toEqual([{ user_id: other.id }]);
    const myCheckins = await query('SELECT COUNT(*)::int AS n FROM media_checkins WHERE media_item_id = $1', [mine.body.id]);
    expect(myCheckins.rows[0].n).toBe(0);

    // Same over HTTP: the route imports as the signed-in user.
    const res = await as(other).post('/api/v1/import/yamtrack/import').send({ csv: csv.replace('550,', '551,').replace(',Dune,', ',Arrival,') });
    expect(res.status).toBe(200);
    const arrival = await query(`SELECT user_id FROM media_items WHERE title = 'Arrival'`, []);
    expect(arrival.rows).toEqual([{ user_id: other.id }]);
    await defaultDataIntact();
  });

  it('restores a backup only into the restoring user, never attaching to someone else\'s rows', async () => {
    // A backup of the default user's media, restored by the other user (e.g. a
    // crafted or shared file): ids that already belong to the default user
    // are skipped, and nothing may point at the default user's item or list.
    const payload = await exportPluginData(DEFAULT_USER_ID);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runAsUser(other.id, () => importPluginData(client, other.id, { media: payload.media }));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const otherRows = await query(
      `SELECT (SELECT COUNT(*)::int FROM media_items WHERE user_id = $1) AS items,
              (SELECT COUNT(*)::int FROM media_checkins WHERE user_id = $1) AS checkins,
              (SELECT COUNT(*)::int FROM media_lists WHERE user_id = $1) AS lists`,
      [other.id]
    );
    expect(otherRows.rows[0]).toEqual({ items: 0, checkins: 0, lists: 0 });
    await defaultDataIntact();
    const counts = await query('SELECT COUNT(*)::int AS n FROM media_list_items', []);
    expect(counts.rows[0].n).toBe(1);
  });

  it('skips restored check-ins and list items whose parent belongs to another user', async () => {
    // A crafted backup: the other user's own new rows, pointing at the
    // default user's item and list. The stored user_id claims the default user.
    // `theirItem` is the other user's own item, so only the list guard can stop
    // it joining the default user's list; `unranked` sits on that list without
    // a rank, so only the ownership guard can stop the rank being set.
    const theirItem = (await as(other).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Theirs' })).body.id as string;
    const unranked = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Unranked' })).body.id as string;
    await request(app).post(`/api/v1/media/lists/${listId}/items`).send({ media_item_id: unranked });
    const crafted = {
      media: {
        checkins: [],
        extra: {
          mediaCheckins: [{
            id: '11111111-1111-4111-8111-111111111111', user_id: DEFAULT_USER_ID, media_item_id: itemId,
            season_number: null, episode_number: null, episode_title: null,
            checkin_type: 'completed', rating: 1, raw_score: null, notes: 'planted', time_played_minutes: null,
            checked_in_at: '2024-06-01T00:00:00Z', checkin_timezone: 'UTC', external_event_id: null,
            created_at: null, updated_at: null,
          }],
          mediaLists: [{
            id: '22222222-2222-4222-8222-222222222222', user_id: DEFAULT_USER_ID, name: 'Planted',
            created_at: null, updated_at: null,
          }],
          mediaListItems: [
            { list_id: listId, media_item_id: theirItem, position: 5, added_at: null },
            { list_id: '22222222-2222-4222-8222-222222222222', media_item_id: itemId, position: 0, added_at: null },
          ],
          mediaListRanks: [{ rank: 7, list_id: listId, media_item_id: unranked }],
        },
      },
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runAsUser(other.id, () => importPluginData(client, other.id, crafted as never));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    expect((await query(`SELECT 1 FROM media_checkins WHERE notes = 'planted'`, [])).rows).toHaveLength(0);
    // The list itself is the other user's own row (the stored user_id is ignored).
    const planted = await query(`SELECT user_id FROM media_lists WHERE name = 'Planted'`, []);
    expect(planted.rows).toEqual([{ user_id: other.id }]);
    expect((await query(
      `SELECT 1 FROM media_list_items WHERE list_id = '22222222-2222-4222-8222-222222222222'`, []
    )).rows).toHaveLength(0);
    const favorites = await query(
      'SELECT media_item_id, rank FROM media_list_items WHERE list_id = $1 ORDER BY rank NULLS LAST', [listId]
    );
    expect(favorites.rows).toEqual([{ media_item_id: itemId, rank: 1 }, { media_item_id: unranked, rank: null }]);
  });

  it('applies legacy (pre-plugin) restores with the same guards', async () => {
    const theirItem = (await as(other).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Theirs' })).body.id as string;
    const counts = await runAsUser(other.id, () => server.restoreLegacyBackup!({ user_id: other.id }, {
      mediaCheckins: [{
        id: '33333333-3333-4333-8333-333333333333', user_id: DEFAULT_USER_ID, media_item_id: itemId,
        checkin_type: 'completed', notes: 'planted', checked_in_at: '2024-06-01T00:00:00Z',
      }],
      mediaListItems: [{ list_id: listId, media_item_id: theirItem, position: 9 }],
    }));
    expect(counts).toMatchObject({
      mediaCheckins: { inserted: 0, skipped: 1 },
      mediaListItems: { inserted: 0, skipped: 1 },
    });
    await defaultDataIntact();
  });

  it('exports and starts over only the user\'s own media', async () => {
    const exported = await exportPluginData(other.id);
    const media = exported.media as { checkins: unknown[]; extra?: Record<string, unknown[]> };
    expect(media.checkins).toEqual([]);
    for (const rows of Object.values(media.extra ?? {})) expect(rows).toEqual([]);

    await runAsUser(other.id, () => server.deleteUserData!({ user_id: other.id }));
    await defaultDataIntact();
  });

  it('only relabels the signed-in user\'s check-ins during timestamp reconciliation', async () => {
    const applied = await runAsUser(other.id, () => server.reconcile!.apply!(checkinId, 'Europe/Lisbon'));
    expect(applied).toBe(false);
    const tz = await query('SELECT checkin_timezone FROM media_checkins WHERE id = $1', [checkinId]);
    expect(tz.rows[0].checkin_timezone).toBe('UTC');
  });

  it('uses each user\'s own provider API keys', async () => {
    await request(app).put('/api/v1/plugins/media/settings').send({ tmdb_api_key: 'default-key' });
    const theirs = await as(other).get('/api/v1/plugins/media/settings');
    expect(theirs.body.tmdb_api_key ?? null).toBeNull();
    // Without a key of their own, the other user's provider search is degraded
    // rather than borrowing the default user's key.
    const search = await as(other).get('/api/v1/media/search?type=movie&q=Dune');
    expect(search.body.degraded).toBe(true);
  });
});
