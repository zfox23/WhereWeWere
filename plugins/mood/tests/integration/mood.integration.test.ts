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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportPluginData, importPluginData, deletePluginData } from '../../../../server/src/plugins/backup';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { zipDirectory } from '../../../../server/src/services/backupArchive';

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
    it('requires a signed-in user, and a year for the yearly stats', async () => {
      expect((await request(app).get('/api/v1/mood-checkins/stats/daily').unset('Cookie')).status).toBe(401);
      expect((await request(app).get('/api/v1/mood-checkins/stats/monthly')).status).toBe(400);
      expect((await request(app).get('/api/v1/mood-checkins/stats/heatmap')).status).toBe(400);
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

  describe('multi-user isolation', () => {
    let other: TestUser;
    const as = (r: request.Test) => r.set('Cookie', other.cookie);

    beforeEach(async () => {
      other = await createTestUser('other');
    });

    /** The default user's group + activity + a check-in linking them. */
    async function seedDefaultUser() {
      const groupId = await createActivityGroup('Health');
      const activityId = await createActivity(groupId, 'Gym');
      const created = await request(app)
        .post('/api/v1/mood-checkins')
        .send({ mood: 5, note: 'private <br> note', checked_in_at: '2026-03-10T12:00:00Z', activity_ids: [activityId] });
      expect(created.status).toBe(201);
      return { groupId, activityId, checkinId: created.body.id as string };
    }

    it("can't list, read, edit, or delete another user's check-ins", async () => {
      const { checkinId } = await seedDefaultUser();

      const list = await as(request(app).get('/api/v1/mood-checkins').query({ user_id: DEFAULT_USER_ID }));
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);
      expect((await as(request(app).get(`/api/v1/mood-checkins/${checkinId}`))).status).toBe(404);
      expect((await as(request(app).put(`/api/v1/mood-checkins/${checkinId}`)).send({ mood: 1, activity_ids: [] })).status).toBe(404);
      expect((await as(request(app).delete(`/api/v1/mood-checkins/${checkinId}`))).status).toBe(404);

      const mine = await request(app).get(`/api/v1/mood-checkins/${checkinId}`);
      expect(mine.body.mood).toBe(5);
      expect(mine.body.activities).toHaveLength(1);
    });

    it("can't see, use, change, or delete another user's activity groups and activities", async () => {
      const { groupId, activityId } = await seedDefaultUser();

      const groups = await as(request(app).get('/api/v1/mood-checkins/activities/groups'));
      expect(groups.body).toEqual([]);

      const base = '/api/v1/mood-checkins/activities';
      expect((await as(request(app).put(`${base}/groups/${groupId}`)).send({ name: 'x' })).status).toBe(404);
      expect((await as(request(app).delete(`${base}/groups/${groupId}`))).status).toBe(404);
      expect((await as(request(app).post(`${base}/activities`)).send({ group_id: groupId, name: 'Sneaky' })).status).toBe(404);
      expect(
        (await as(request(app).put(`${base}/activities/reorder`)).send({ group_id: groupId, activity_ids: [activityId] })).status,
      ).toBe(404);
      expect((await as(request(app).put(`${base}/activities/${activityId}`)).send({ name: 'Renamed' })).status).toBe(404);
      expect((await as(request(app).delete(`${base}/activities/${activityId}`))).status).toBe(404);

      // Their own activity can't be moved into the default user's group.
      const ownGroup = (await as(request(app).post(`${base}/groups`)).send({ name: 'Mine' })).body.id;
      const ownActivity = (await as(request(app).post(`${base}/activities`)).send({ group_id: ownGroup, name: 'Run' })).body.id;
      expect((await as(request(app).put(`${base}/activities/${ownActivity}`)).send({ group_id: groupId })).status).toBe(404);

      // Nor can they link the default user's activity to their own check-ins.
      expect((await as(request(app).post('/api/v1/mood-checkins')).send({ mood: 3, activity_ids: [activityId] })).status).toBe(400);
      const own = await as(request(app).post('/api/v1/mood-checkins')).send({ mood: 3, activity_ids: [ownActivity] });
      expect(own.status).toBe(201);
      expect((await as(request(app).put(`/api/v1/mood-checkins/${own.body.id}`)).send({ activity_ids: [activityId] })).status).toBe(400);

      const mine = await request(app).get('/api/v1/mood-checkins/activities/groups');
      expect(mine.body).toEqual([
        expect.objectContaining({
          id: groupId,
          name: 'Health',
          activities: [expect.objectContaining({ id: activityId, name: 'Gym', mood_checkin_count: 1 })],
        }),
      ]);
    });

    it("stats only ever cover the signed-in user's check-ins", async () => {
      await seedDefaultUser();
      const q = { user_id: DEFAULT_USER_ID, from: '2026-03-01', to: '2026-03-31' };
      const stats = '/api/v1/mood-checkins/stats';
      expect((await as(request(app).get(`${stats}/daily`).query(q))).body).toEqual([]);
      expect((await as(request(app).get(`${stats}/count-range`).query(q))).body.every((r: any) => r.count === 0)).toBe(true);
      expect((await as(request(app).get(`${stats}/activity-correlations`).query(q))).body).toEqual([]);
      expect((await as(request(app).get(`${stats}/heatmap`).query({ ...q, year: 2026 }))).body).toEqual([]);
      expect((await as(request(app).get(`${stats}/monthly`).query({ ...q, year: 2026 }))).body).toEqual([]);
      expect((await as(request(app).get(`${stats}/earliest`))).body).toEqual({ date: null });

      expect((await request(app).get(`${stats}/daily`).query(q)).body).toHaveLength(1);
      expect((await request(app).get(`${stats}/earliest`)).body).toEqual({ date: '2026-03-10' });
    });

    it("the timeline (search and filters) never shows another user's check-ins", async () => {
      await seedDefaultUser();
      for (const q of [{}, { q: 'private' }, { user_id: DEFAULT_USER_ID, activity: 'gym' }, { mood: '5' }]) {
        const res = await as(request(app).get('/api/v1/timeline').query(q));
        expect(res.status).toBe(200);
        expect(res.body.filter((r: any) => r.type === 'mood')).toEqual([]);
      }
      const mine = await request(app).get('/api/v1/timeline').query({ q: 'private' });
      expect(mine.body.filter((r: any) => r.type === 'mood')).toHaveLength(1);
    });

    it("the <br> cleanup only touches the caller's notes", async () => {
      const { checkinId } = await seedDefaultUser();
      const res = await as(request(app).post('/api/v1/mood-checkins/import/daylio/replace-br'));
      expect(res.body).toEqual({ updated: 0 });
      expect((await request(app).get(`/api/v1/mood-checkins/${checkinId}`)).body.note).toBe('private <br> note');
    });

    it("restoring a backup never attaches rows to another user's groups or check-ins", async () => {
      const { groupId, activityId, checkinId } = await seedDefaultUser();
      const payload = await exportPluginData(DEFAULT_USER_ID);

      // The other user restores the default user's export (same ids), plus
      // crafted rows pointing their own new ids at the default user's parents.
      const mood = payload.mood as any;
      mood.extra.moodActivities.push({
        id: '11111111-1111-4111-8111-111111111111', group_id: groupId, name: 'Planted',
        display_order: 9, icon: null, created_at: null, updated_at: null,
      });
      mood.checkins.push({
        id: '22222222-2222-4222-8222-222222222222', mood: 2, note: 'theirs',
        checked_in_at: '2026-04-01T10:00:00Z', mood_timezone: 'UTC', created_at: null, updated_at: null, daylio_hash: null,
      });
      mood.extra.moodCheckinActivities.push(
        { mood_checkin_id: checkinId, activity_id: activityId },
        { mood_checkin_id: '22222222-2222-4222-8222-222222222222', activity_id: activityId },
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await importPluginData(client, other.id, { mood: payload.mood });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      // Only the brand-new check-in landed, owned by the other user and with no links.
      const theirs = await query(
        `SELECT id, user_id FROM mood_checkins WHERE user_id = $1`, [other.id],
      );
      expect(theirs.rows).toEqual([{ id: '22222222-2222-4222-8222-222222222222', user_id: other.id }]);
      const links = await query('SELECT mood_checkin_id, activity_id FROM mood_checkin_activities');
      expect(links.rows).toEqual([{ mood_checkin_id: checkinId, activity_id: activityId }]);
      const activities = await query('SELECT id FROM mood_activities');
      expect(activities.rows).toEqual([{ id: activityId }]);
      const groups = await query('SELECT id, user_id FROM mood_activity_groups');
      expect(groups.rows).toEqual([{ id: groupId, user_id: DEFAULT_USER_ID }]);

      // The legacy restore path is guarded the same way.
      const legacyClient = await pool.connect();
      try {
        await legacyClient.query('BEGIN');
        const { getPlugin } = await import('../../../../server/src/plugins/registry');
        await getPlugin('mood')!.server.restoreLegacyBackup!(
          { user_id: other.id, client: legacyClient },
          {
            moodActivities: [{ id: '33333333-3333-4333-8333-333333333333', group_id: groupId, name: 'Legacy plant' }],
            moodCheckinActivities: [{ mood_checkin_id: '22222222-2222-4222-8222-222222222222', activity_id: activityId }],
          },
        );
        await legacyClient.query('COMMIT');
      } finally {
        legacyClient.release();
      }
      expect((await query('SELECT COUNT(*)::int AS c FROM mood_activities')).rows[0].c).toBe(1);
      expect((await query('SELECT COUNT(*)::int AS c FROM mood_checkin_activities')).rows[0].c).toBe(1);
    });

    it("start-over for one user leaves another user's mood data alone", async () => {
      await seedDefaultUser();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await deletePluginData(client, other.id, ['mood']);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const left = await query(
        `SELECT (SELECT COUNT(*) FROM mood_checkins)::int AS c, (SELECT COUNT(*) FROM mood_activity_groups)::int AS g`,
      );
      expect(left.rows[0]).toEqual({ c: 1, g: 1 });
    });

    describe('Daylio import', () => {
      async function daylioFile(datetimes: number[]): Promise<Buffer> {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylio-test-'));
        try {
          const backup = {
            dayEntries: datetimes.map((datetime, i) => ({ id: i + 1, datetime, mood: 1, tags: [1], note: `entry ${i}` })),
            tags: [{ id: 1, name: 'Gym', id_tag_group: 1 }],
            tag_groups: [{ id: 1, name: 'Health' }],
            metadata: { timezone: 'UTC' },
          };
          fs.writeFileSync(path.join(dir, 'backup.daylio'), Buffer.from(JSON.stringify(backup)).toString('base64'));
          return await zipDirectory(dir);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }

      it("creates the importer's own groups/activities, never reusing another user's", async () => {
        const { groupId, activityId } = await seedDefaultUser(); // also 'Health' > 'Gym'
        const file = await daylioFile([Date.UTC(2025, 0, 1, 12), Date.UTC(2025, 0, 2, 12)]);

        const res = await as(request(app).post('/api/v1/mood-checkins/import/daylio')).attach('file', file, 'backup.daylio');
        expect(res.status).toBe(200);
        expect(res.body.imported).toBe(2);

        const theirGroups = await as(request(app).get('/api/v1/mood-checkins/activities/groups'));
        expect(theirGroups.body).toHaveLength(1);
        expect(theirGroups.body[0].id).not.toBe(groupId);
        expect(theirGroups.body[0].activities).toEqual([
          expect.objectContaining({ name: 'Gym', mood_checkin_count: 2 }),
        ]);
        expect(theirGroups.body[0].activities[0].id).not.toBe(activityId);

        const counts = await query(
          'SELECT user_id, COUNT(*)::int AS c FROM mood_checkins GROUP BY user_id ORDER BY c',
        );
        expect(counts.rows).toEqual([
          { user_id: DEFAULT_USER_ID, c: 1 },
          { user_id: other.id, c: 2 },
        ]);
        // The default user's activity kept exactly its one link.
        const mine = await request(app).get('/api/v1/mood-checkins/activities/groups');
        expect(mine.body[0].activities[0].mood_checkin_count).toBe(1);
      });

      it("re-importing dedupes against the importer's own entries, and an overlapping file never touches the other user's", async () => {
        const file = await daylioFile([Date.UTC(2025, 0, 1, 12)]);
        const first = await request(app).post('/api/v1/mood-checkins/import/daylio').attach('file', file, 'backup.daylio');
        expect(first.body.imported).toBe(1);
        const again = await request(app).post('/api/v1/mood-checkins/import/daylio').attach('file', file, 'backup.daylio');
        expect(again.body).toEqual(expect.objectContaining({ imported: 0, skipped: 1 }));

        // The same file imported by another user lands in their own account
        // (daylio_hash is unique per user) without touching the default user's.
        const theirs = await as(request(app).post('/api/v1/mood-checkins/import/daylio')).attach('file', file, 'backup.daylio');
        expect(theirs.body).toEqual(expect.objectContaining({ imported: 1, skipped: 0 }));
        const rows = await query('SELECT user_id, note FROM mood_checkins ORDER BY user_id = $1 DESC', [DEFAULT_USER_ID]);
        expect(rows.rows).toEqual([
          { user_id: DEFAULT_USER_ID, note: 'entry 0' },
          { user_id: expect.not.stringMatching(DEFAULT_USER_ID), note: 'entry 0' },
        ]);
      });
    });
  });
});
