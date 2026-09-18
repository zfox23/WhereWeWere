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

/** A minimal valid GPX: 3 points, ~300 m, with times (no name/type, so the
 *  route derives them from the filename). */
const GPX_FILE = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <trkseg>
      <trkpt lat="37.80000000" lon="-122.50000000"><ele>10.5</ele><time>2024-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="37.80100000" lon="-122.50000000"><ele>20</ele><time>2024-01-01T10:00:03Z</time></trkpt>
      <trkpt lat="37.80200000" lon="-122.50000000"><time>2024-01-01T10:00:07Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('Tracks plugin API', () => {
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

  describe('manifest', () => {
    it('is registered with its filter params and fields', async () => {
      const res = await request(app).get('/api/v1/plugins/tracks');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('tracks');
      expect(res.body.filterParams).toEqual(['track_activity']);
      expect(res.body.fields.map((f: any) => f.name)).toEqual([
        'name',
        'activity_type',
        'started_at',
        'ended_at',
        'distance_m',
        'elapsed_time_s',
      ]);
    });

    it('rejects generic check-in CRUD (custom storage owns its routes)', async () => {
      const res = await request(app).post('/api/v1/plugins/tracks/checkins').send({ data: { name: 'x' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('custom storage');
    });
  });

  describe('check-in CRUD', () => {
    it('creates a track from an uploaded GPX, lists it back, and maps it', async () => {
      const created = await request(app)
        .post('/api/v1/tracks')
        .attach('file', Buffer.from(GPX_FILE), '2024-01-01_10-00-00_Morning Ride_Cycling.gpx');
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      // The file carries no <trk><name> or <type>, so both are derived from
      // the Garmin-style filename (YYYY-MM-DD_HH-MM-SS_Name_Sport).
      expect(created.body.name).toBe('10-00-00_Morning Ride');
      expect(created.body.activity_type).toBe('Cycling');
      expect(created.body.point_count).toBe(3);
      expect(created.body.started_at).toBe('2024-01-01T10:00:00.000Z');
      expect(created.body.ended_at).toBe('2024-01-01T10:00:07.000Z');

      const listed = await request(app).get('/api/v1/tracks').query({ user_id: DEFAULT_USER_ID });
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].id).toBe(id);

      const full = await request(app).get(`/api/v1/tracks/${id}`);
      expect(full.status).toBe(200);
      expect(full.body.geometry).toHaveLength(3);
      expect(full.body.points).toHaveLength(3);
      expect(full.body.points[0]).toMatchObject({ ele: 10.5 });

      const map = await request(app).get('/api/v1/tracks/map-data').query({ user_id: DEFAULT_USER_ID });
      expect(map.status).toBe(200);
      expect(map.body).toHaveLength(1);
      expect(map.body[0].id).toBe(id);
      expect(map.body[0].coordinates).toHaveLength(3);
      expect(map.body[0].bounds).toMatchObject({ minLat: 37.8, maxLat: 37.802 });
    });

    it('rejects uploads without a file and malformed GPX', async () => {
      const missing = await request(app).post('/api/v1/tracks');
      expect(missing.status).toBe(400);

      const malformed = await request(app)
        .post('/api/v1/tracks')
        .attach('file', Buffer.from('<gpx></gpx>'), 'bad.gpx');
      expect(malformed.status).toBe(400);
    });

    it('rejects duplicate uploads with a 409 and the existing track', async () => {
      const first = await request(app)
        .post('/api/v1/tracks')
        .attach('file', Buffer.from(GPX_FILE), 'dupe.gpx');
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/v1/tracks')
        .attach('file', Buffer.from(GPX_FILE), 'dupe-again.gpx');
      expect(second.status).toBe(409);
      expect(second.body.duplicate).toEqual({ id: first.body.id, name: first.body.name });
    });

    it('updates name and activity type, rejecting invalid payloads', async () => {
      const id = await insertTrimTestTrack();

      const updated = await request(app)
        .put(`/api/v1/tracks/${id}`)
        .send({ name: 'Renamed', activity_type: '' });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Renamed');
      expect(updated.body.activity_type).toBeNull();

      const emptyName = await request(app).put(`/api/v1/tracks/${id}`).send({ name: '   ' });
      expect(emptyName.status).toBe(400);

      const noFields = await request(app).put(`/api/v1/tracks/${id}`).send({});
      expect(noFields.status).toBe(400);

      const unknown = await request(app)
        .put('/api/v1/tracks/00000000-0000-0000-0000-000000000000')
        .send({ name: 'x' });
      expect(unknown.status).toBe(404);
    });

    it('lists distinct activity types and honors the date range on list', async () => {
      const a = await insertTrimTestTrack();
      await query('UPDATE tracks SET activity_type = $1 WHERE id = $2', ['Running', a]);
      const res = await request(app)
        .get('/api/v1/tracks/activity-types')
        .query({ user_id: DEFAULT_USER_ID });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(['Running']);

      const before = await request(app)
        .get('/api/v1/tracks')
        .query({ user_id: DEFAULT_USER_ID, from: '2000-01-01', to: '2023-01-01' });
      expect(before.body).toHaveLength(0);
    });

    it('downloads a GPX generated from the current database state', async () => {
      const id = await insertTrimTestTrack();
      const res = await request(app).get(`/api/v1/tracks/${id}/download`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/gpx\+xml/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.gpx"/);
      expect(res.text).toContain('<gpx');
      expect(res.text).toContain('Trim Test');
    });

    it('deletes a track and 404s afterwards', async () => {
      const id = await insertTrimTestTrack();
      const res = await request(app).delete(`/api/v1/tracks/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect((await request(app).get(`/api/v1/tracks/${id}`)).status).toBe(404);
      expect((await request(app).delete(`/api/v1/tracks/${id}`)).status).toBe(404);
    });
  });

  describe('trim', () => {
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

  describe('unified timeline', () => {
    it('emits tracks rows with the full envelope and honors the activity filter', async () => {
      const id = await insertTrimTestTrack();
      await query('UPDATE tracks SET name = $1, activity_type = $2 WHERE id = $3', [
        'Evening Spin',
        'Cycling',
        id,
      ]);

      const all = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID });
      expect(all.status).toBe(200);
      const trackRows = all.body.filter((row: any) => row.type === 'tracks');
      expect(trackRows).toHaveLength(1);
      const row = trackRows[0];
      expect(row.id).toBe(id);
      expect(row.notes).toBe('Evening Spin');
      expect(row.track_name).toBe('Evening Spin');
      expect(row.track_timezone).toBe('UTC');
      expect(row.timezone).toBe('UTC');
      expect(row.checked_in_at).toBe(new Date(BASE_MS).toISOString());
      expect(Number(row.track_distance_m)).toBe(128);

      const byActivity = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, track_activity: 'Cycling' });
      expect(byActivity.body).toHaveLength(1);
      expect(byActivity.body[0].id).toBe(id);

      const noMatch = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, track_activity: 'Running' });
      expect(noMatch.body).toHaveLength(0);
    });
  });

  describe('backup round-trip', () => {
    it('survives export -> wipe -> import with geometry and points intact', async () => {
      const id = await insertTrimTestTrack();

      const payload = await exportPluginData(DEFAULT_USER_ID);
      const rows = payload.tracks.checkins as Record<string, any>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id,
        name: 'Trim Test',
        activity_type: 'Cycling',
        point_count: POINT_COUNT,
      });
      expect(rows[0].geometry).toHaveLength(POINT_COUNT);
      expect(rows[0].points).toHaveLength(POINT_COUNT);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM tracks');
        const counts = await importPluginData(client, DEFAULT_USER_ID, { tracks: payload.tracks });
        await client.query('COMMIT');
        expect(counts.tracks.inserted).toBe(1);
      } finally {
        client.release();
      }

      const restored = await request(app).get(`/api/v1/tracks/${id}`);
      expect(restored.status).toBe(200);
      expect(restored.body.name).toBe('Trim Test');
      expect(restored.body.geometry).toHaveLength(POINT_COUNT);
      expect(restored.body.points).toHaveLength(POINT_COUNT);
    });

    it('start-over deletes the user\'s tracks', async () => {
      await insertTrimTestTrack();
      await insertTrimTestTrack();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const counts = await deletePluginData(client, DEFAULT_USER_ID, ['tracks']);
        await client.query('COMMIT');
        expect(counts.tracks).toBe(2);
      } finally {
        client.release();
      }

      const remaining = await query('SELECT COUNT(*) AS c FROM tracks');
      expect(Number(remaining.rows[0].c)).toBe(0);
    });
  });
});
