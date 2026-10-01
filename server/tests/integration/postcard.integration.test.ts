import request from 'supertest';
import { afterEach, describe, expect, beforeAll, beforeEach, afterAll, it, vi } from 'vitest';
import { createApp } from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';
import * as llmClient from '../../src/services/llmClient';

const app = createApp();

/** A configured LLM (used by both getLlmSettings and the condenser). */
const fakeLlm = {
  api_url: 'http://llm.test/v1',
  model: 'test-model',
  reasoning_level: 'medium',
  context_window: 32768,
  image_support: false,
};

function mockImmichFetch() {
  return vi.fn(async (_url: unknown, _init?: unknown) => {
    // The postcard route only calls fetch for Immich metadata (the LLM is
    // mocked via the llmClient module). Return a small pool of images.
    return {
      ok: true,
      status: 200,
      json: async () => ({
        assets: {
          items: Array.from({ length: 12 }, (_, i) => ({
            id: `img-${i}`,
            originalFileName: `IMG_${i}.jpg`,
            localDateTime: `2026-03-0${(i % 5) + 1}T10:00:00.000Z`,
          })),
        },
      }),
    };
  });
}

describe('Postcard From Your Past (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
    vi.spyOn(llmClient, 'getLlmSettings').mockResolvedValue(fakeLlm);
    // The data is small (well within budget), so no digest call happens; the
    // single postcard call returns a fixed two-paragraph message.
    vi.spyOn(llmClient, 'callLlm').mockResolvedValue(
      'Hello there. This was a remarkable stretch of your life.\n\nTake a moment to remember it fondly.'
    );
    vi.stubGlobal('fetch', mockImmichFetch());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  /**
   * Seed a venue, one dense cluster of check-ins (Jan 5-25, 2026 — the only
   * "interesting" period), and one sparse check-in far away (Sep 2025) so the
   * history spans > 6 months and a random macro window always contains the
   * cluster. Every macro window yields top candidates that lie inside the
   * cluster, so the asserted period is deterministic despite the random top-7
   * pick.
   */
  async function seedHistory() {
    // Enable Immich so the collage search runs (the mocked fetch returns 12
    // images; randomSample then trims it to 4-10).
    await query(
      `INSERT INTO user_settings (user_id, immich_url, immich_api_key)
       VALUES ($1, 'http://immich.test', 'test-key')
       ON CONFLICT (user_id) DO UPDATE SET immich_url = EXCLUDED.immich_url, immich_api_key = EXCLUDED.immich_api_key`,
      [DEFAULT_USER_ID]
    );

    const venue = await query(
      `INSERT INTO venues (name, city, country, latitude, longitude)
       VALUES ('Test Cafe', 'Lisbon', 'Portugal', 38.72, -9.14)
       RETURNING id`,
      []
    );
    const venueId = venue.rows[0].id as string;

    const dates: string[] = ['2025-09-15T12:00:00Z']; // sparse outlier
    for (let d = 5; d <= 25; d++) dates.push(`2026-01-${String(d).padStart(2, '0')}T12:00:00Z`);

    for (const at of dates) {
      await query(
        `INSERT INTO checkins (user_id, venue_id, checked_in_at, notes)
         VALUES ($1, $2, $3, 'note')`,
        [DEFAULT_USER_ID, venueId, at]
      );
    }
  }

  it('returns 400 when the LLM is not configured', async () => {
    vi.spyOn(llmClient, 'getLlmSettings').mockResolvedValue(null);
    const res = await request(app).post('/api/v1/llm/postcard').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 400 when there is not enough check-in data', async () => {
    // No check-ins seeded.
    const res = await request(app).post('/api/v1/llm/postcard').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enough check-in data/i);
  });

  it('generates, persists, and returns a postcard', async () => {
    await seedHistory();

    const res = await request(app).post('/api/v1/llm/postcard').send({});
    expect(res.status).toBe(200);
    const body = res.body;

    // Shape.
    expect(body.id).toBeTruthy();
    expect(typeof body.from).toBe('string');
    expect(typeof body.to).toBe('string');
    expect(body.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.from <= body.to).toBe(true);
    expect(body.addressed_to).toBe('Default User');
    expect(body.sender_line).toBe(`${body.addressed_to}, ${body.to.slice(0, 7)}`);
    expect(body.message).toMatch(/remarkable stretch/);
    expect(body.counts).toBeTruthy();

    // Every check-in lives in the Jan 5-25, 2026 cluster, and a candidate
    // window only exists when it contains a check-in — so the period must
    // overlap the cluster. It may extend into empty days on either side, so
    // we assert overlap rather than containment.
    expect(body.from <= '2026-01-25').toBe(true); // starts on/before cluster end
    expect(body.to >= '2026-01-05').toBe(true); // ends on/after cluster start
    expect(body.from >= '2025-09-15').toBe(true); // within the user's history
    // And it is always about the past, never the current month.
    expect(body.to < '2026-09-01').toBe(true);

    // Stamp city = the venue's city (Lisbon), since the cluster is there.
    expect(body.stamp_city).toBe('Lisbon');

    // Collage: 4–10 images sampled from the 12-item Immich pool.
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images.length).toBeGreaterThanOrEqual(4);
    expect(body.images.length).toBeLessThanOrEqual(10);
    for (const img of body.images) {
      expect(img.id).toMatch(/^img-/);
      expect(img.originalFileName).toMatch(/^IMG_/);
    }

    // Persisted.
    const stored = await query('SELECT * FROM postcards WHERE id = $1', [body.id]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].addressed_to).toBe(body.addressed_to);
    expect(stored.rows[0].stamp_city).toBe('Lisbon');
  });

  it('lists postcards newest-first with previews', async () => {
    await seedHistory();
    await request(app).post('/api/v1/llm/postcard').send({});
    await request(app).post('/api/v1/llm/postcard').send({});

    const res = await request(app).get('/api/v1/llm/postcards');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const [newest, oldest] = res.body;
    expect(newest.created_at >= oldest.created_at).toBe(true);
    for (const row of res.body) {
      expect(row.id).toBeTruthy();
      expect(row.message_preview).toBeTruthy();
      expect(row.image_ids).toBeTruthy();
    }
  });

  it('fetches and deletes a single postcard (404 for unknown id)', async () => {
    await seedHistory();
    const created = await request(app).post('/api/v1/llm/postcard').send({});
    const id = created.body.id as string;

    const get = await request(app).get(`/api/v1/llm/postcards/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(id);
    expect(get.body.message).toMatch(/remarkable stretch/);

    const del = await request(app).delete(`/api/v1/llm/postcards/${id}`);
    expect(del.status).toBe(200);

    const afterDelete = await request(app).get(`/api/v1/llm/postcards/${id}`);
    expect(afterDelete.status).toBe(404);

    // Unknown id -> 404.
    const unknown = await request(app).get(
      '/api/v1/llm/postcards/00000000-0000-0000-0000-000000000099'
    );
    expect(unknown.status).toBe(404);
  });
});
