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

  it('treats duplicate checkin create client_ref_id as idempotent replay', async () => {
    const venueInsert = await query(
      `INSERT INTO venues (name, latitude, longitude)
       VALUES ('Idempotent Venue', 37.7749, -122.4194)
       RETURNING id`
    );
    const venueId = venueInsert.rows[0].id as string;
    const clientRefId = 'offline-checkin-123';

    const firstResponse = await request(app)
      .post('/api/v1/checkins')
      .send({
        user_id: DEFAULT_USER_ID,
        venue_id: venueId,
        notes: 'first create',
        client_ref_id: clientRefId,
      });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post('/api/v1/checkins')
      .send({
        user_id: DEFAULT_USER_ID,
        venue_id: venueId,
        notes: 'first create',
        client_ref_id: clientRefId,
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.id).toBe(firstResponse.body.id);

    const countResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1 AND client_ref_id = $2`,
      [DEFAULT_USER_ID, clientRefId]
    );
    expect(countResult.rows[0].count).toBe(1);
  });

  it('treats duplicate mood create client_ref_id as idempotent replay', async () => {
    const clientRefId = 'offline-mood-123';

    const firstResponse = await request(app)
      .post('/api/v1/mood-checkins')
      .send({
        mood: 4,
        note: 'first mood',
        client_ref_id: clientRefId,
      });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post('/api/v1/mood-checkins')
      .send({
        mood: 4,
        note: 'first mood',
        client_ref_id: clientRefId,
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.id).toBe(firstResponse.body.id);

    const countResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1 AND client_ref_id = $2`,
      [DEFAULT_USER_ID, clientRefId]
    );
    expect(countResult.rows[0].count).toBe(1);
  });

  it('treats duplicate sleep create sleep_as_android_id as idempotent replay', async () => {
    const externalId = 1234567890;

    const firstResponse = await request(app)
      .post('/api/v1/sleep-entries')
      .send({
        sleep_as_android_id: externalId,
        sleep_timezone: 'America/Los_Angeles',
        started_at: '2026-02-01T06:00:00Z',
        ended_at: '2026-02-01T14:00:00Z',
        rating: 4,
      });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post('/api/v1/sleep-entries')
      .send({
        sleep_as_android_id: externalId,
        sleep_timezone: 'America/Los_Angeles',
        started_at: '2026-02-01T06:00:00Z',
        ended_at: '2026-02-01T14:00:00Z',
        rating: 4,
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.id).toBe(firstResponse.body.id);

    const countResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM sleep_entries
       WHERE user_id = $1 AND sleep_as_android_id = $2`,
      [DEFAULT_USER_ID, externalId]
    );
    expect(countResult.rows[0].count).toBe(1);
  });

  it('scans and applies timestamp reconciliation suggestions', async () => {
    const lisbonVenueResult = await query(
      `INSERT INTO venues (name, latitude, longitude)
       VALUES ('Lisbon Cafe', 38.7223, -9.1393)
       RETURNING id`
    );
    const lisbonVenueId = lisbonVenueResult.rows[0].id as string;

    const venueCheckinResult = await query(
      `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone)
       VALUES ($1, $2, 'needs reconciliation', '2026-01-01T09:00:00-05:00', 'America/New_York')
       RETURNING id`,
      [DEFAULT_USER_ID, lisbonVenueId]
    );
    const venueCheckinId = venueCheckinResult.rows[0].id as string;

    const moodCheckinResult = await query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, mood_timezone)
       VALUES ($1, 4, 'near venue', '2026-01-01T14:30:00Z', NULL)
       RETURNING id`,
      [DEFAULT_USER_ID]
    );
    const moodCheckinId = moodCheckinResult.rows[0].id as string;

    const uninferableMoodCheckinResult = await query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, mood_timezone)
       VALUES ($1, 3, 'no nearby venue', '2026-03-01T12:00:00Z', NULL)
       RETURNING id`,
      [DEFAULT_USER_ID]
    );
    const uninferableMoodCheckinId = uninferableMoodCheckinResult.rows[0].id as string;

    const previewResponse = await request(app).get('/api/v1/settings/timestamp-reconciliation');

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: venueCheckinId,
          type: 'venue',
          suggested_timezone: 'Europe/Lisbon',
        }),
        expect.objectContaining({
          id: moodCheckinId,
          type: 'mood',
          suggested_timezone: 'Europe/Lisbon',
        }),
      ])
    );
    expect(previewResponse.body.uninferable_mood_checkins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: uninferableMoodCheckinId,
          type: 'mood',
        }),
      ])
    );

    const applyResponse = await request(app)
      .post('/api/v1/settings/timestamp-reconciliation/apply')
      .send({
        updates: [
          { id: venueCheckinId, type: 'venue', suggested_timezone: 'Europe/Lisbon' },
          { id: moodCheckinId, type: 'mood', suggested_timezone: 'Europe/Lisbon' },
        ],
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body).toEqual({ updated: 2 });

    const updatedVenueCheckin = await query(
      `SELECT checked_in_at, checkin_timezone
       FROM checkins
       WHERE id = $1`,
      [venueCheckinId]
    );
    expect(updatedVenueCheckin.rows[0].checkin_timezone).toBe('Europe/Lisbon');
    expect(new Date(updatedVenueCheckin.rows[0].checked_in_at).toISOString()).toBe('2026-01-01T09:00:00.000Z');

    const updatedMoodCheckin = await query(
      `SELECT checked_in_at, mood_timezone
       FROM mood_checkins
       WHERE id = $1`,
      [moodCheckinId]
    );
    expect(updatedMoodCheckin.rows[0].mood_timezone).toBe('Europe/Lisbon');
    expect(new Date(updatedMoodCheckin.rows[0].checked_in_at).toISOString()).toBe('2026-01-01T14:30:00.000Z');
  });
});
