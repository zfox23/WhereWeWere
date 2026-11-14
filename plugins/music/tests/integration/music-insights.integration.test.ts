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
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { discoveryBucket } from '../../services/insights';

const play = (iso: string, title: string, artists = ['A'], timezone = 'UTC', userId = DEFAULT_USER_ID) =>
  query(
    `INSERT INTO music_scrobbles (user_id, played_at, title, artists, timezone, track_length) VALUES ($1, $2, $3, $4, $5, 200)`,
    [userId, iso, title, artists, timezone],
  );

const get = (path: string, params: Record<string, string> = {}) => request(app).get(`/api/v1/music/insights/${path}`).query(params);

describe('music insights', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(resetIntegrationDatabase);
  afterAll(teardownIntegrationDatabase);

  describe('daily listening', () => {
    it('counts plays per local day and finds streaks', async () => {
      // 03:00 UTC on Mar 2 is still Mar 1 in Chicago.
      await play('2024-03-02T03:00:00Z', 'Late', ['A'], 'America/Chicago');
      await play('2024-03-02T15:00:00Z', 'Day');
      await play('2024-03-03T15:00:00Z', 'Day');
      await play('2024-03-03T16:00:00Z', 'Day 2');
      // A separate two-day run, ending the day before "today".
      await play('2024-03-10T12:00:00Z', 'Later');
      await play('2024-03-11T12:00:00Z', 'Later');
      await play('2023-12-31T12:00:00Z', 'Last year');

      const res = await get('daily', { year: '2024', today: '2024-03-12' });
      expect(res.status).toBe(200);
      expect(res.body.days).toEqual([
        { date: '2024-03-01', plays: 1, seconds: 200 },
        { date: '2024-03-02', plays: 1, seconds: 200 },
        { date: '2024-03-03', plays: 2, seconds: 400 },
        { date: '2024-03-10', plays: 1, seconds: 200 },
        { date: '2024-03-11', plays: 1, seconds: 200 },
      ]);
      expect(res.body).toMatchObject({ listening_days: 5, longest_streak: 3, current_streak: 2 });

      const later = await get('daily', { year: '2024', today: '2024-03-20' });
      expect(later.body.current_streak).toBe(0);
    });
  });

  describe('listening clock', () => {
    it('groups by local weekday and hour within the period', async () => {
      // Friday 2024-03-01 22:30 in Chicago.
      await play('2024-03-02T04:30:00Z', 'Fri night', ['A'], 'America/Chicago');
      await play('2024-03-04T09:00:00Z', 'Mon morning');
      await play('2024-03-04T09:45:00Z', 'Mon morning 2');
      await play('2024-05-01T09:00:00Z', 'Outside');
      const res = await get('clock', { from: '2024-03-01', to: '2024-03-31' });
      expect(res.body).toEqual([
        { dow: 1, hour: 9, plays: 2, seconds: 400 },
        { dow: 5, hour: 22, plays: 1, seconds: 200 },
      ]);
    });
  });

  describe('discovery', () => {
    it('picks a bucket size for the span', () => {
      expect(discoveryBucket('2024-03-01', '2024-03-31')).toBe('week');
      expect(discoveryBucket('2024-01-01', '2024-12-31')).toBe('month');
      expect(discoveryBucket('2019-01-01', '2024-12-31')).toBe('year');
    });

    it('splits plays into new and familiar by each song\'s first play ever', async () => {
      await play('2023-12-15T12:00:00Z', 'Old', ['A']);
      await play('2024-01-10T12:00:00Z', 'Old', ['A']);
      await play('2024-01-11T12:00:00Z', 'Fresh', ['B']);
      await play('2024-01-12T12:00:00Z', 'Fresh', ['B']);
      await play('2024-03-05T12:00:00Z', 'Fresh', ['B']);
      await play('2024-03-06T12:00:00Z', 'Newer', ['C', 'A']);

      const res = await get('discovery', { from: '2024-01-01', to: '2024-03-31' });
      expect(res.body.bucket).toBe('month');
      expect(res.body.buckets).toEqual([
        { start: '2024-01-01', new_plays: 2, familiar_plays: 1, new_songs: 1, new_artists: 1 },
        { start: '2024-02-01', new_plays: 0, familiar_plays: 0, new_songs: 0, new_artists: 0 },
        { start: '2024-03-01', new_plays: 1, familiar_plays: 1, new_songs: 1, new_artists: 1 },
      ]);
      expect(res.body.totals).toEqual({ plays: 5, new_plays: 3, new_songs: 2, new_artists: 2 });
    });

    it('spans the whole history for all time, and is empty without plays', async () => {
      expect((await get('discovery')).body).toMatchObject({ buckets: [] });
      await play('2024-01-10T12:00:00Z', 'One');
      await play('2024-01-20T12:00:00Z', 'Two');
      const res = await get('discovery');
      expect(res.body.bucket).toBe('week');
      expect(res.body.totals).toMatchObject({ plays: 2, new_plays: 2, new_songs: 2, new_artists: 1 });
    });
  });

  it('shows another user none of it', async () => {
    await play('2024-03-04T09:00:00Z', 'Mine');
    const other = await createTestUser('other');
    const as = (path: string, params: Record<string, string> = {}) => get(path, params).set('Cookie', other.cookie);
    expect((await as('daily', { year: '2024' })).body).toMatchObject({ days: [], listening_days: 0, longest_streak: 0 });
    expect((await as('clock')).body).toEqual([]);
    expect((await as('discovery')).body.buckets).toEqual([]);
  });
});
