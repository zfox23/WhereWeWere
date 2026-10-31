import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { pool, query } from '../../../../server/src/db';
import { deletePluginData, exportPluginData, importPluginData } from '../../../../server/src/plugins/backup';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { clearRecipeCache } from '../../services/mealie';

const app = createApp();
const MEALIE = 'https://mealie.mydomain.io';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Routes stubbed external calls (Mealie, Open-Meteo, the LLM) by URL. */
function stubExternal(llmReply?: string) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith(`${MEALIE}/api/recipes?`)) {
      return json({
        items: [
          { id: 'r1', slug: 'black-bean-soup', name: 'Black Bean Soup', totalTime: '40 min' },
          { id: 'r2', slug: 'fish-tacos', name: 'Fish Tacos' },
        ],
        total_pages: 1,
      });
    }
    if (url === `${MEALIE}/api/users/self`) return json({ groupSlug: 'home' });
    if (url === `${MEALIE}/api/recipes/timeline/events` && method === 'POST') return json({ id: 'evt-1' });
    if (url.startsWith(`${MEALIE}/api/recipes/timeline/events/`)) return json({});
    if (url.startsWith(`${MEALIE}/api/households/self/recipes/`)) return json({ lastMade: null });
    if (url.endsWith('/last-made')) return json({});
    if (url === `${MEALIE}/api/households/mealplans`) return json({ id: 42 });
    if (url.startsWith('https://api.open-meteo.com/')) {
      return json({ daily: { time: ['2026-10-28'], temperature_2m_max: [8], temperature_2m_min: [1], precipitation_probability_max: [90], weather_code: [63] } });
    }
    if (url === 'http://llm.test/v1/chat/completions') {
      return json({ choices: [{ message: { content: llmReply ?? '' }, finish_reason: 'stop' }] });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function configureMealie() {
  const res = await request(app).put('/api/v1/plugins/food/settings').send({ mealie_url: MEALIE, mealie_api_token: 'tok' });
  expect(res.status).toBe(200);
}

/** A location check-in owned by `userId`, for meals eaten out to point at. */
async function locationCheckin(userId: string): Promise<string> {
  const venue = await query(`INSERT INTO venues (name, latitude, longitude) VALUES ('Thai Place', 13.75, 100.5) RETURNING id`);
  const checkin = await query('INSERT INTO checkins (user_id, venue_id) VALUES ($1, $2) RETURNING id', [userId, venue.rows[0].id]);
  return checkin.rows[0].id as string;
}

const calls = (fetchMock: ReturnType<typeof stubExternal>) =>
  fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u).replace(MEALIE, '')}`);

describe('Food plugin (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    clearRecipeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('creates, reads, edits and deletes a free-text meal with companions, without touching Mealie', async () => {
    const locationId = await locationCheckin(DEFAULT_USER_ID);
    const created = await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner',
      recipe_name: 'Pad thai',
      rating: 3,
      notes: 'Spicy',
      location_checkin_id: locationId,
      checked_in_at: '2026-10-20T01:30:00.000Z',
      checkin_timezone: 'America/Los_Angeles',
      companions: ['Sam', ' sam ', 'Alex'],
    });
    expect(created.status).toBe(201);
    expect(created.body.mealie_sync).toEqual({ status: 'skipped' });
    expect(created.body.companions).toEqual(['Alex', 'Sam']);
    const id = created.body.id as string;

    const byLocation = await request(app).get(`/api/v1/food/checkins?location_checkin_id=${locationId}`);
    expect(byLocation.body.map((r: { id: string }) => r.id)).toEqual([id]);

    const timeline = await request(app).get('/api/v1/timeline?from=2026-10-19&to=2026-10-19');
    const item = timeline.body.find((r: { type: string }) => r.type === 'food');
    expect(item).toMatchObject({
      id,
      notes: 'Spicy',
      timezone: 'America/Los_Angeles',
      companions: ['Alex', 'Sam'],
      data: { meal_type: 'dinner', recipe_name: 'Pad thai', rating: 3, location_checkin_id: locationId },
    });

    const updated = await request(app).put(`/api/v1/food/checkins/${id}`).send({
      meal_type: 'lunch', recipe_name: 'Pad see ew', companions: ['Alex'], checked_in_at: created.body.checked_in_at,
      location_checkin_id: locationId,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ meal_type: 'lunch', recipe_name: 'Pad see ew', rating: null, companions: ['Alex'] });

    const stats = await request(app).get('/api/v1/food/stats');
    expect(stats.body).toMatchObject({ total: 1, eaten_out: 1, at_home: 0, by_meal_type: { lunch: 1, dinner: 0 } });

    expect((await request(app).delete(`/api/v1/food/checkins/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/food/checkins/${id}`)).status).toBe(404);
    const leftover = await query(`SELECT COUNT(*)::int AS n FROM companions WHERE checkin_type = 'food'`);
    expect(leftover.rows[0].n).toBe(0);
  });

  it('rejects invalid meals', async () => {
    const res = await request(app).post('/api/v1/food/checkins').send({ meal_type: 'brunch', recipe_name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/meal_type/);
  });

  it('marks a Mealie recipe as made, then removes the timeline event on delete', async () => {
    await configureMealie();
    const fetchMock = stubExternal();

    const created = await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner', recipe_name: 'Black Bean Soup', mealie_recipe_id: 'r1', mealie_recipe_slug: 'black-bean-soup',
    });
    expect(created.body.mealie_sync).toEqual({ status: 'synced' });
    expect(created.body.mealie_event_id).toBe('evt-1');
    expect(calls(fetchMock)).toEqual([
      'POST /api/recipes/timeline/events',
      'GET /api/households/self/recipes/black-bean-soup',
      'PATCH /api/recipes/black-bean-soup/last-made',
    ]);

    fetchMock.mockClear();
    await request(app).delete(`/api/v1/food/checkins/${created.body.id}`);
    expect(calls(fetchMock)).toEqual(['DELETE /api/recipes/timeline/events/evt-1']);
  });

  it('still saves when Mealie is down', async () => {
    await configureMealie();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const created = await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner', recipe_name: 'Fish Tacos', mealie_recipe_id: 'r2', mealie_recipe_slug: 'fish-tacos',
    });
    expect(created.status).toBe(201);
    expect(created.body.mealie_sync.status).toBe('failed');
    expect((await request(app).get(`/api/v1/food/checkins/${created.body.id}`)).status).toBe(200);
  });

  it('proxies the recipe library and status, and adds suggestions to the meal plan', async () => {
    await configureMealie();
    const fetchMock = stubExternal();

    const status = await request(app).get('/api/v1/food/mealie/status');
    expect(status.body).toMatchObject({ configured: true, reachable: true, group_slug: 'home', create_recipe_url: `${MEALIE}/g/home/r/create/url` });

    const recipes = await request(app).get('/api/v1/food/mealie/recipes');
    expect(recipes.body.recipes.map((r: { slug: string }) => r.slug)).toEqual(['black-bean-soup', 'fish-tacos']);

    fetchMock.mockClear();
    const plan = await request(app).post('/api/v1/food/mealie/mealplan').send({
      entries: [
        { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r1', title: 'Black Bean Soup' },
        { date: '2026-10-29', meal_type: 'dinner', recipe_id: null, title: 'Risotto', reason: 'Something new' },
      ],
    });
    expect(plan.body.results).toEqual([{ ok: true, id: '42' }, { ok: true, id: '42' }]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      { date: '2026-10-28', entryType: 'dinner', recipeId: 'r1' },
      { date: '2026-10-29', entryType: 'dinner', title: 'Risotto', text: 'Something new' },
    ]);
  });

  it('generates suggestions from history, the library and the forecast', async () => {
    await configureMealie();
    await query(
      `UPDATE user_settings SET llm_api_url = 'http://llm.test/v1', llm_model = 'test', llm_context_window = 32768 WHERE user_id = $1`,
      [DEFAULT_USER_ID],
    );
    await query(`INSERT INTO user_settings (user_id, llm_api_url, llm_model, llm_context_window)
                 SELECT $1, 'http://llm.test/v1', 'test', 32768
                 WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = $1)`, [DEFAULT_USER_ID]);
    const fetchMock = stubExternal(JSON.stringify({
      suggestions: [
        { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r1', title: 'Black Bean Soup', reason: 'Cold and rainy.' },
        { date: '2026-10-29', meal_type: 'dinner', recipe_id: null, title: 'Mushroom risotto', reason: 'Something new.' },
      ],
    }));
    await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner', recipe_name: 'Fish Tacos', mealie_recipe_id: 'r2', mealie_recipe_slug: 'fish-tacos',
      rating: 4, checked_in_at: '2026-10-25T00:00:00.000Z', checkin_timezone: 'UTC',
    });

    const started = await request(app).post('/api/v1/food/suggestions').send({
      meal_types: ['dinner'], days: 2, start_date: '2026-10-28', variety: 'balanced',
      timezone: 'UTC', latitude: 40.7, longitude: -74,
    });
    expect(started.status).toBe(202);

    let poll = { body: { status: 'running' } } as { body: Record<string, any> };
    for (let i = 0; i < 50 && poll.body.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      poll = await request(app).get(`/api/v1/food/suggestions/${started.body.task_id}`);
    }
    expect(poll.body.status).toBe('done');
    expect(poll.body.result).toMatchObject({ weather: true, library_size: 2, missing: [] });
    expect(poll.body.result.suggestions.map((s: { kind: string; title: string }) => [s.kind, s.title])).toEqual([
      ['recipe', 'Black Bean Soup'],
      ['idea', 'Mushroom risotto'],
    ]);

    const llmCall = fetchMock.mock.calls.find(([u]) => String(u).includes('chat/completions'))!;
    const prompt = JSON.parse(String(llmCall[1]?.body)).messages[1].content as string;
    expect(prompt).toContain('2026-10-28 (Wednesday): dinner — rain');
    expect(prompt).toContain('id=r2 | "Fish Tacos" | their rating 4.0/4 | last made 2026-10-25 | made 1x');
    expect(prompt).toContain('2026-10-25 (Sun) dinner: Fish Tacos [id=r2] (rated 4/4)');
  });

  it('round-trips through backup and is removed by start-over', async () => {
    const created = await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'breakfast', recipe_name: 'Pancakes', companions: ['Kai'],
    });
    const id = created.body.id as string;

    const payload = await exportPluginData(DEFAULT_USER_ID);
    expect(payload.food.checkins).toHaveLength(1);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM food_checkins');
      const counts = await importPluginData(client, DEFAULT_USER_ID, { food: payload.food });
      expect(counts.food.inserted).toBe(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await request(app).get(`/api/v1/food/checkins/${id}`)).body.recipe_name).toBe('Pancakes');

    const startOver = await pool.connect();
    try {
      await startOver.query('BEGIN');
      const counts = await deletePluginData(startOver, DEFAULT_USER_ID, ['food']);
      await startOver.query('COMMIT');
      expect(counts.food).toBe(2); // the check-in + its companion row
    } finally {
      startOver.release();
    }
    const left = await query('SELECT COUNT(*)::int AS n FROM food_checkins');
    expect(left.rows[0].n).toBe(0);
  });
});
