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
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

const play = async (iso: string, title: string, artists: string[], userId = DEFAULT_USER_ID) =>
  (
    await query(
      `INSERT INTO music_scrobbles (user_id, played_at, title, artists, timezone) VALUES ($1, $2, $3, $4, 'UTC') RETURNING id`,
      [userId, iso, title, artists],
    )
  ).rows[0].id as string;

const category = async (name: string) =>
  (await query(`INSERT INTO venue_categories (name) VALUES ($1) RETURNING id`, [name])).rows[0].id as string;

const checkin = async (categoryId: string, iso: string, userId = DEFAULT_USER_ID) => {
  const venue = await query(`INSERT INTO venues (name, latitude, longitude, category_id) VALUES ('V', 1, 1, $1) RETURNING id`, [categoryId]);
  return (
    await query(`INSERT INTO checkins (user_id, venue_id, checked_in_at) VALUES ($1, $2, $3) RETURNING id`, [userId, venue.rows[0].id, iso])
  ).rows[0].id as string;
};

const life = (by: string, params: Record<string, string> = {}, user?: TestUser) => {
  const r = request(app).get('/api/v1/music/insights/life').query({ by, ...params });
  return user ? r.set('Cookie', user.cookie) : r;
};

describe('music: soundtrack of your life', () => {
  let gym = '';
  let cafe = '';

  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    gym = await category('Life Test Gym');
    cafe = await category('Life Test Cafe');
    // Around a 10:00 gym check-in (gap 30 min): 09:40 and 10:25 count, 10:45 doesn't.
    await play('2024-05-01T09:40:00Z', 'Pump', ['A']);
    await play('2024-05-01T10:25:00Z', 'Lift', ['A']);
    await play('2024-05-01T10:45:00Z', 'Cooldown', ['B']);
    // Around a 14:00 café check-in.
    await play('2024-05-01T14:05:00Z', 'Latte', ['A', 'C']);
  });
  afterAll(teardownIntegrationDatabase);

  it('groups the plays around each kind of place, with lift against the whole period', async () => {
    await checkin(gym, '2024-05-01T10:00:00Z');
    await checkin(cafe, '2024-05-01T14:00:00Z');
    const res = await life('place');
    expect(res.status).toBe(200);
    expect(res.body.gap_minutes).toBe(30);
    const [g, c] = res.body.groups;
    expect(g).toMatchObject({ key: gym, label: 'Life Test Gym', plays: 2, checkins: 1 });
    // A: both gym plays, 3 of 4 plays overall -> (2/2) / (3/4).
    expect(g.top_artists).toEqual([{ name: 'A', plays: 2, lift: 1.33 }]);
    expect(g.top_songs.map((s: any) => s.name).sort()).toEqual(['Lift', 'Pump']);
    expect(c).toMatchObject({ label: 'Life Test Cafe', plays: 1 });
    expect(c.top_artists.map((a: any) => a.name)).toEqual(['A', 'C']);
  });

  it('counts a play near two check-ins of one group once', async () => {
    await checkin(gym, '2024-05-01T10:00:00Z');
    await checkin(gym, '2024-05-01T10:10:00Z');
    const res = await life('place');
    expect(res.body.groups[0]).toMatchObject({ key: gym, plays: 2, checkins: 2 });
  });

  it('keeps to the period', async () => {
    await checkin(gym, '2024-05-01T10:00:00Z');
    expect((await life('place', { from: '2024-05-02', to: '2024-05-31' })).body.groups).toEqual([]);
    expect((await life('place', { from: '2024-05-01', to: '2024-05-01' })).body.groups).toHaveLength(1);
  });

  it('groups by mood level', async () => {
    await query(`INSERT INTO mood_checkins (user_id, mood, checked_in_at) VALUES ($1, 5, '2024-05-01T10:00:00Z')`, [DEFAULT_USER_ID]);
    const res = await life('mood');
    expect(res.body.groups).toEqual([expect.objectContaining({ key: '5', plays: 2, checkins: 1 })]);
  });

  it('groups by companion, from the user\'s own check-ins only', async () => {
    const mine = await checkin(cafe, '2024-05-01T14:00:00Z');
    await query(`INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, 'location', $2, 'Sam')`, [DEFAULT_USER_ID, mine]);
    // Someone else's check-in at the gym time, with a companion: never counts for this user.
    const other = await createTestUser('other');
    const theirs = await checkin(gym, '2024-05-01T10:00:00Z', other.id);
    await query(`INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, 'location', $2, 'Eve')`, [other.id, theirs]);
    // A hand-entered play's companion anchors at the play itself.
    const manual = await play('2024-05-01T20:00:00Z', 'Campfire', ['D']);
    await query(`INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, 'music', $2, 'Sam')`, [DEFAULT_USER_ID, manual]);

    const res = await life('companion');
    expect(res.body.groups).toEqual([expect.objectContaining({ key: 'Sam', plays: 2, checkins: 2 })]);
    // And the other user sees none of this user's plays near their own companion.
    expect((await life('companion', {}, other)).body.groups).toEqual([]);
  });

  it('is empty without check-ins, and rejects an unknown grouping', async () => {
    expect((await life('mood')).body.groups).toEqual([]);
    expect((await life('weather')).status).toBe(400);
  });
});
