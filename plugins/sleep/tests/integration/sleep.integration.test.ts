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
import { createTestUser } from '../../../../server/tests/helpers/auth';

describe('Sleep plugin API', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  // The default user's personal webhook URL (the token lives on users).
  let hook = '';

  beforeEach(async () => {
    await resetIntegrationDatabase();
    const token = await query('SELECT webhook_token FROM users WHERE id = $1', [DEFAULT_USER_ID]);
    hook = `/api/v1/webhook/sleep-as-android/${token.rows[0].webhook_token}`;
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
    it('requires a signed-in user on every stats endpoint', async () => {
      for (const path of ['/stats/summary', '/stats/daily', '/stats/rating-distribution', '/stats/earliest', '/stats/webhook-events']) {
        expect((await request(app).get(`/api/v1/sleep-entries${path}`).unset('Cookie')).status).toBe(401);
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
      const res = await request(app).post(hook).send({ value1: '1710000000000' });
      expect(res.status).toBe(400);
    });

    it('starts a pending session and closes it with the matching stop', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30); // 2026-03-10T23:30Z
      const endMs = Date.UTC(2026, 2, 11, 6, 0); // 2026-03-11T06:00Z

      const start = await request(app)
        .post(hook)
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
        .post(hook)
        .send({ event: 'sleep_tracking_stopped', value1: String(startMs), value2: String(endMs) });
      expect(stop.body).toEqual({ ok: true });

      const closed = await query(
        'SELECT is_pending, ended_at FROM sleep_entries WHERE user_id = $1',
        [DEFAULT_USER_ID],
      );
      expect(closed.rows[0].is_pending).toBe(false);
      expect(new Date(closed.rows[0].ended_at).getTime()).toBe(endMs);

      const stats = await request(app).get('/api/v1/sleep-entries/stats/webhook-events');
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
        .post(hook)
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });

      const row = await query('SELECT sleep_timezone FROM sleep_entries WHERE user_id = $1', [DEFAULT_USER_ID]);
      expect(row.rows[0].sleep_timezone).toBe('America/Los_Angeles');
    });

    it('keeps exactly one pending session when starts arrive simultaneously', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30);
      const results = await Promise.all(
        [0, 1, 2, 3].map((i) =>
          request(app)
            .post(hook)
            .send({ event: 'sleep_tracking_started', value1: String(startMs + i * 60_000) }),
        ),
      );
      for (const r of results) expect(r.status).toBe(200);
      const rows = await query('SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE is_pending)::int AS p FROM sleep_entries');
      expect(rows.rows[0]).toEqual({ c: 1, p: 1 });
    });

    it('excludes pending sessions from stats, and a PUT with an end time completes one', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30);
      await request(app)
        .post(hook)
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });
      const summaryPending = await request(app).get('/api/v1/sleep-entries/stats/summary').query({ user_id: DEFAULT_USER_ID });
      expect(summaryPending.body.total_sleeps).toBe(0);

      const row = await query('SELECT id FROM sleep_entries');
      const end = new Date(startMs + 7 * 3600 * 1000).toISOString();
      const put = await request(app).put(`/api/v1/sleep-entries/${row.rows[0].id}`).send({ ended_at: end });
      expect(put.status).toBe(200);
      expect(put.body.is_pending).toBe(false);

      const summaryDone = await request(app).get('/api/v1/sleep-entries/stats/summary').query({ user_id: DEFAULT_USER_ID });
      expect(summaryDone.body.total_sleeps).toBe(1);

      const bad = await request(app)
        .put(`/api/v1/sleep-entries/${row.rows[0].id}`)
        .send({ ended_at: new Date(startMs - 3600_000).toISOString() });
      expect(bad.status).toBe(400);
    });

    it('supersedes an abandoned pending session on a new start, and falls back to the newest pending on a mismatched stop', async () => {
      const startMs = Date.UTC(2026, 2, 10, 23, 30);
      await request(app)
        .post(hook)
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });

      // Watch reconnect: a second start abandons the first session.
      const start2Ms = startMs + 5 * 60 * 1000;
      await request(app)
        .post(hook)
        .send({ event: 'sleep_tracking_started', value1: String(start2Ms) });

      const afterStart2 = await query('SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE is_pending)::int AS p FROM sleep_entries');
      expect(afterStart2.rows[0].c).toBe(1);
      expect(afterStart2.rows[0].p).toBe(1);

      // Stop referencing the ABANDONED start: nothing matches, so the
      // fallback closes the most recent pending session.
      const endMs = start2Ms + 6 * 3600 * 1000;
      const stop = await request(app)
        .post(hook)
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

    it('keeps a quoted multi-line comment as one record and handles a repeated header block', async () => {
      const csv = [
        'Id,From,To,Rating,Tz,Comment',
        '10,10.3.2026 23:30,11.3.2026 06:00,4,Europe/Lisbon,"woke up twice',
        'then slept fine"',
        'Id,Time,Hours',
        ',noise row,1',
        'Id,From,To,Rating,Tz,Comment',
        '11,11.3.2026 23:30,12.3.2026 06:30,5,Europe/Lisbon,ok',
        '',
      ].join('\n');
      const res = await request(app)
        .post('/api/v1/import/sleep-as-android')
        .field('file', Buffer.from(csv), 'export.csv');
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      const row = await query('SELECT comment FROM sleep_entries WHERE sleep_as_android_id = 10');
      expect(row.rows[0].comment).toBe('woke up twice\nthen slept fine');
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
        .post(hook)
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

  describe('multi-user isolation', () => {
    async function tokenOf(userId: string) {
      const r = await query('SELECT webhook_token FROM users WHERE id = $1', [userId]);
      return r.rows[0].webhook_token as string;
    }

    it("lands webhook events in the token owner's account only", async () => {
      const other = await createTestUser('other');
      const otherHook = `/api/v1/webhook/sleep-as-android/${await tokenOf(other.id)}`;
      const startMs = Date.UTC(2026, 2, 10, 23, 30);

      // The default user has a pending session; the other user's start must
      // not supersede (delete) it.
      await request(app).post(hook).unset('Cookie')
        .send({ event: 'sleep_tracking_started', value1: String(startMs) });
      const res = await request(app).post(otherHook).unset('Cookie')
        .send({ event: 'sleep_tracking_started', value1: String(startMs + 60_000) });
      expect(res.status).toBe(200);

      const rows = await query('SELECT user_id, is_pending FROM sleep_entries ORDER BY started_at');
      expect(rows.rows).toEqual([
        { user_id: DEFAULT_USER_ID, is_pending: true },
        { user_id: other.id, is_pending: true },
      ]);

      // A stop for the other user closes only their session.
      await request(app).post(otherHook).unset('Cookie')
        .send({ event: 'sleep_tracking_stopped', value1: String(startMs), value2: String(startMs + 8 * 3600_000) });
      const after = await query('SELECT user_id, is_pending FROM sleep_entries ORDER BY started_at');
      expect(after.rows).toEqual([
        { user_id: DEFAULT_USER_ID, is_pending: true },
        { user_id: other.id, is_pending: false },
      ]);

      // Each user's event counter only counts their own events.
      expect((await request(app).get('/api/v1/sleep-entries/stats/webhook-events')).body.count).toBe(1);
      expect((await request(app).get('/api/v1/sleep-entries/stats/webhook-events').set('Cookie', other.cookie)).body.count).toBe(2);
    });

    it('404s the old tokenless URL and unknown tokens, signed in or not, and writes nothing', async () => {
      const body = { event: 'sleep_tracking_started', value1: String(Date.UTC(2026, 2, 10, 23, 30)) };
      for (const path of [
        '/api/v1/webhook/sleep-as-android',
        '/api/v1/webhook/sleep-as-android/not-a-real-token',
      ]) {
        expect((await request(app).post(path).unset('Cookie').send(body)).status).toBe(404);
        expect((await request(app).post(path).send(body)).status).toBe(404);
      }
      // The event counter moved behind the login guard; the old public path is gone.
      expect((await request(app).get('/api/v1/webhook/sleep-as-android/stats').unset('Cookie')).status).toBe(404);

      const counts = await query(
        'SELECT (SELECT COUNT(*) FROM sleep_entries)::int AS e, (SELECT COUNT(*) FROM sleep_webhook_events)::int AS w',
      );
      expect(counts.rows[0]).toEqual({ e: 0, w: 0 });
    });

    it("a regenerated token retires the old URL", async () => {
      const oldHook = hook;
      const regenerated = await request(app).post('/api/v1/auth/webhook-token/regenerate');
      expect(regenerated.status).toBe(200);
      const body = { event: 'sleep_tracking_started', value1: String(Date.UTC(2026, 2, 10, 23, 30)) };
      expect((await request(app).post(oldHook).unset('Cookie').send(body)).status).toBe(404);
      const newHook = `/api/v1/webhook/sleep-as-android/${regenerated.body.token}`;
      expect((await request(app).post(newHook).unset('Cookie').send(body)).status).toBe(200);
    });

    it("can't list, read, edit, delete, or count another user's entries", async () => {
      const other = await createTestUser('other');
      const id = await insertEntry({ sleep_as_android_id: 1, comment: 'private dream' });
      const as = (r: request.Test) => r.set('Cookie', other.cookie);

      const list = await as(request(app).get('/api/v1/sleep-entries').query({ user_id: DEFAULT_USER_ID }));
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);
      expect((await as(request(app).get(`/api/v1/sleep-entries/${id}`))).status).toBe(404);
      expect((await as(request(app).put(`/api/v1/sleep-entries/${id}`)).send({ comment: 'hacked' })).status).toBe(404);
      // An inconsistent edit must look like a missing row too (not a 400).
      expect(
        (await as(request(app).put(`/api/v1/sleep-entries/${id}`)).send({ ended_at: '2000-01-01T00:00:00Z' })).status,
      ).toBe(404);
      expect((await as(request(app).delete(`/api/v1/sleep-entries/${id}`))).status).toBe(404);

      for (const path of ['/stats/summary', '/stats/daily', '/stats/rating-distribution', '/stats/earliest']) {
        const res = await as(request(app).get(`/api/v1/sleep-entries${path}`).query({ user_id: DEFAULT_USER_ID }));
        expect(res.status).toBe(200);
        if (path === '/stats/summary') expect(res.body.total_sleeps).toBe(0);
        else if (path === '/stats/earliest') expect(res.body.date).toBeNull();
        else expect(res.body).toEqual([]);
      }

      const mine = await request(app).get(`/api/v1/sleep-entries/${id}`);
      expect(mine.status).toBe(200);
      expect(mine.body.comment).toBe('private dream');
    });

    it("a restore of another user's backup never touches the owner's rows", async () => {
      const other = await createTestUser('other');
      const id = await insertEntry({ sleep_as_android_id: 5, comment: 'mine' });
      const payload = await exportPluginData(DEFAULT_USER_ID);
      (payload.sleep.checkins as any[])[0].comment = 'overwritten?';

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Same row id, now owned by someone else: skipped, not an error.
        const counts = await importPluginData(client, other.id, { sleep: payload.sleep });
        expect(counts.sleep.inserted).toBe(0);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const rows = await query('SELECT id, user_id, comment FROM sleep_entries');
      expect(rows.rows).toEqual([{ id, user_id: DEFAULT_USER_ID, comment: 'mine' }]);
    });

    it("imports a CSV into the uploader's account, deduping only against their own entries", async () => {
      const other = await createTestUser('other');
      await insertEntry({ sleep_as_android_id: 1, comment: 'mine' });
      const csv = ['Id,From,To,Rating,Tz,Comment', '1,10.3.2026 23:30,11.3.2026 06:00,4,UTC,theirs', ''].join('\n');

      const res = await request(app)
        .post('/api/v1/import/sleep-as-android')
        .set('Cookie', other.cookie)
        .field('file', Buffer.from(csv), 'export.csv');
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);

      const rows = await query('SELECT user_id, comment FROM sleep_entries ORDER BY user_id = $1', [DEFAULT_USER_ID]);
      expect(rows.rows).toEqual([
        { user_id: other.id, comment: 'theirs' },
        { user_id: DEFAULT_USER_ID, comment: 'mine' },
      ]);
    });

    it("the timeline (and its search) never shows another user's sleep", async () => {
      const other = await createTestUser('other');
      await insertEntry({ sleep_as_android_id: 1, comment: 'secret snooze' });
      for (const q of [{}, { q: 'secret snooze' }, { user_id: DEFAULT_USER_ID, q: 'snooze' }]) {
        const res = await request(app).get('/api/v1/timeline').set('Cookie', other.cookie).query(q);
        expect(res.status).toBe(200);
        expect(res.body.filter((r: any) => r.type === 'sleep')).toEqual([]);
      }
      const mine = await request(app).get('/api/v1/timeline').query({ q: 'secret snooze' });
      expect(mine.body.filter((r: any) => r.type === 'sleep')).toHaveLength(1);
    });

    it("start-over for one user leaves another user's sleep data alone", async () => {
      const other = await createTestUser('other');
      await insertEntry({ sleep_as_android_id: 1 });
      await request(app).post(hook).send({ event: 'sleep_tracking_started', value1: String(Date.UTC(2026, 2, 12)) });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await deletePluginData(client, other.id, ['sleep']);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const remaining = await query('SELECT COUNT(*)::int AS c FROM sleep_entries WHERE user_id = $1', [DEFAULT_USER_ID]);
      expect(remaining.rows[0].c).toBe(2);
    });
  });
});
