import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { findBestVenueMatch } from '../../services/venueMerge';

const app = createApp();

async function insertVenue(name: string, lat: number, lng: number, extra: { parent?: string | null } = {}) {
  const r = await query(
    `INSERT INTO venues (name, latitude, longitude, parent_venue_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, lat, lng, extra.parent ?? null]
  );
  return r.rows[0].id as string;
}

async function insertCheckin(venueId: string, at: string, tz = 'America/New_York') {
  const r = await query(
    `INSERT INTO checkins (user_id, venue_id, checked_in_at, checkin_timezone)
     VALUES ($1, $2, $3::timestamptz, $4) RETURNING id`,
    [DEFAULT_USER_ID, venueId, at, tz]
  );
  return r.rows[0].id as string;
}

describe('Location plugin API (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('GET /venues/nearby', () => {
    it('does not error when queried at a venue’s exact coordinates (acos clamp)', async () => {
      await insertVenue('Exact Spot', 37.7749295, -122.4194155);
      const res = await request(app)
        .get('/api/v1/venues/nearby')
        .query({ lat: '37.7749295', lon: '-122.4194155', source: 'local', radius: '100' });
      expect(res.status).toBe(200);
      expect(res.body.map((v: { name: string }) => v.name)).toContain('Exact Spot');
    });

    it('falls back to the default radius for a non-numeric radius and excludes far venues', async () => {
      await insertVenue('Near', 40.0, -100.0);
      await insertVenue('Far', 41.0, -100.0); // ~111 km away
      const res = await request(app)
        .get('/api/v1/venues/nearby')
        .query({ lat: '40.0', lon: '-100.0', source: 'local', radius: 'abc' });
      expect(res.status).toBe(200);
      const names = res.body.map((v: { name: string }) => v.name);
      expect(names).toContain('Near');
      expect(names).not.toContain('Far');
    });
  });

  describe('findBestVenueMatch', () => {
    it('matches a same-named venue within the radius and ignores distant ones', async () => {
      const id = await insertVenue('Blue Bottle Coffee', 37.7749, -122.4194);
      await insertVenue('Blue Bottle Coffee', 34.05, -118.25); // other city

      const hit = await findBestVenueMatch({ name: 'Blue Bottle Coffee', latitude: 37.77492, longitude: -122.41941 });
      expect(hit?.id).toBe(id);

      const miss = await findBestVenueMatch({ name: 'Blue Bottle Coffee', latitude: 51.5, longitude: -0.12 });
      expect(miss).toBeNull();
    });
  });

  describe('POST /location-checkins', () => {
    it('rejects a missing venue_id without leaving the pool unusable', async () => {
      const bad = await request(app).post('/api/v1/location-checkins').send({ user_id: DEFAULT_USER_ID });
      expect(bad.status).toBe(400);

      const venueId = await insertVenue('After Bad Request', 10, 10);
      const good = await request(app)
        .post('/api/v1/location-checkins')
        .send({ user_id: DEFAULT_USER_ID, venue_id: venueId });
      expect(good.status).toBe(201);
      const count = await query('SELECT COUNT(*)::int AS n FROM checkins');
      expect(count.rows[0].n).toBe(1);
    });

    it('clears notes when the client sends null', async () => {
      const venueId = await insertVenue('Notes Venue', 10, 10);
      const created = await request(app)
        .post('/api/v1/location-checkins')
        .send({ user_id: DEFAULT_USER_ID, venue_id: venueId, notes: 'remember this' });
      const id = created.body.id as string;
      const cleared = await request(app).put(`/api/v1/location-checkins/${id}`).send({ notes: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.notes).toBeNull();
    });
  });

  describe('check-in list ranks', () => {
    it('inserting at an occupied rank shifts the others without a unique-index error', async () => {
      const venueId = await insertVenue('Ranked', 10, 10);
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push(await insertCheckin(venueId, `2024-01-0${i + 1}T12:00:00Z`));

      const list = await request(app).post('/api/v1/location-checkins/lists').send({ name: 'Top' });
      expect(list.status).toBe(201);
      const listId = list.body.id as string;
      for (const id of ids) {
        await query('INSERT INTO checkin_list_items (list_id, checkin_id) VALUES ($1, $2)', [listId, id]);
      }
      for (let i = 0; i < 3; i++) {
        const r = await request(app)
          .put(`/api/v1/location-checkins/lists/${listId}/items/${ids[i]}/rank`)
          .send({ rank: i + 1 });
        expect(r.status).toBe(200);
      }

      // Put the 4th item at rank 1: ranks 1..3 must shift to 2..4.
      const move = await request(app)
        .put(`/api/v1/location-checkins/lists/${listId}/items/${ids[3]}/rank`)
        .send({ rank: 1 });
      expect(move.status).toBe(200);

      const ranks = await query(
        'SELECT checkin_id, rank FROM checkin_list_items WHERE list_id = $1 ORDER BY rank',
        [listId]
      );
      expect(ranks.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
      expect(ranks.rows[0].checkin_id).toBe(ids[3]);

      // Clearing a rank renumbers the ones below it down.
      const clear = await request(app)
        .put(`/api/v1/location-checkins/lists/${listId}/items/${ids[3]}/rank`)
        .send({ rank: null });
      expect(clear.status).toBe(200);
      const after = await query(
        'SELECT rank FROM checkin_list_items WHERE list_id = $1 AND rank IS NOT NULL ORDER BY rank',
        [listId]
      );
      expect(after.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    });

    it('lists with no items return an empty array, not [{id:null}]', async () => {
      await request(app).post('/api/v1/venues/lists').send({ name: 'Empty venue list' });
      const res = await request(app).get('/api/v1/venues/lists');
      expect(res.status).toBe(200);
      expect(res.body[0].items).toEqual([]);
    });
  });

  describe('POST /venues/:id/merge-into', () => {
    it('moves check-ins, list memberships and children in one go', async () => {
      const source = await insertVenue('Source', 10, 10);
      const target = await insertVenue('Target', 10.0001, 10.0001);
      const child = await insertVenue('Child of source', 10, 10, { parent: source });
      await insertCheckin(source, '2024-01-01T12:00:00Z');
      const list = await request(app).post('/api/v1/venues/lists').send({ name: 'Faves' });
      await query('INSERT INTO venue_list_items (list_id, venue_id) VALUES ($1, $2)', [list.body.id, source]);

      const res = await request(app).post(`/api/v1/venues/${source}/merge-into`).send({ target_id: target });
      expect(res.status).toBe(200);

      expect((await query('SELECT COUNT(*)::int AS n FROM venues WHERE id = $1', [source])).rows[0].n).toBe(0);
      expect((await query('SELECT venue_id FROM checkins')).rows[0].venue_id).toBe(target);
      expect((await query('SELECT parent_venue_id FROM venues WHERE id = $1', [child])).rows[0].parent_venue_id).toBe(target);
      expect((await query('SELECT venue_id FROM venue_list_items')).rows.map((r) => r.venue_id)).toEqual([target]);
    });

    it('keeps list rank when merging a ranked venue into another', async () => {
      const source = await insertVenue('Source', 10, 10);
      const target = await insertVenue('Target', 10.0001, 10.0001);
      const list = await request(app).post('/api/v1/venues/lists').send({ name: 'Ranked' });
      await query('INSERT INTO venue_list_items (list_id, venue_id, rank) VALUES ($1, $2, 1)', [list.body.id, source]);

      const res = await request(app).post(`/api/v1/venues/${source}/merge-into`).send({ target_id: target });
      expect(res.status).toBe(200);
      const rows = (await query('SELECT venue_id, rank FROM venue_list_items')).rows;
      expect(rows).toEqual([{ venue_id: target, rank: 1 }]);
    });

    it('merging a parent into its own child does not make the child its own parent', async () => {
      const parent = await insertVenue('Airport', 10, 10);
      const childVenue = await insertVenue('Terminal', 10.0001, 10.0001, { parent });
      const res = await request(app).post(`/api/v1/venues/${parent}/merge-into`).send({ target_id: childVenue });
      expect(res.status).toBe(200);
      const row = await query('SELECT parent_venue_id FROM venues WHERE id = $1', [childVenue]);
      expect(row.rows[0].parent_venue_id).toBeNull();
    });
  });

  describe('stats', () => {
    it('returns the longest gap as plain YYYY-MM-DD dates', async () => {
      const venueId = await insertVenue('Gap', 10, 10);
      await insertCheckin(venueId, '2023-01-10T12:00:00Z', 'UTC');
      await insertCheckin(venueId, '2023-01-12T12:00:00Z', 'UTC');
      await insertCheckin(venueId, '2024-03-01T12:00:00Z', 'UTC');
      const res = await request(app)
        .get('/api/v1/location-checkins/stats/additional-stats')
        .query({ user_id: DEFAULT_USER_ID });
      expect(res.status).toBe(200);
      expect(res.body.longest_gap).toEqual({ days: 414, start: '2023-01-12', end: '2024-03-01' });
    });

    it('monthly and map-data expose dates as YYYY-MM-DD strings', async () => {
      const venueId = await insertVenue('Dates', 10, 10);
      await insertCheckin(venueId, '2024-05-03T02:30:00Z', 'America/New_York'); // local May 2nd
      const monthly = await request(app)
        .get('/api/v1/location-checkins/stats/monthly')
        .query({ user_id: DEFAULT_USER_ID, year: '2024', month: '5' });
      expect(monthly.body).toEqual([{ date: '2024-05-02', count: 1 }]);
      const map = await request(app)
        .get('/api/v1/location-checkins/stats/map-data')
        .query({ user_id: DEFAULT_USER_ID });
      expect(map.body[0].dates).toEqual(['2024-05-02']);
    });
  });

  describe('GET /location-checkins paging', () => {
    it('clamps a bad limit/offset instead of 500ing', async () => {
      const venueId = await insertVenue('Paging', 10, 10);
      await insertCheckin(venueId, '2024-01-01T12:00:00Z');
      const res = await request(app).get('/api/v1/location-checkins').query({ limit: 'abc', offset: '-5' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('timeline filters for unlabelled venues', () => {
    it("maps the stats lists' 'Uncategorized' / 'Unknown' labels back to NULL", async () => {
      const cat = await query(`INSERT INTO venue_categories (name) VALUES ('Cafe') RETURNING id`);
      const plain = await insertVenue('No Category', 10, 10);
      const cafe = await insertVenue('A Cafe', 11, 11);
      await query('UPDATE venues SET category_id = $1, country = $2 WHERE id = $3', [cat.rows[0].id, 'France', cafe]);
      await insertCheckin(plain, '2024-01-01T12:00:00Z', 'UTC');
      await insertCheckin(cafe, '2024-01-02T12:00:00Z', 'UTC');

      const uncategorized = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, category: 'Uncategorized' });
      expect(uncategorized.body.map((r: { venue_name: string }) => r.venue_name)).toEqual(['No Category']);

      const unknown = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, country: 'Unknown' });
      expect(unknown.body.map((r: { venue_name: string }) => r.venue_name)).toEqual(['No Category']);
    });
  });

  describe('unified timeline paging', () => {
    it('pages across plugin branches in order without duplicates or gaps', async () => {
      const venueId = await insertVenue('Timeline', 10, 10);
      for (let i = 1; i <= 4; i++) await insertCheckin(venueId, `2024-02-0${i}T12:00:00Z`, 'UTC');
      for (let i = 1; i <= 3; i++) {
        await query(
          `INSERT INTO mood_checkins (user_id, mood, checked_in_at, mood_timezone)
           VALUES ($1, 3, $2::timestamptz, 'UTC')`,
          [DEFAULT_USER_ID, `2024-02-0${i}T18:00:00Z`]
        );
      }

      const all = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID, limit: '100' });
      expect(all.status).toBe(200);
      expect(all.body).toHaveLength(7);

      const seen: string[] = [];
      for (const offset of [0, 3, 6]) {
        const page = await request(app)
          .get('/api/v1/timeline')
          .query({ user_id: DEFAULT_USER_ID, limit: '3', offset: String(offset) });
        expect(page.status).toBe(200);
        seen.push(...page.body.map((r: { id: string }) => r.id));
      }
      expect(seen).toEqual(all.body.map((r: { id: string }) => r.id));
      expect(new Set(seen).size).toBe(7);

      const times = all.body.map((r: { checked_in_at: string }) => new Date(r.checked_in_at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('tolerates a junk limit and caps a huge one', async () => {
      const junk = await request(app).get('/api/v1/timeline').query({ limit: 'abc', offset: 'xyz' });
      expect(junk.status).toBe(200);
      const huge = await request(app).get('/api/v1/timeline').query({ limit: '99999999' });
      expect(huge.status).toBe(200);
    });
  });

  describe('Swarm CSV import', () => {
    it('keeps shouts with quoted newlines, sets the check-in timezone, and removes the upload', async () => {
      const csv = [
        'id,venue.name,venue.id,lat,lng,createdAt,shout',
        'sw1,Cafe Uno,v1,40.7128,-74.0060,2024-05-03T14:00:00Z,"great coffee',
        'and a long chat"',
        'sw2,Cafe Dos,v2,34.0522,-118.2437,2024-05-04T14:00:00Z,',
        '',
      ].join('\n');
      const res = await request(app).post('/api/v1/import/swarm').attach('files', Buffer.from(csv), 'swarm.csv');
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      const rows = await query('SELECT notes, checkin_timezone, swarm_id FROM checkins ORDER BY swarm_id');
      expect(rows.rows[0].notes).toBe('great coffee\nand a long chat');
      expect(rows.rows[0].checkin_timezone).toBe('America/New_York');
      expect(rows.rows[1].checkin_timezone).toBe('America/Los_Angeles');
    });
  });

  describe('input validation', () => {

  it('rejects a malformed user_id with 400 instead of a Postgres 500', async () => {
    const res = await request(app).get('/api/v1/location-checkins/stats/summary').query({ user_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user_id/);
  });

  it('ignores an empty venue_id filter', async () => {
    const res = await request(app).get('/api/v1/location-checkins').query({ venue_id: '' });
    expect(res.status).toBe(200);
  });

  it('answers a bad year with 400', async () => {
    const res = await request(app)
      .get('/api/v1/location-checkins/stats/heatmap')
      .query({ user_id: DEFAULT_USER_ID, year: 'abc' });
    expect(res.status).toBe(400);
  });

  it('treats % and _ in search text literally', async () => {
    await request(app).post('/api/v1/companions/names').send({ name: 'Ada' });
    await request(app).post('/api/v1/companions/names').send({ name: '100%_Real' });
    const all = await request(app).get('/api/v1/companions/names').query({ q: '%' });
    expect(all.status).toBe(200);
    expect(all.body).toEqual(['100%_Real']);
  });

  it('ignores a non-numeric filter on a generic numeric field instead of failing the timeline', async () => {
    const res = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID, rating: 'abc' });
    expect(res.status).toBe(200);
  });
});
});
