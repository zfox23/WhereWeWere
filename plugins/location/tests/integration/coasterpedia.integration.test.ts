import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCoasterpediaBackfill, pendingBackfillVenueIds } from '../../services/coasterpediaEnrich';
import { createApp } from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';

const app = createApp();

const ATTRACTION = {
  id: 165,
  name: 'Batman The Ride',
  url: 'https://coasterpedia.net/wiki/Batman_The_Ride',
  type: 'coaster',
  status: 'operating',
  stats: { height: { value: 31.4, unit: 'm' } },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stub Coasterpedia only; anything else (e.g. geocoding) fails fast as offline. */
function stubCoasterpedia(search: unknown[], attraction: unknown = ATTRACTION) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/attractions?q=')) return jsonResponse({ data: search });
    const m = url.match(/\/attractions\/(\d+)$/);
    if (m) return jsonResponse({ data: attraction });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Calls to Coasterpedia only; venue creation also geocodes through the stubbed fetch. */
const coasterpediaCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('api.coasterpedia.net')).length;

async function setKey(key: string | null) {
  await query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
     VALUES ($1, 'location', 'coasterpedia_api_key', $2::jsonb)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [DEFAULT_USER_ID, JSON.stringify(key)],
  );
}

async function category(name: string) {
  const r = await query(`INSERT INTO venue_categories (name) VALUES ($1) RETURNING id`, [name]);
  return r.rows[0].id as string;
}

