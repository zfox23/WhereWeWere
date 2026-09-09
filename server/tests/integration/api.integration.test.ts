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

    const mediaItemResult = await query(
      `INSERT INTO media_items (user_id, media_type, title)
       VALUES ($1, 'movie', 'Test Film')
       RETURNING id`,
      [DEFAULT_USER_ID]
    );
    const mediaItemId = mediaItemResult.rows[0].id as string;

    const mediaCheckinResult = await query(
      `INSERT INTO media_checkins (user_id, media_item_id, checkin_type, checked_in_at, checkin_timezone)
       VALUES ($1, $2, 'completed', '2026-01-01T15:00:00Z', 'UTC')
       RETURNING id`,
      [DEFAULT_USER_ID, mediaItemId]
    );
    const mediaCheckinId = mediaCheckinResult.rows[0].id as string;

    const uninferableMediaCheckinResult = await query(
      `INSERT INTO media_checkins (user_id, media_item_id, checkin_type, checked_in_at, checkin_timezone)
       VALUES ($1, $2, 'completed', '2026-03-01T12:00:00Z', 'UTC')
       RETURNING id`,
      [DEFAULT_USER_ID, mediaItemId]
    );
    const uninferableMediaCheckinId = uninferableMediaCheckinResult.rows[0].id as string;

    // Fallback anchor: no venue is near 2026-02-10, so the mood check-in below
    // should fall back to the nearest non-venue check-in (this sleep entry).
    const sleepEntryResult = await query(
      `INSERT INTO sleep_entries (user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at)
       VALUES ($1, 1, 'America/Chicago', '2026-02-10T05:00:00Z', '2026-02-10T11:00:00Z')
       RETURNING id`,
      [DEFAULT_USER_ID]
    );
    expect(sleepEntryResult.rows[0].id).toBeTruthy();

    const fallbackMoodCheckinResult = await query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, mood_timezone)
       VALUES ($1, 4, 'near sleep entry', '2026-02-10T06:00:00Z', NULL)
       RETURNING id`,
      [DEFAULT_USER_ID]
    );
    const fallbackMoodCheckinId = fallbackMoodCheckinResult.rows[0].id as string;

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
        expect.objectContaining({
          id: mediaCheckinId,
          type: 'media',
          suggested_timezone: 'Europe/Lisbon',
        }),
        expect.objectContaining({
          id: fallbackMoodCheckinId,
          type: 'mood',
          suggested_timezone: 'America/Chicago',
        }),
      ])
    );

    const fallbackSuggestion = previewResponse.body.suggestions.find(
      (s: { id: string }) => s.id === fallbackMoodCheckinId
    );
    expect(fallbackSuggestion.reason).toContain('sleep entry');
    expect(fallbackSuggestion.reason).toContain('No venue check-in within 24 hours');
    expect(previewResponse.body.uninferable_mood_checkins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: uninferableMoodCheckinId,
          type: 'mood',
        }),
      ])
    );
    expect(previewResponse.body.uninferable_media_checkins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: uninferableMediaCheckinId,
          type: 'media',
        }),
      ])
    );

    const applyResponse = await request(app)
      .post('/api/v1/settings/timestamp-reconciliation/apply')
      .send({
        updates: [
          { id: venueCheckinId, type: 'venue', suggested_timezone: 'Europe/Lisbon' },
          { id: moodCheckinId, type: 'mood', suggested_timezone: 'Europe/Lisbon' },
          { id: mediaCheckinId, type: 'media', suggested_timezone: 'Europe/Lisbon' },
          { id: fallbackMoodCheckinId, type: 'mood', suggested_timezone: 'America/Chicago' },
        ],
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body).toEqual({ updated: 4 });

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

    const updatedFallbackMoodCheckin = await query(
      `SELECT checked_in_at, mood_timezone
       FROM mood_checkins
       WHERE id = $1`,
      [fallbackMoodCheckinId]
    );
    expect(updatedFallbackMoodCheckin.rows[0].mood_timezone).toBe('America/Chicago');
    // 06:00 wall time reinterpreted in America/Chicago (CST, UTC-6 in February) = 12:00Z.
    expect(new Date(updatedFallbackMoodCheckin.rows[0].checked_in_at).toISOString()).toBe('2026-02-10T12:00:00.000Z');

    const updatedMediaCheckin = await query(
      `SELECT checked_in_at, checkin_timezone
       FROM media_checkins
       WHERE id = $1`,
      [mediaCheckinId]
    );
    expect(updatedMediaCheckin.rows[0].checkin_timezone).toBe('Europe/Lisbon');
    // 15:00 wall time is reinterpreted in Europe/Lisbon, which is UTC+0 in January.
    expect(new Date(updatedMediaCheckin.rows[0].checked_in_at).toISOString()).toBe('2026-01-01T15:00:00.000Z');
  });
});
