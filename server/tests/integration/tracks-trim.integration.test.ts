import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';

const BASE_MS = 1_700_000_000_000;
const POINT_COUNT = 10;

/**
 * Insert a synthetic track with `POINT_COUNT` points, one second apart and
 * moving ~14.2 m/s in a straight line (fast, but below the 30 m/s GPS-jump
 * threshold).
 */
async function insertTrimTestTrack(opts: { withPoints?: boolean } = {}): Promise<string> {
  const coordinates: [number, number][] = [];
  const points: { t: number; ele: number; hr: number }[] = [];
  for (let i = 0; i < POINT_COUNT; i++) {
    coordinates.push([-122.5 + i * 0.0001, 37.8 + i * 0.0001]);
    points.push({ t: BASE_MS + i * 1000, ele: 10 + i, hr: 100 + i });
  }
  const wkt =
    'LINESTRING(' + coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(', ') + ')';

  const result = await query(
    `INSERT INTO tracks (
       user_id, name, activity_type, timezone, started_at, ended_at,
       distance_m, elapsed_time_s, moving_time_s, elevation_gain_m,
       avg_speed_mps, max_speed_mps, avg_hr, max_hr, point_count, path, points
     )
     VALUES (
       $1, 'Trim Test', 'Cycling', 'UTC', $2, $3,
       128, 9, 9, 9, 14.18, 14.18, 105, 109, 10,
       ST_SetSRID(ST_GeomFromText($4), 4326), $5::jsonb
     )
     RETURNING id`,
    [
      DEFAULT_USER_ID,
      new Date(BASE_MS).toISOString(),
      new Date(BASE_MS + (POINT_COUNT - 1) * 1000).toISOString(),
      wkt,
      opts.withPoints === false ? null : JSON.stringify(points),
    ]
  );
  return result.rows[0].id as string;
}

describe('POST /api/v1/tracks/:id/trim', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('trims both ends and recomputes stats', async () => {
    const id = await insertTrimTestTrack();

    const response = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 2, end_index: 7 });

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body.id).toBe(id);
    expect(body.point_count).toBe(6);
    expect(body.geometry).toHaveLength(6);
    expect(body.points).toHaveLength(6);
    expect(body.started_at).toBe(new Date(BASE_MS + 2000).toISOString());
    expect(body.ended_at).toBe(new Date(BASE_MS + 7000).toISOString());
    // 5 segments of ~14.18 m
    expect(Number(body.distance_m)).toBeCloseTo(70.89, 0);
    expect(Number(body.elapsed_time_s)).toBe(5);
    expect(Number(body.elevation_gain_m)).toBe(5);
    expect(body.avg_hr).toBe(105);
    expect(body.max_hr).toBe(107);
    // The persisted row reflects the trimmed geometry
    const row = await query(
      'SELECT ST_NPoints(path) AS n, point_count, points->0 AS first FROM tracks WHERE id = $1',
      [id]
    );
    expect(row.rows[0].n).toBe(6);
    expect(row.rows[0].point_count).toBe(6);
    expect(row.rows[0].first).toEqual({ t: BASE_MS + 2000, ele: 12, hr: 102 });
  });

  it('allows trimming only the start', async () => {
    const id = await insertTrimTestTrack();

    const response = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 4, end_index: POINT_COUNT - 1 });

    expect(response.status).toBe(200);
    expect(response.body.point_count).toBe(6);
    expect(response.body.started_at).toBe(new Date(BASE_MS + 4000).toISOString());
    expect(response.body.ended_at).toBe(new Date(BASE_MS + 9000).toISOString());
  });

  it('rejects invalid ranges', async () => {
    const id = await insertTrimTestTrack();

    const startAfterEnd = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 5, end_index: 3 });
    expect(startAfterEnd.status).toBe(400);

    const outOfBounds = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 0, end_index: POINT_COUNT });
    expect(outOfBounds.status).toBe(400);

    const negative = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: -1, end_index: 5 });
    expect(negative.status).toBe(400);

    const nonInteger = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 0.5, end_index: 5 });
    expect(nonInteger.status).toBe(400);
  });

  it('rejects keeping fewer than 2 points', async () => {
    const id = await insertTrimTestTrack();

    const response = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 3, end_index: 3 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least 2 points/);
  });

  it('rejects tracks without per-point data', async () => {
    const id = await insertTrimTestTrack({ withPoints: false });

    const response = await request(app)
      .post(`/api/v1/tracks/${id}/trim`)
      .send({ start_index: 0, end_index: POINT_COUNT - 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/per-point data/);
  });

  it('returns 404 for unknown tracks', async () => {
    const response = await request(app)
      .post('/api/v1/tracks/00000000-0000-0000-0000-000000000000/trim')
      .send({ start_index: 0, end_index: 5 });

    expect(response.status).toBe(404);
  });
});
