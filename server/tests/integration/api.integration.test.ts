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

describe('API integration', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('returns health status', async () => {
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('serializes venue coordinates as numbers', async () => {
    await query(
      `INSERT INTO venues (name, latitude, longitude)
       VALUES ('Test Cafe', 37.7749, -122.4194)`
    );

    const response = await request(app).get('/api/v1/venues');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(1);
    expect(typeof response.body[0].latitude).toBe('number');
    expect(typeof response.body[0].longitude).toBe('number');
    expect(response.body[0].latitude).toBeCloseTo(37.7749, 4);
    expect(response.body[0].longitude).toBeCloseTo(-122.4194, 4);
  });

  it('creates check-ins and returns timezone-aware results', async () => {
    const venueInsert = await query(
      `INSERT INTO venues (name, latitude, longitude)
       VALUES ('Timezone Venue', 37.7749, -122.4194)
       RETURNING id`
    );
    const venueId = venueInsert.rows[0].id as string;

    const createResponse = await request(app)
      .post('/api/v1/checkins')
      .send({
        user_id: DEFAULT_USER_ID,
        venue_id: venueId,
        notes: 'integration-test',
      });

    expect(createResponse.status).toBe(201);

    const listResponse = await request(app)
      .get('/api/v1/checkins')
      .query({ user_id: DEFAULT_USER_ID });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.length).toBe(1);
    expect(listResponse.body[0].venue_timezone).toBeTruthy();
    expect(typeof listResponse.body[0].venue_timezone).toBe('string');
  });
});
