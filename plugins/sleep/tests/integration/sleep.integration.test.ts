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

describe('Sleep plugin API', () => {
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

  async function insertEntry(overrides: Record<string, unknown> = {}) {
    const result = await query(
      `INSERT INTO sleep_entries (user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, rating, comment)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, COALESCE($6, 0), $7)
       RETURNING id`,
      [
        DEFAULT_USER_ID,
        overrides.sleep_as_android_id ?? 1000,
        overrides.sleep_timezone ?? 'UTC',
        overrides.started_at ?? '2026-03-10T23:30:00Z',
        overrides.ended_at ?? '2026-03-11T06:00:00Z',
        overrides.rating ?? null,
        overrides.comment ?? null,
      ],
    );
    return result.rows[0].id as string;
  }

  describe('manifest', () => {
    it('is registered with its filter params and fields', async () => {
      const res = await request(app).get('/api/v1/plugins/sleep');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('sleep');
      expect(res.body.filterParams).toEqual(['sleep_duration']);
      expect(res.body.fields.map((f: any) => f.name)).toEqual(['started_at', 'ended_at', 'rating', 'comment']);
    });
  });

  describe('entry CRUD', () => {
    it('requires started_at and ended_at', async () => {
      const res = await request(app).post('/api/v1/sleep-entries').send({ started_at: '2026-03-10T23:30:00Z' });
      expect(res.status).toBe(400);
    });

    it('creates an entry with sanitized timezone, clamped rating, and defaulted android id', async () => {
      const res = await request(app)
        .post('/api/v1/sleep-entries')
        .send({
          started_at: '2026-03-10T23:30:00Z',
          ended_at: '2026-03-11T06:00:00Z',
          sleep_timezone: 'not-a-timezone',
          rating: 9,
          comment: '  great sleep  ',
        });
      expect(res.status).toBe(201);
      expect(res.body.sleep_timezone).toBe('UTC');
      expect(Number(res.body.rating)).toBe(5);
      expect(res.body.comment).toBe('great sleep');
      // Synthetic id: Date.now()-based (13 digits), not a small sequential int.
      // BIGINT comes back as a string from pg.
      expect(Number(res.body.sleep_as_android_id)).toBeGreaterThanOrEqual(1e12);
    });

    it('rejects duplicate sleep_as_android_id with 409', async () => {
      await request(app)
        .post('/api/v1/sleep-entries')
        .send({ sleep_as_android_id: 42, started_at: '2026-03-10T23:30:00Z', ended_at: '2026-03-11T06:00:00Z' });
      const res = await request(app)
        .post('/api/v1/sleep-entries')
        .send({ sleep_as_android_id: 42, started_at: '2026-03-10T23:30:00Z', ended_at: '2026-03-11T06:00:00Z' });
      expect(res.status).toBe(409);
    });

    it('lists, gets, updates (partial), and deletes', async () => {
      const id = await insertEntry({ rating: 3, comment: 'restless' });

      const list = await request(app).get('/api/v1/sleep-entries').query({ user_id: DEFAULT_USER_ID });
      expect(list.body).toHaveLength(1);
      // NUMERIC(3,2) is returned as a string by pg.
      expect(Number(list.body[0].rating)).toBe(3);

      const updated = await request(app)
        .put(`/api/v1/sleep-entries/${id}`)
        .send({ rating: 4, comment: '' });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.rating)).toBe(4);
      expect(updated.body.comment).toBeNull();
      // Untouched fields persist.
      expect(updated.body.started_at).toBeTruthy();

      const del = await request(app).delete(`/api/v1/sleep-entries/${id}`);
      expect(del.status).toBe(200);
      expect((await request(app).get(`/api/v1/sleep-entries/${id}`)).status).toBe(404);
      expect((await request(app).delete(`/api/v1/sleep-entries/${id}`)).status).toBe(404);
    });

    it('filters the list by user-local date range', async () => {
      await insertEntry({ sleep_as_android_id: 1, started_at: '2026-03-10T23:30:00Z', ended_at: '2026-03-11T06:00:00Z' });
      await insertEntry({ sleep_as_android_id: 2, started_at: '2026-03-15T23:30:00Z', ended_at: '2026-03-16T06:00:00Z' });

      const res = await request(app)
        .get('/api/v1/sleep-entries')
        .query({ user_id: DEFAULT_USER_ID, from: '2026-03-14', to: '2026-03-31' });
      expect(res.body).toHaveLength(1);
      expect(Number(res.body[0].sleep_as_android_id)).toBe(2);
    });
  });

  describe('stats', () => {
    it('requires user_id on every stats endpoint', async () => {
      for (const path of ['/stats/summary', '/stats/daily', '/stats/rating-distribution', '/stats/earliest']) {
        expect((await request(app).get(`/api/v1/sleep-entries${path}`)).status).toBe(400);
      }
    });

    it('computes summary, daily, rating distribution, and earliest', async () => {
      await insertEntry({
        sleep_as_android_id: 1,
        started_at: '2026-03-10T23:30:00Z',
        ended_at: '2026-03-11T06:00:00Z', // 6.5h
        rating: 4,
        sleep_timezone: 'UTC',
      });
      await insertEntry({
        sleep_as_android_id: 2,
        started_at: '2026-03-11T23:00:00Z',
        ended_at: '2026-03-12T07:00:00Z', // 8h
        rating: 0,
        sleep_timezone: 'UTC',
      });

      const summary = await request(app)
        .get('/api/v1/sleep-entries/stats/summary')
        .query({ user_id: DEFAULT_USER_ID });
      expect(summary.body.total_sleeps).toBe(2);
      // (390 + 480) / 2 = 435; total = 870.
      expect(summary.body.avg_duration_minutes).toBe(435);
      expect(summary.body.total_sleep_minutes).toBe(870);
      expect(summary.body.avg_rating).toBe(4);
      expect(summary.body.rated_count).toBe(1);

      const daily = await request(app)
        .get('/api/v1/sleep-entries/stats/daily')
        .query({ user_id: DEFAULT_USER_ID });
      expect(daily.body).toEqual([
        { date: '2026-03-11', count: 1, avg_duration_minutes: 390, total_sleep_minutes: 390, avg_rating: 4 },
        { date: '2026-03-12', count: 1, avg_duration_minutes: 480, total_sleep_minutes: 480, avg_rating: null },
      ]);

      const dist = await request(app)
        .get('/api/v1/sleep-entries/stats/rating-distribution')
        .query({ user_id: DEFAULT_USER_ID });
      expect(dist.body).toEqual([
        { stars: 0, count: 1 },
        { stars: 4, count: 1 },
      ]);

      const earliest = await request(app)
        .get('/api/v1/sleep-entries/stats/earliest')
        .query({ user_id: DEFAULT_USER_ID });
      expect(earliest.body).toEqual({ date: '2026-03-10' });
    });
  });

  describe('Sleep as Android webhook', () => {
    it('rejects payloads without an event', async () => {
      const res = await request(app).post('/api/v1/webhook/sleep-as-android').send({ value1: '1710000000000' });
      expect(res.status).toBe(400);
    });

    it('starts a pending session and closes it with the matching stop', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30); // 2026-03-10T23:30Z
      const endMs = Date.UTC(2026, 2, 11, 6, 0); // 2026-03-11T06:00Z

      const start = await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });
      expect(start.status).toBe(200);
      expect(start.body).toEqual({ ok: true });

      const pending = await query(
        'SELECT is_pending, sleep_timezone, started_at FROM sleep_entries WHERE user_id = $1',
        [DEFAULT_USER_ID],
      );
      expect(pending.rowCount).toBe(1);
      expect(pending.rows[0].is_pending).toBe(true);
      expect(pending.rows[0].sleep_timezone).toBe('UTC'); // no check-ins yet -> UTC fallback
      expect(new Date(pending.rows[0].started_at).getTime()).toBe(startMs);

      const stop = await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_stopped', value1: String(startMs), value2: String(endMs) });
      expect(stop.body).toEqual({ ok: true });

      const closed = await query(
        'SELECT is_pending, ended_at FROM sleep_entries WHERE user_id = $1',
        [DEFAULT_USER_ID],
      );
      expect(closed.rows[0].is_pending).toBe(false);
      expect(new Date(closed.rows[0].ended_at).getTime()).toBe(endMs);

      const stats = await request(app).get('/api/v1/webhook/sleep-as-android/stats');
      expect(stats.body.count).toBe(2);
    });

    it('infers the timezone from the most recent check-in at the start time', async () => {
      await query(
        `INSERT INTO venues (name, latitude, longitude) VALUES ('TZ Venue', 37.7749, -122.4194) RETURNING id`,
      );
      await query(
        `INSERT INTO checkins (user_id, venue_id, checked_in_at, checkin_timezone)
         SELECT $1, id, '2026-03-10T12:00:00Z', 'America/Los_Angeles' FROM venues LIMIT 1`,
        [DEFAULT_USER_ID],
      );

      const startMs = Date.UTC(2026, 2, 10, 23, 30);
      await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });

      const row = await query('SELECT sleep_timezone FROM sleep_entries WHERE user_id = $1', [DEFAULT_USER_ID]);
      expect(row.rows[0].sleep_timezone).toBe('America/Los_Angeles');
    });

    it('supersedes an abandoned pending session on a new start, and falls back to the newest pending on a mismatched stop', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30);
      await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });

      // Watch reconnect: a second start abandons the first session.
      const start2Ms = startMs + 5 * 60 * 1000;
      await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_started', value1: String(start2Ms) });

      const afterStart2 = await query('SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE is_pending)::int AS p FROM sleep_entries');
      expect(afterStart2.rows[0].c).toBe(1);
      expect(afterStart2.rows[0].p).toBe(1);

      // Stop referencing the ABANDONED start: nothing matches, so the
      // fallback closes the most recent pending session.
      const endMs = start2Ms + 6 * 3600 * 1000;
      const stop = await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_stopped', value1: String(startMs), value2: String(endMs) });
      expect(stop.body).toEqual({ ok: true });

      const closed = await query('SELECT is_pending FROM sleep_entries WHERE user_id = $1', [DEFAULT_USER_ID]);
      expect(closed.rows[0].is_pending).toBe(false);
    });
  });

  describe('CSV import (Sleep as Android export)', () => {
    it('imports well-formed rows, skips malformed/duplicate rows, and dedupes on re-import', async () => {
      const csv = [
        'Id,From,To,Rating,Tz,Comment',
        '1,10.3.2026 23:30,11.3.2026 06:00,4,Europe/Lisbon,deep sleep',
        '2,garbage,garbage,3,Europe/Lisbon,',
        '',
      ].join('\n');

      const post = (name: string) =>
        request(app).post('/api/v1/import/sleep-as-android').field('file', Buffer.from(csv), name);

      const first = await post('export.csv');
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ imported: 1, skipped: 1, errors: [], total_errors: 0 });

      const entry = await query(
        `SELECT sleep_timezone, started_at, ended_at, rating, comment
         FROM sleep_entries WHERE user_id = $1`,
        [DEFAULT_USER_ID],
      );
      expect(entry.rows[0].sleep_timezone).toBe('Europe/Lisbon');
      // 10.3.2026 23:30 in Europe/Lisbon (UTC+0 in March) == 2026-03-10T23:30Z.
      expect(new Date(entry.rows[0].started_at).toISOString()).toBe('2026-03-10T23:30:00.000Z');
      expect(new Date(entry.rows[0].ended_at).toISOString()).toBe('2026-03-11T06:00:00.000Z');
      expect(Number(entry.rows[0].rating)).toBe(4);
      expect(entry.rows[0].comment).toBe('deep sleep');

      // Re-import: the same android id already exists -> ON CONFLICT DO NOTHING.
      const second = await post('export.csv');
      expect(second.body).toEqual({ imported: 0, skipped: 2, errors: [], total_errors: 0 });
    });

    it('rejects non-CSV uploads', async () => {
      const res = await request(app)
        .post('/api/v1/import/sleep-as-android')
        .field('file', Buffer.from('not csv bytes'), 'backup.zip');
      expect(res.status).toBe(400);
    });
  });

  describe('unified timeline', () => {
    it('emits sleep rows on the wake-up day and honors sleep_duration filters', async () => {
      await insertEntry({
        sleep_as_android_id: 1,
        started_at: '2026-03-10T22:00:00Z',
        ended_at: '2026-03-11T05:30:00Z', // 7.5h -> 6to8
        comment: 'good night',
      });
      await insertEntry({
        sleep_as_android_id: 2,
        started_at: '2026-03-11T23:50:00Z',
        ended_at: '2026-03-12T03:00:00Z', // 3h 10m -> lte6
      });

      const all = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID });
      expect(all.status).toBe(200);
      const sleepRows = all.body.filter((row: any) => row.type === 'sleep');
      expect(sleepRows).toHaveLength(2);
      // Newest wake-up first; each row anchors on its wake-up time (ended_at).
      // jsonb timestamptz serializes in Postgres text form (…+00:00), so
      // compare via Date normalization.
      const iso = (v: unknown) => new Date(v as string).toISOString();
      expect(iso(sleepRows[0].data.started_at)).toBe('2026-03-11T23:50:00.000Z');
      expect(iso(sleepRows[1].data.started_at)).toBe('2026-03-10T22:00:00.000Z');
      expect(iso(sleepRows[1].data.ended_at)).toBe('2026-03-11T05:30:00.000Z');
      expect(sleepRows[1].timezone).toBe('UTC');
      expect(sleepRows[1].notes).toBe('good night');

      const short = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, sleep_duration: 'lte6' });
      expect(short.body).toHaveLength(1);
      expect(iso(short.body[0].data.started_at)).toBe('2026-03-11T23:50:00.000Z');

      const mid = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, sleep_duration: '6to8' });
      expect(mid.body).toHaveLength(1);
      expect(iso(mid.body[0].data.started_at)).toBe('2026-03-10T22:00:00.000Z');

      const long = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, sleep_duration: 'gte8' });
      expect(long.body).toHaveLength(0);

      // Text search matches the comment.
      const searched = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, sleep_duration: 'lte6' });
      expect(searched.body).toHaveLength(1);
    });
  });

  describe('backup round-trip', () => {
    it('survives export -> wipe -> import with all columns intact', async () => {
      const id = await insertEntry({
        sleep_as_android_id: 7,
        started_at: '2026-03-10T23:30:00Z',
        ended_at: '2026-03-11T06:00:00Z',
        rating: 3,
        comment: 'backup me',
        sleep_timezone: 'Europe/Lisbon',
      });

      const payload = await exportPluginData(DEFAULT_USER_ID);
      const sleepRows = payload.sleep.checkins as Array<Record<string, unknown>>;
      expect(sleepRows).toHaveLength(1);
      expect(sleepRows[0].id).toBe(id);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM sleep_entries');
        const counts = await importPluginData(client, DEFAULT_USER_ID, { sleep: payload.sleep });
        expect(counts.sleep.inserted).toBe(1);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const restored = await request(app).get(`/api/v1/sleep-entries/${id}`);
      expect(restored.status).toBe(200);
      expect(Number(restored.body.sleep_as_android_id)).toBe(7);
      expect(restored.body.sleep_timezone).toBe('Europe/Lisbon');
      expect(restored.body.comment).toBe('backup me');
      expect(Number(restored.body.rating)).toBe(3);
    });

    it('start-over deletes entries; resetSettings wipes the webhook event log', async () => {
      await insertEntry({ sleep_as_android_id: 1 });
      await request(app)
        .post('/api/v1/webhook/sleep-as-android')
        .send({ event: 'sleep_tracking_started', value1: String(Date.UTC(2026, 2, 10, 23, 30)) });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const counts = await deletePluginData(client, DEFAULT_USER_ID, ['sleep']);
        await client.query('COMMIT');
        // 2 entries (manual + webhook-pending) + 0 plugin_settings rows.
        expect(counts.sleep).toBe(2);
      } finally {
        client.release();
      }

      const remaining = await query(
        `SELECT (SELECT COUNT(*) FROM sleep_entries) AS c`,
      );
      expect(Number(remaining.rows[0].c)).toBe(0);
      // Webhook events are auxiliary: only resetSettings (settings-only reset) clears them.
      const events = await query('SELECT COUNT(*) FROM sleep_webhook_events');
      expect(Number(events.rows[0].count)).toBe(1);
    });
  });
});
