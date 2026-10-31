/**
 * Multi-user isolation for the location plugin. Venues and categories are a
 * catalog every user shares; check-ins, counts, lists, Coasterpedia lookups,
 * weather, backups and start-over are each user's own.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { query, pool } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { server } from '../../server';

const app = createApp();

async function insertVenue(name: string, categoryId: string | null = null) {
  const r = await query(
    `INSERT INTO venues (name, latitude, longitude, category_id) VALUES ($1, 40.7128, -74.006, $2) RETURNING id`,
    [name, categoryId]
  );
  return r.rows[0].id as string;
}

/** Create a check-in through the API as `cookie` (the default user when omitted). */
async function checkIn(venueId: string, notes: string, cookie?: string, extra: Record<string, unknown> = {}) {
  const req = request(app).post('/api/v1/location-checkins');
  if (cookie) req.set('Cookie', cookie);
  const res = await req.send({ venue_id: venueId, notes, checked_in_at: '2024-05-03T14:00:00Z', ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function checkinOwner(id: string) {
  const r = await query('SELECT user_id, venue_id, notes FROM checkins WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

describe('Location plugin: multi-user isolation (integration)', () => {
  let other: TestUser;
  let venue: string;
  let mine1: string;
  let mine2: string;
  let theirs: string;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
    // One shared venue both users visit: the default user twice, other once.
    venue = await insertVenue('Shared Cafe');
    mine1 = await checkIn(venue, 'zebra espresso');
    mine2 = await checkIn(venue, 'second visit');
    theirs = await checkIn(venue, 'their own visit', other.cookie);
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('check-ins', () => {
    it('lists only the caller\'s check-ins, ignoring a user_id parameter', async () => {
      const mine = await request(app).get('/api/v1/location-checkins');
      expect(mine.body.map((c: any) => c.id).sort()).toEqual([mine1, mine2].sort());

      const spoofed = await request(app)
        .get('/api/v1/location-checkins')
        .set('Cookie', other.cookie)
        .query({ user_id: DEFAULT_USER_ID, venue_id: venue });
      expect(spoofed.body.map((c: any) => c.id)).toEqual([theirs]);
    });

    it('treats another user\'s check-in as missing for read, update and delete', async () => {
      const get = await request(app).get(`/api/v1/location-checkins/${mine1}`).set('Cookie', other.cookie);
      expect(get.status).toBe(404);

      const put = await request(app)
        .put(`/api/v1/location-checkins/${mine1}`)
        .set('Cookie', other.cookie)
        .send({ notes: 'hijacked', rating: 1 });
      expect(put.status).toBe(404);

      const del = await request(app).delete(`/api/v1/location-checkins/${mine1}`).set('Cookie', other.cookie);
      expect(del.status).toBe(404);

      expect(await checkinOwner(mine1)).toMatchObject({ user_id: DEFAULT_USER_ID, notes: 'zebra espresso' });
    });

    it('owns a new check-in by the session, not a user_id in the body', async () => {
      const id = await checkIn(venue, 'spoof attempt', other.cookie, { user_id: DEFAULT_USER_ID });
      expect((await checkinOwner(id)).user_id).toBe(other.id);
    });

    it('scopes stats, search and the venue page to the caller', async () => {
      const summary = await request(app)
        .get('/api/v1/location-checkins/stats/summary')
        .set('Cookie', other.cookie)
        .query({ user_id: DEFAULT_USER_ID });
      expect(summary.status).toBe(200);
      expect(summary.body.total_checkins).toBe(1);

      const top = await request(app).get('/api/v1/location-checkins/stats/top-venues').set('Cookie', other.cookie);
      expect(top.body).toEqual([expect.objectContaining({ venue_id: venue, checkin_count: 1 })]);

      const search = await request(app)
        .get('/api/v1/search')
        .set('Cookie', other.cookie)
        .query({ q: 'zebra', type: 'checkins' });
      expect(search.body).toEqual([]);
      const ownSearch = await request(app).get('/api/v1/search').query({ q: 'zebra', type: 'checkins' });
      expect(ownSearch.body.map((c: any) => c.id)).toEqual([mine1]);

      // A venue-name match must not bypass the user filter either.
      const byVenue = await request(app)
        .get('/api/v1/search')
        .set('Cookie', other.cookie)
        .query({ q: 'Shared Cafe', type: 'checkins' });
      expect(byVenue.body.map((c: any) => c.id)).toEqual([theirs]);

      // The shared venue is visible to both, each with their own count.
      const minePage = await request(app).get(`/api/v1/venues/${venue}`);
      const theirPage = await request(app).get(`/api/v1/venues/${venue}`).set('Cookie', other.cookie);
      expect(minePage.body.checkin_count).toBe(2);
      expect(theirPage.body.checkin_count).toBe(1);

      const library = await request(app).get('/api/v1/venues/library').set('Cookie', other.cookie);
      expect(library.body.rows).toEqual([expect.objectContaining({ id: venue, checkin_count: 1 })]);
    });
  });

  describe('lists', () => {
    it('keeps venue lists private', async () => {
      const list = await request(app).post('/api/v1/venues/lists').send({ name: 'Favorites' });
      await request(app).post(`/api/v1/venues/lists/${list.body.id}/items`).send({ venue_id: venue });

      const theirLists = await request(app).get('/api/v1/venues/lists').set('Cookie', other.cookie);
      expect(theirLists.body).toEqual([]);

      const items = await request(app).get(`/api/v1/venues/lists/${list.body.id}/items`).set('Cookie', other.cookie);
      expect(items.status).toBe(404);
      const add = await request(app)
        .post(`/api/v1/venues/lists/${list.body.id}/items`)
        .set('Cookie', other.cookie)
        .send({ venue_id: venue });
      expect(add.status).toBe(404);
      const rank = await request(app)
        .put(`/api/v1/venues/lists/${list.body.id}/ranks`)
        .set('Cookie', other.cookie)
        .send({ ranked_ids: [venue] });
      expect(rank.status).toBe(404);
      const del = await request(app).delete(`/api/v1/venues/lists/${list.body.id}`).set('Cookie', other.cookie);
      expect(del.status).toBe(404);

      const mine = await request(app).get(`/api/v1/venues/lists/${list.body.id}/items`);
      expect(mine.body).toEqual([expect.objectContaining({ venue_id: venue, rank: null, checkin_count: 2 })]);
    });

    it('never lets another user\'s check-in into a check-in list', async () => {
      const theirList = await request(app)
        .post('/api/v1/location-checkins/lists')
        .set('Cookie', other.cookie)
        .send({ name: 'Concerts' });
      const steal = await request(app)
        .post(`/api/v1/location-checkins/lists/${theirList.body.id}/items`)
        .set('Cookie', other.cookie)
        .send({ checkin_id: mine1 });
      expect(steal.status).toBe(404);

      // Nor via a check-in save naming someone else's list.
      const myList = await request(app).post('/api/v1/location-checkins/lists').send({ name: 'Mine' });
      await request(app)
        .put(`/api/v1/location-checkins/${theirs}`)
        .set('Cookie', other.cookie)
        .send({ list_ids: [myList.body.id] });
      const myItems = await request(app).get(`/api/v1/location-checkins/lists/${myList.body.id}/items`);
      expect(myItems.body).toEqual([]);
    });
  });

  describe('shared venue catalog', () => {
    it('merging re-points every user\'s check-ins and list entries', async () => {
      const target = await insertVenue('Shared Cafe (dup)');
      const theirList = await request(app)
        .post('/api/v1/venues/lists')
        .set('Cookie', other.cookie)
        .send({ name: 'Theirs' });
      await request(app)
        .post(`/api/v1/venues/lists/${theirList.body.id}/items`)
        .set('Cookie', other.cookie)
        .send({ venue_id: venue });

      const res = await request(app).post(`/api/v1/venues/${venue}/merge-into`).send({ target_id: target });
      expect(res.status).toBe(200);
      // The response count is the caller's own.
      expect(res.body.checkin_count).toBe(2);

      for (const id of [mine1, mine2, theirs]) expect((await checkinOwner(id)).venue_id).toBe(target);
      expect((await checkinOwner(theirs)).user_id).toBe(other.id);
      const items = await request(app)
        .get(`/api/v1/venues/lists/${theirList.body.id}/items`)
        .set('Cookie', other.cookie);
      expect(items.body).toEqual([expect.objectContaining({ venue_id: target, checkin_count: 1 })]);
    });

    it('deletes a venue only when no user references it', async () => {
      const theirsOnly = await insertVenue('Their Place');
      await checkIn(theirsOnly, 'only them', other.cookie);
      const del1 = await request(app).delete(`/api/v1/venues/${theirsOnly}`);
      expect(del1.status).toBe(409);
      expect(del1.body.error).not.toMatch(/check-in/i);

      const listed = await insertVenue('On Their List');
      const list = await request(app).post('/api/v1/venues/lists').set('Cookie', other.cookie).send({ name: 'L' });
      await request(app)
        .post(`/api/v1/venues/lists/${list.body.id}/items`)
        .set('Cookie', other.cookie)
        .send({ venue_id: listed });
      expect((await request(app).delete(`/api/v1/venues/${listed}`)).status).toBe(409);

      const unused = await insertVenue('Nobody');
      expect((await request(app).delete(`/api/v1/venues/${unused}`)).status).toBe(200);
      const remaining = await query('SELECT id FROM venues WHERE id = ANY($1::uuid[])', [[theirsOnly, listed, unused]]);
      expect(remaining.rows.map((r) => r.id).sort()).toEqual([theirsOnly, listed].sort());
    });
  });

  describe('venue ratings', () => {
    it('keeps each user\'s rating of a shared venue their own', async () => {
      expect((await request(app).put(`/api/v1/venues/${venue}`).send({ rating: 4 })).body.rating).toBe(4);
      const put = await request(app).put(`/api/v1/venues/${venue}`).set('Cookie', other.cookie).send({ rating: 1 });
      expect(put.body.rating).toBe(1);

      const mine = await request(app).get(`/api/v1/venues/${venue}`);
      const theirs = await request(app).get(`/api/v1/venues/${venue}`).set('Cookie', other.cookie);
      expect(mine.body.rating).toBe(4);
      expect(theirs.body.rating).toBe(1);

      const list = await request(app).get('/api/v1/venues').query({ search: 'Shared Cafe' }).set('Cookie', other.cookie);
      expect(list.body).toEqual([expect.objectContaining({ id: venue, rating: 1 })]);
      const lib = await request(app).get('/api/v1/venues/library').query({ sort: 'rating' });
      expect(lib.body.rows).toEqual([expect.objectContaining({ id: venue, rating: 4 })]);

      // Clearing mine leaves theirs; the shared column is never written.
      await request(app).put(`/api/v1/venues/${venue}`).send({ rating: null });
      expect((await request(app).get(`/api/v1/venues/${venue}`)).body.rating).toBeNull();
      expect((await request(app).get(`/api/v1/venues/${venue}`).set('Cookie', other.cookie)).body.rating).toBe(1);
      expect((await query('SELECT rating FROM venues WHERE id = $1', [venue])).rows[0].rating).toBeNull();
    });

    it('merging carries each user\'s rating over unless they already rated the target', async () => {
      const target = await insertVenue('Shared Cafe (dup)');
      await request(app).put(`/api/v1/venues/${venue}`).send({ rating: 2 });
      await request(app).put(`/api/v1/venues/${target}`).send({ rating: 3 });
      await request(app).put(`/api/v1/venues/${venue}`).set('Cookie', other.cookie).send({ rating: 4 });

      await request(app).post(`/api/v1/venues/${venue}/merge-into`).send({ target_id: target });
      expect((await request(app).get(`/api/v1/venues/${target}`)).body.rating).toBe(3);
      expect((await request(app).get(`/api/v1/venues/${target}`).set('Cookie', other.cookie)).body.rating).toBe(4);
    });

    it('backs ratings up and restores them as the restoring user\'s own', async () => {
      await request(app).put(`/api/v1/venues/${venue}`).send({ rating: 4 });
      const exported: any = await server.backupExport!({ user_id: other.id } as any);
      expect(exported.venues).toEqual([expect.objectContaining({ id: venue, rating: null })]);
      const mineExported: any = await server.backupExport!({ user_id: DEFAULT_USER_ID } as any);
      expect(mineExported.venues).toEqual([expect.objectContaining({ id: venue, rating: 4 })]);

      // An (old-style) backup carrying rating on the venue row restores as the caller's rating.
      await runAsUser(other.id, () =>
        server.backupImport!({ user_id: other.id } as any, { venues: [{ id: venue, name: 'Shared Cafe', rating: 2 }] })
      );
      expect((await request(app).get(`/api/v1/venues/${venue}`).set('Cookie', other.cookie)).body.rating).toBe(2);
      expect((await request(app).get(`/api/v1/venues/${venue}`)).body.rating).toBe(4);
    });
  });

  describe('Coasterpedia and weather', () => {
    it('keeps one Coasterpedia record per user for the same ride', async () => {
      const cat = await query(`INSERT INTO venue_categories (name) VALUES ('Amusement Ride') RETURNING id`);
      const ride = await insertVenue('Batman The Ride', cat.rows[0].id);
      await query(
        `INSERT INTO venue_coasterpedia (venue_id, user_id, status, attraction_id, data)
         VALUES ($1, $2, 'matched', 165, '{"name":"Batman The Ride"}'::jsonb),
                ($1, $3, 'ambiguous', NULL, NULL)`,
        [ride, DEFAULT_USER_ID, other.id]
      );
      const mine = await request(app).get(`/api/v1/venues/${ride}`);
      expect(mine.body.coasterpedia).toMatchObject({ status: 'matched', attraction_id: 165 });
      const theirs = await request(app).get(`/api/v1/venues/${ride}`).set('Cookie', other.cookie);
      expect(theirs.body.coasterpedia).toMatchObject({ has_key: false, status: 'ambiguous', attraction_id: null });

      // Start-over by the other user removes only their record.
      await runAsUser(other.id, () => server.deleteAllData!({ user_id: other.id } as any));
      const left = await query('SELECT user_id FROM venue_coasterpedia WHERE venue_id = $1', [ride]);
      expect(left.rows).toEqual([{ user_id: DEFAULT_USER_ID }]);
    });

    it('keeps daily weather private', async () => {
      await query(
        `INSERT INTO daily_weather (user_id, local_date, status, latitude, longitude, timezone, data)
         VALUES ($1, '2024-05-03', 'ok', 40.7128, -74.006, 'America/New_York', '{"temp_max":20}'::jsonb)`,
        [DEFAULT_USER_ID]
      );
      await query(
        `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
         VALUES ($1, 'location', 'weather_enabled', 'true'::jsonb)`,
        [other.id]
      );
      const list = await request(app).get('/api/v1/weather').set('Cookie', other.cookie).query({ dates: '2024-05-03' });
      expect(list.body).toEqual({ enabled: true, days: {} });
      const day = await request(app).get('/api/v1/weather/2024-05-03').set('Cookie', other.cookie);
      expect(day.status).toBe(404);
    });
  });

  describe('Swarm import', () => {
    it('dedupes per user: two users can import the same Swarm check-in', async () => {
      const csv = 'id,venue.name,venue.id,lat,lng,createdAt,shout\nsw1,Cafe Uno,v1,40.7128,-74.0060,2024-05-03T14:00:00Z,hi\n';
      const first = await request(app).post('/api/v1/import/swarm').attach('files', Buffer.from(csv), 'a.csv');
      expect(first.body.imported).toBe(1);
      const again = await request(app).post('/api/v1/import/swarm').attach('files', Buffer.from(csv), 'a.csv');
      expect(again.body).toMatchObject({ imported: 0, skipped: 1 });
      const theirs = await request(app)
        .post('/api/v1/import/swarm')
        .set('Cookie', other.cookie)
        .attach('files', Buffer.from(csv), 'a.csv');
      expect(theirs.body.imported).toBe(1);
      const rows = await query(`SELECT user_id FROM checkins WHERE swarm_id = 'sw1' ORDER BY user_id`);
      expect(rows.rows.map((r) => r.user_id).sort()).toEqual([DEFAULT_USER_ID, other.id].sort());
    });
  });

  describe('backup and start-over', () => {
    it('exports only the user\'s own check-ins and the venues they reference', async () => {
      await insertVenue('Unrelated Venue');
      const payload: any = await server.backupExport!({ user_id: other.id } as any);
      expect(payload.checkins.map((c: any) => c.id)).toEqual([theirs]);
      expect(payload.venues.map((v: any) => v.id)).toEqual([venue]);
    });

    it('restores into the caller only, never overwriting shared venues or touching others\' rows', async () => {
      const myList = await request(app).post('/api/v1/location-checkins/lists').send({ name: 'Mine' });
      const fresh = '00000000-0000-4000-8000-00000000c0de';
      const newVenue = '00000000-0000-4000-8000-00000000beef';
      const payload = {
        venues: [
          // An existing shared venue: must not be renamed.
          { id: venue, name: 'Renamed By Restore', latitude: 1, longitude: 1 },
          { id: newVenue, name: 'Brand New', latitude: 1, longitude: 1, parent_venue_id: venue },
        ],
        checkins: [
          // The default user's check-in id: skipped, not stolen.
          { id: mine1, venue_id: venue, notes: 'stolen?', user_id: other.id },
          { id: fresh, venue_id: newVenue, notes: 'restored', user_id: DEFAULT_USER_ID },
        ],
        checkinLists: [{ id: myList.body.id, name: 'Hijack' }],
        checkinListItems: [
          // Neither another user's list nor another user's check-in may be linked.
          { list_id: myList.body.id, checkin_id: fresh },
          { list_id: myList.body.id, checkin_id: mine1 },
        ],
        checkinCompanions: [{ checkin_id: mine1, name: 'Mallory' }],
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await runAsUser(other.id, () =>
          server.backupImport!({ user_id: other.id, client } as any, payload)
        );
        await client.query('COMMIT');
        expect(inserted).toBe(1);
      } finally {
        client.release();
      }

      expect((await query('SELECT name FROM venues WHERE id = $1', [venue])).rows[0].name).toBe('Shared Cafe');
      expect((await query('SELECT parent_venue_id FROM venues WHERE id = $1', [newVenue])).rows[0].parent_venue_id).toBe(venue);
      expect(await checkinOwner(mine1)).toMatchObject({ user_id: DEFAULT_USER_ID, notes: 'zebra espresso' });
      expect(await checkinOwner(fresh)).toMatchObject({ user_id: other.id, notes: 'restored' });
      const listRow = await query('SELECT user_id, name FROM checkin_lists WHERE id = $1', [myList.body.id]);
      expect(listRow.rows[0]).toEqual({ user_id: DEFAULT_USER_ID, name: 'Mine' });
      expect((await query('SELECT * FROM checkin_list_items WHERE list_id = $1', [myList.body.id])).rows).toEqual([]);
      expect((await query(`SELECT * FROM companions WHERE checkin_id = $1`, [mine1])).rows).toEqual([]);
    });

    it('start-over by one user leaves the other\'s data and the shared venue intact', async () => {
      const myList = await request(app).post('/api/v1/venues/lists').send({ name: 'Mine' });
      await request(app).post(`/api/v1/venues/lists/${myList.body.id}/items`).send({ venue_id: venue });
      const theirList = await request(app).post('/api/v1/venues/lists').set('Cookie', other.cookie).send({ name: 'Theirs' });
      await request(app)
        .post(`/api/v1/venues/lists/${theirList.body.id}/items`)
        .set('Cookie', other.cookie)
        .send({ venue_id: venue });
      for (const userId of [DEFAULT_USER_ID, other.id]) {
        await query(
          `INSERT INTO daily_weather (user_id, local_date, status) VALUES ($1, '2024-05-03', 'ok')`,
          [userId]
        );
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await runAsUser(other.id, async () => {
          await server.deleteUserData!({ user_id: other.id, client } as any);
          await server.deleteAllData!({ user_id: other.id, client } as any);
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      expect(await checkinOwner(theirs)).toBeNull();
      expect((await query('SELECT id FROM venue_lists WHERE user_id = $1', [other.id])).rows).toEqual([]);
      expect((await query('SELECT 1 FROM daily_weather WHERE user_id = $1', [other.id])).rows).toEqual([]);

      // The default user's data and the shared venue survive.
      expect((await checkinOwner(mine1)).user_id).toBe(DEFAULT_USER_ID);
      expect((await checkinOwner(mine2)).user_id).toBe(DEFAULT_USER_ID);
      expect((await query('SELECT id FROM venues WHERE id = $1', [venue])).rows).toHaveLength(1);
      const items = await request(app).get(`/api/v1/venues/lists/${myList.body.id}/items`);
      expect(items.body).toEqual([expect.objectContaining({ venue_id: venue, checkin_count: 2 })]);
      expect((await query('SELECT 1 FROM daily_weather WHERE user_id = $1', [DEFAULT_USER_ID])).rows).toHaveLength(1);
    });
  });
});
