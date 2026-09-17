import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { query, pool } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { exportPluginData, importPluginData, deletePluginData } from '../../../../server/src/plugins/backup';

describe('Mood plugin API', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  const app = createApp();

  async function createActivityGroup(name: string) {
    const res = await request(app).post('/api/v1/mood-checkins/activities/groups').send({ name });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function createActivity(groupId: string, name: string) {
    const res = await request(app).post('/api/v1/mood-checkins/activities/activities').send({ group_id: groupId, name });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  describe('manifest', () => {
    it('is registered with its filter params and fields', async () => {
      const res = await request(app).get('/api/v1/plugins/mood');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('mood');
      expect(res.body.filterParams).toEqual(['mood', 'activity']);
      expect(res.body.fields.map((f: any) => f.name)).toEqual(['mood', 'note', 'activity_ids']);
    });

    it('rejects generic check-in CRUD (custom storage owns its routes)', async () => {
      const res = await request(app).post('/api/v1/plugins/mood/checkins').send({ data: { mood: 3 } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('custom storage');
    });
  });

  describe('check-in CRUD', () => {
    it('rejects moods outside 1..5', async () => {
      for (const mood of [0, 6]) {
        const res = await request(app).post('/api/v1/mood-checkins').send({ mood });
        expect(res.status).toBe(400);
      }
    });

    it('creates a check-in with linked activities and lists it back', async () => {
      const groupId = await createActivityGroup('Health');
      const gymId = await createActivity(groupId, 'Gym');

      const created = await request(app)
        .post('/api/v1/mood-checkins')
        .send({
          mood: 4,
          note: 'felt great',
          checked_in_at: '2026-03-10T12:00:00Z',
          mood_timezone: 'Europe/Lisbon',
          activity_ids: [gymId],
        });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const list = await request(app).get('/api/v1/mood-checkins').query({ user_id: DEFAULT_USER_ID });
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].mood).toBe(4);
      expect(list.body[0].activities).toEqual([
        expect.objectContaining({ id: gymId, name: 'Gym', group_name: 'Health' }),
      ]);

      const get = await request(app).get(`/api/v1/mood-checkins/${id}`);
      expect(get.status).toBe(200);
      expect(get.body.mood_timezone).toBe('Europe/Lisbon');
    });

    it('replaces activities on update and 404s for unknown ids', async () => {
      const groupId = await createActivityGroup('Hobbies');
      const a1 = await createActivity(groupId, 'Reading');
      const a2 = await createActivity(groupId, 'Music');

      const created = await request(app)
        .post('/api/v1/mood-checkins')
        .send({ mood: 3, activity_ids: [a1] });
      const id = created.body.id as string;

      // Swap the single activity for a different one.
      const updated = await request(app).put(`/api/v1/mood-checkins/${id}`).send({ activity_ids: [a2] });
      expect(updated.status).toBe(200);
      const fetched = await request(app).get(`/api/v1/mood-checkins/${id}`);
      expect(fetched.body.activities.map((a: any) => a.id)).toEqual([a2]);

      // Clear them.
      const cleared = await request(app).put(`/api/v1/mood-checkins/${id}`).send({ activity_ids: [] });
      expect(cleared.status).toBe(200);
      const afterClear = await request(app).get(`/api/v1/mood-checkins/${id}`);
      expect(afterClear.body.activities).toEqual([]);

      // A well-formed but unknown id is a 404. (A malformed, non-UUID id is a
      // Postgres type error -> 500; that matches the pre-refactor behavior.)
      const unknownId = '00000000-0000-0000-0000-000000000042';
      expect((await request(app).get(`/api/v1/mood-checkins/${unknownId}`)).status).toBe(404);
      expect((await request(app).put(`/api/v1/mood-checkins/${unknownId}`).send({ mood: 5 })).status).toBe(404);
      expect((await request(app).delete(`/api/v1/mood-checkins/${unknownId}`)).status).toBe(404);
    });

    it('deletes a check-in', async () => {
      const created = await request(app).post('/api/v1/mood-checkins').send({ mood: 2 });
      const id = created.body.id as string;
      const del = await request(app).delete(`/api/v1/mood-checkins/${id}`);
      expect(del.status).toBe(200);
      const list = await request(app).get('/api/v1/mood-checkins').query({ user_id: DEFAULT_USER_ID });
      expect(list.body).toHaveLength(0);
    });
  });

  describe('activity groups', () => {
    it('requires a name and 404s for unknown groups', async () => {
      expect((await request(app).post('/api/v1/mood-checkins/activities/groups').send({})).status).toBe(400);
      // Well-formed but unknown UUID -> 404 (a non-UUID id is a Postgres type
      // error -> 500, matching the pre-refactor behavior).
      const unknownId = '00000000-0000-0000-0000-000000000042';
      expect((await request(app).delete(`/api/v1/mood-checkins/activities/groups/${unknownId}`)).status).toBe(404);
    });

    it('lists groups with nested activities and deletes them (cascading)', async () => {
      const g1 = await createActivityGroup('A');
      const g2 = await createActivityGroup('B');
      const act = await createActivity(g1, 'Walking');

      const list = await request(app).get('/api/v1/mood-checkins/activities/groups');
      expect(list.status).toBe(200);
      expect(list.body.map((g: any) => g.name)).toEqual(['A', 'B']);
      const groupA = list.body.find((g: any) => g.id === g1);
      expect(groupA.activities).toHaveLength(1);
      expect(groupA.activities[0].name).toBe('Walking');

      const del = await request(app).delete(`/api/v1/mood-checkins/activities/groups/${g1}`);
      expect(del.status).toBe(200);
      const remaining = await query('SELECT id FROM mood_activities WHERE id = $1', [act]);
      expect(remaining.rowCount).toBe(0);
    });

    it('reorders activities and rejects invalid reorder payloads', async () => {
      const g = await createActivityGroup('Reorder');
      const a = await createActivity(g, 'One');
      const b = await createActivity(g, 'Two');

      const ok = await request(app)
        .put('/api/v1/mood-checkins/activities/activities/reorder')
        .send({ group_id: g, activity_ids: [b, a] });
      expect(ok.status).toBe(200);
      const list = await request(app).get('/api/v1/mood-checkins/activities/groups');
      const group = list.body.find((x: any) => x.id === g);
      expect(group.activities.map((x: any) => x.name)).toEqual(['Two', 'One']);

      // Missing an activity.
      expect(
        (await request(app)
          .put('/api/v1/mood-checkins/activities/activities/reorder')
          .send({ group_id: g, activity_ids: [a] })).status
      ).toBe(400);
      // Duplicate id.
      expect(
        (await request(app)
          .put('/api/v1/mood-checkins/activities/activities/reorder')
          .send({ group_id: g, activity_ids: [a, a] })).status
      ).toBe(400);
      // Unknown id.
      expect(
        (await request(app)
          .put('/api/v1/mood-checkins/activities/activities/reorder')
          .send({ group_id: g, activity_ids: [a, 'not-a-uuid', b] })).status
      ).toBe(400);
    });
  });

  describe('stats', () => {
    it('requires user_id', async () => {
      expect((await request(app).get('/api/v1/mood-checkins/stats/daily')).status).toBe(400);
      expect((await request(app).get('/api/v1/mood-checkins/stats/monthly')).status).toBe(400);
    });

    it('computes daily, day-of-week, and count-range stats', async () => {
      await query(
        `INSERT INTO mood_checkins (user_id, mood, checked_in_at, mood_timezone)
         VALUES ($1, 4, '2026-03-10T12:00:00Z', 'UTC'),
                ($1, 2, '2026-03-10T18:00:00Z', 'UTC'),
                ($1, 5, '2026-03-11T09:00:00Z', 'UTC')`,
        [DEFAULT_USER_ID]
      );

      const daily = await request(app).get('/api/v1/mood-checkins/stats/daily').query({ user_id: DEFAULT_USER_ID });
      expect(daily.status).toBe(200);
      expect(daily.body).toEqual([
        { date: '2026-03-10', avg_mood: 3, min_mood: 2, max_mood: 4, count: 2 },
        { date: '2026-03-11', avg_mood: 5, min_mood: 5, max_mood: 5, count: 1 },
      ]);

      const dow = await request(app).get('/api/v1/mood-checkins/stats/by-day-of-week').query({ user_id: DEFAULT_USER_ID });
      expect(dow.body).toHaveLength(7);
      // 2026-03-10 is a Tuesday; 2026-03-11 is a Wednesday.
      const tuesday = dow.body.find((d: any) => d.day === 'Tuesday');
      expect(tuesday.count).toBe(2);
      expect(tuesday.avg_mood).toBe(3);
      const wednesday = dow.body.find((d: any) => d.day === 'Wednesday');
      expect(wednesday.count).toBe(1);
      expect(wednesday.avg_mood).toBe(5);

      const counts = await request(app).get('/api/v1/mood-checkins/stats/count-range').query({ user_id: DEFAULT_USER_ID });
      expect(counts.body).toEqual([
        { mood: 1, count: 0 },
        { mood: 2, count: 1 },
        { mood: 3, count: 0 },
        { mood: 4, count: 1 },
        { mood: 5, count: 1 },
      ]);
    });

    it('respects the date range on daily stats', async () => {
      await query(
        `INSERT INTO mood_checkins (user_id, mood, checked_in_at, mood_timezone)
         VALUES ($1, 4, '2026-03-10T12:00:00Z', 'UTC'),
                ($1, 4, '2026-03-20T12:00:00Z', 'UTC')`,
        [DEFAULT_USER_ID]
      );
      const res = await request(app)
        .get('/api/v1/mood-checkins/stats/daily')
        .query({ user_id: DEFAULT_USER_ID, from: '2026-03-15', to: '2026-03-31' });
      expect(res.body).toHaveLength(1);
      expect(res.body[0].date).toBe('2026-03-20');
    });
  });

  describe('unified timeline', () => {
    it('emits mood rows with the full envelope and honors mood/activity filters', async () => {
      const groupId = await createActivityGroup('Health');
      const gymId = await createActivity(groupId, 'Gym');
      const withActivity = await request(app)
        .post('/api/v1/mood-checkins')
        .send({ mood: 5, checked_in_at: '2026-03-10T12:00:00Z', mood_timezone: 'UTC', activity_ids: [gymId] });
      await request(app)
        .post('/api/v1/mood-checkins')
        .send({ mood: 2, checked_in_at: '2026-03-11T12:00:00Z', mood_timezone: 'UTC' });

      const all = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID });
      expect(all.status).toBe(200);
      const moodRows = all.body.filter((row: any) => row.type === 'mood');
      expect(moodRows).toHaveLength(2);
      const top = moodRows.find((r: any) => r.id === withActivity.body.id);
      expect(top.mood).toBe(5);
      expect(top.timezone).toBe('UTC');
      expect(top.data).toMatchObject({ mood: 5 });
      expect(top.activities).toHaveLength(1);

      const byMood = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID, mood: '5' });
      expect(byMood.body).toHaveLength(1);
      expect(byMood.body[0].id).toBe(withActivity.body.id);

      const byActivity = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID, activity: 'gym' });
      expect(byActivity.body).toHaveLength(1);
      expect(byActivity.body[0].id).toBe(withActivity.body.id);
    });
  });

  describe('backup round-trip', () => {
    it('survives export -> wipe -> import with groups, activities, and links intact', async () => {
      const groupId = await createActivityGroup('Health');
      const gymId = await createActivity(groupId, 'Gym');
      const created = await request(app)
        .post('/api/v1/mood-checkins')
        .send({
          mood: 4,
          note: 'backup me',
          checked_in_at: '2026-03-10T12:00:00Z',
          mood_timezone: 'Europe/Lisbon',
          activity_ids: [gymId],
        });
      const checkinId = created.body.id as string;

      const payload = await exportPluginData(DEFAULT_USER_ID);
      expect(payload.mood.checkins).toHaveLength(1);
      expect(payload.mood.extra!.moodActivityGroups).toHaveLength(1);
      expect(payload.mood.extra!.moodActivities).toHaveLength(1);
      expect(payload.mood.extra!.moodCheckinActivities).toHaveLength(1);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM mood_checkin_activities');
        await client.query('DELETE FROM mood_checkins');
        await client.query('DELETE FROM mood_activities');
        await client.query('DELETE FROM mood_activity_groups');
        const counts = await importPluginData(client, DEFAULT_USER_ID, { mood: payload.mood });
        expect(counts.mood.inserted).toBeGreaterThanOrEqual(3);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const restored = await request(app).get(`/api/v1/mood-checkins/${checkinId}`);
      expect(restored.status).toBe(200);
      expect(restored.body.note).toBe('backup me');
      expect(restored.body.mood_timezone).toBe('Europe/Lisbon');
      expect(restored.body.activities).toEqual([
        expect.objectContaining({ name: 'Gym', group_name: 'Health' }),
      ]);
    });

    it('start-over deletes check-ins (and their links); resetSettings wipes activity groups', async () => {
      const groupId = await createActivityGroup('Health');
      const gymId = await createActivity(groupId, 'Gym');
      await request(app)
        .post('/api/v1/mood-checkins')
        .send({ mood: 4, activity_ids: [gymId] });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const counts = await deletePluginData(client, DEFAULT_USER_ID, ['mood']);
        await client.query('COMMIT');
        expect(counts.mood).toBe(1); // 1 check-in + 0 plugin_settings rows
      } finally {
        client.release();
      }

      const afterWipe = await query(
        `SELECT (SELECT COUNT(*) FROM mood_checkins) AS c,
                (SELECT COUNT(*) FROM mood_checkin_activities) AS j`,
      );
      expect(Number(afterWipe.rows[0].c)).toBe(0);
      expect(Number(afterWipe.rows[0].j)).toBe(0);
      // Activity groups are auxiliary: only resetSettings (settings-only reset) clears them.
      const groupsLeft = await query('SELECT COUNT(*) FROM mood_activity_groups');
      expect(Number(groupsLeft.rows[0].count)).toBe(1);
    });
  });
});