async function createVenue(name: string, categoryId: string) {
  const res = await request(app)
    .post('/api/v1/venues')
    .send({ name, category_id: categoryId, latitude: 41.5, longitude: -81.6, country: 'USA' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function waitForRow(venueId: string) {
  for (let i = 0; i < 50; i++) {
    const r = await query('SELECT * FROM venue_coasterpedia WHERE venue_id = $1', [venueId]);
    if (r.rows.length > 0) return r.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe('Coasterpedia enrichment (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('looks a new Amusement Ride venue up after save and shows it on the venue page', async () => {
    await setKey('cpk_test');
    stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));

    const row = await waitForRow(venueId);
    expect(row).toMatchObject({ status: 'matched', attraction_id: 165 });

    const res = await request(app).get(`/api/v1/venues/${venueId}`);
    expect(res.body.coasterpedia).toMatchObject({ has_key: true, status: 'matched', attraction_id: 165 });
    expect(res.body.coasterpedia.data.name).toBe('Batman The Ride');
  });

  it('does not look up venues in other categories', async () => {
    await setKey('cpk_test');
    const fetchMock = stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Park'));

    await new Promise((r) => setTimeout(r, 300));
    expect((await query('SELECT 1 FROM venue_coasterpedia WHERE venue_id = $1', [venueId])).rows).toHaveLength(0);
    expect(coasterpediaCalls(fetchMock)).toBe(0);
    const res = await request(app).get(`/api/v1/venues/${venueId}`);
    expect(res.body.coasterpedia).toBeUndefined();
  });

  it('does nothing without an API key, and the page says so', async () => {
    const fetchMock = stubCoasterpedia([]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));

    await new Promise((r) => setTimeout(r, 300));
    expect(coasterpediaCalls(fetchMock)).toBe(0);
    const res = await request(app).get(`/api/v1/venues/${venueId}`);
    expect(res.body.coasterpedia).toMatchObject({ has_key: false, status: null });
  });

  it('stores candidates when ambiguous and lets the user select one by ID or URL', async () => {
    await setKey('cpk_test');
    stubCoasterpedia([
      { id: 165, name: 'Batman The Ride' },
      { id: 169, name: 'Batman The Ride' },
    ]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));

    const row = await waitForRow(venueId);
    expect(row.status).toBe('ambiguous');
    expect(row.candidates).toHaveLength(2);

    const bad = await request(app).post(`/api/v1/venues/${venueId}/coasterpedia/select`).send({ attractionId: 'nope' });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post(`/api/v1/venues/${venueId}/coasterpedia/select`)
      .send({ attractionId: 'https://api.coasterpedia.net/v1/attractions/165' });
    expect(ok.status).toBe(200);
    const after = await query('SELECT status, attraction_id FROM venue_coasterpedia WHERE venue_id = $1', [venueId]);
    expect(after.rows[0]).toMatchObject({ status: 'matched', attraction_id: 165 });
  });

  it('keeps the last good record when a refresh fails', async () => {
    await setKey('cpk_test');
    stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));
    await waitForRow(venueId);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    const res = await request(app).post(`/api/v1/venues/${venueId}/coasterpedia/refresh`);
    expect(res.status).toBe(200);

    const row = (await query('SELECT * FROM venue_coasterpedia WHERE venue_id = $1', [venueId])).rows[0];
    expect(row.status).toBe('error');
    expect(row.error).toMatch(/500/);
    expect(row.attraction_id).toBe(165);
    expect(row.data.name).toBe('Batman The Ride');
  });

  it('re-runs the lookup on save only when the name changed', async () => {
    await setKey('cpk_test');
    const fetchMock = stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));
    await waitForRow(venueId);
    const calls = coasterpediaCalls(fetchMock);

    await request(app).put(`/api/v1/venues/${venueId}`).send({ rating: 3 });
    await new Promise((r) => setTimeout(r, 300));
    expect(coasterpediaCalls(fetchMock)).toBe(calls);

    await request(app).put(`/api/v1/venues/${venueId}`).send({ name: 'Batman: The Ride' });
    await vi.waitFor(() => expect(coasterpediaCalls(fetchMock)).toBeGreaterThan(calls));
  });

  it('rejects refresh for non-ride venues', async () => {
    await setKey('cpk_test');
    const venueId = await createVenue('Some Park', await category('Park'));
    const res = await request(app).post(`/api/v1/venues/${venueId}/coasterpedia/refresh`);
    expect(res.status).toBe(400);
  });

  it('clears the stored record when Coasterpedia has deleted it', async () => {
    await setKey('cpk_test');
    stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));
    await waitForRow(venueId);

    const gone = new Response(JSON.stringify({ type: 'https://api.coasterpedia.net/problems/not-found', status: 404 }), {
      status: 404,
      headers: { 'content-type': 'application/problem+json' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => gone.clone()));
    await request(app).post(`/api/v1/venues/${venueId}/coasterpedia/refresh`);

    const row = (await query('SELECT * FROM venue_coasterpedia WHERE venue_id = $1', [venueId])).rows[0];
    expect(row).toMatchObject({ status: 'no_match', data: null, attraction_id: null });
    expect(row.error).toMatch(/removed from Coasterpedia/);
  });

  it('keeps the old match when the ID the user typed does not exist', async () => {
    await setKey('cpk_test');
    stubCoasterpedia([{ id: 165, name: 'Batman The Ride' }]);
    const venueId = await createVenue('Batman The Ride', await category('Amusement Ride'));
    await waitForRow(venueId);

    const gone = new Response(JSON.stringify({ type: 'https://api.coasterpedia.net/problems/not-found', status: 404 }), {
      status: 404,
      headers: { 'content-type': 'application/problem+json' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => gone.clone()));
    await request(app).post(`/api/v1/venues/${venueId}/coasterpedia/select`).send({ attractionId: 999999 });

    const row = (await query('SELECT * FROM venue_coasterpedia WHERE venue_id = $1', [venueId])).rows[0];
    expect(row).toMatchObject({ status: 'error', attraction_id: 165 });
    expect(row.data.name).toBe('Batman The Ride');
  });

  it('backfill picks up never-looked-up and failed rides, skipping matched ones', async () => {
    await setKey('cpk_test');
    const ride = await category('Amusement Ride');
    const fetchMock = stubCoasterpedia([{ id: 165, name: 'Alpha' }]);
    const matched = await createVenue('Alpha', ride);
    await waitForRow(matched);

    // Created before a key existed: no row yet. Another whose lookup failed.
    await query(`DELETE FROM plugin_settings WHERE plugin_id = 'location'`);
    const fresh = await createVenue('Beta', ride);
    const failed = await createVenue('Gamma', ride);
    await setKey('cpk_test');
    await query(
      `INSERT INTO venue_coasterpedia (venue_id, user_id, status, error) VALUES ($1, $2, 'error', 'boom')`,
      [failed, DEFAULT_USER_ID],
    );

    const ids = await pendingBackfillVenueIds();
    expect(ids.sort()).toEqual([fresh, failed].sort());

    const before = coasterpediaCalls(fetchMock);
    const progress: number[] = [];
    await runCoasterpediaBackfill(ids, DEFAULT_USER_ID, { delayMs: 0, onProgress: (done) => { progress.push(done); } });
    expect(progress).toEqual([1, 2]);
    expect(coasterpediaCalls(fetchMock) - before).toBeGreaterThanOrEqual(2);
    expect(await pendingBackfillVenueIds()).toEqual([]);
  });

  it('backfill paces requests and stops on a revoked key', async () => {
    await setKey('cpk_test');
    const ride = await category('Amusement Ride');
    await query(`DELETE FROM plugin_settings WHERE plugin_id = 'location'`);
    const a = await createVenue('Alpha', ride);
    const b = await createVenue('Beta', ride);
    // Let the post-save lookups from createVenue finish (they bail without a key)
    // so they can't pick the key up below and add their own requests.
    await new Promise((r) => setTimeout(r, 300));
    await setKey('cpk_test');

    const revoked = new Response(JSON.stringify({ type: 'https://api.coasterpedia.net/problems/key-revoked', status: 403 }), {
      status: 403,
      headers: { 'content-type': 'application/problem+json' },
    });
    const fetchMock = vi.fn(async () => revoked.clone());
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCoasterpediaBackfill([a, b], DEFAULT_USER_ID, { delayMs: 0 })).rejects.toThrow(/revoked/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const times: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      times.push(Date.now());
      return jsonResponse({ data: String(input).includes('?q=') ? [] : {} });
    }));
    await runCoasterpediaBackfill([a, b], DEFAULT_USER_ID, { delayMs: 200 });
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(190);
  });
});
