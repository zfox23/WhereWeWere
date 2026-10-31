import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { pool, query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import { deletePluginData, exportPluginData, importPluginData } from '../../../../server/src/plugins/backup';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { clearRecipeCache } from '../../services/mealie';
import { server } from '../../server';

const app = createApp();
const MEALIE = 'https://mealie.shared.io';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function locationCheckin(userId: string): Promise<string> {
  const venue = await query(`INSERT INTO venues (name, latitude, longitude) VALUES ('Diner', 1, 1) RETURNING id`);
  const checkin = await query('INSERT INTO checkins (user_id, venue_id) VALUES ($1, $2) RETURNING id', [userId, venue.rows[0].id]);
  return checkin.rows[0].id as string;
}

describe('food: one user never sees or touches another user’s meals', () => {
  let other: TestUser;
  let mealId = '';
  let ownerLocation = '';

  const as = (r: request.Test) => r.set('Cookie', other.cookie);
  const ownerMeal = async () =>
    (await query('SELECT user_id, recipe_name, notes, checkin_timezone, mealie_event_id FROM food_checkins WHERE id = $1', [mealId])).rows[0];

  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    clearRecipeCache();
    other = await createTestUser('other');
    ownerLocation = await locationCheckin(DEFAULT_USER_ID);
    const created = await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner', recipe_name: 'Secret stew', notes: 'Private', rating: 4,
      checked_in_at: '2026-10-20T01:00:00Z', checkin_timezone: 'UTC', companions: ['Sam'],
      location_checkin_id: ownerLocation,
    });
    expect(created.status).toBe(201);
    mealId = created.body.id;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(teardownIntegrationDatabase);

  it("treats the owner's meals as missing: list, read, update, delete", async () => {
    const before = await ownerMeal();
    expect((await as(request(app).get('/api/v1/food/checkins'))).body).toEqual([]);
    expect((await as(request(app).get('/api/v1/food/checkins').query({ location_checkin_id: ownerLocation }))).body).toEqual([]);
    expect((await as(request(app).get(`/api/v1/food/checkins/${mealId}`))).status).toBe(404);
    const put = await as(request(app).put(`/api/v1/food/checkins/${mealId}`).send({ meal_type: 'lunch', recipe_name: 'Mine', companions: [] }));
    expect(put.status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/food/checkins/${mealId}`))).status).toBe(404);
    expect(await ownerMeal()).toEqual(before);
    const companions = await query(`SELECT name FROM companions WHERE checkin_type = 'food' AND checkin_id = $1`, [mealId]);
    expect(companions.rows).toEqual([{ name: 'Sam' }]);
  });

  it("counts none of the owner's meals in stats, the timeline or search", async () => {
    const stats = (await as(request(app).get('/api/v1/food/stats'))).body;
    expect(stats).toMatchObject({ total: 0, eaten_out: 0, top_recipes: [] });
    const feed = (await as(request(app).get('/api/v1/timeline').query({ q: 'stew' }))).body as { type: string }[];
    expect(feed.filter((i) => i.type === 'food')).toEqual([]);
    expect((await request(app).get('/api/v1/food/stats')).body.total).toBe(1);
  });

  it("won't link a meal to the owner's location check-in", async () => {
    const res = await as(request(app).post('/api/v1/food/checkins').send({
      meal_type: 'lunch', recipe_name: 'Sandwich', location_checkin_id: ownerLocation,
    }));
    expect(res.status).toBe(400);
    const theirs = await locationCheckin(other.id);
    const ok = await as(request(app).post('/api/v1/food/checkins').send({
      meal_type: 'lunch', recipe_name: 'Sandwich', location_checkin_id: theirs,
    }));
    expect(ok.status).toBe(201);
    const moved = await as(request(app).put(`/api/v1/food/checkins/${ok.body.id}`).send({
      meal_type: 'lunch', recipe_name: 'Sandwich', location_checkin_id: ownerLocation,
    }));
    expect(moved.status).toBe(400);
  });

  it("can't reconcile the owner's meal timezones", async () => {
    expect(await runAsUser(other.id, () => server.reconcile!.apply(mealId, 'Europe/Paris'))).toBe(false);
    expect((await ownerMeal()).checkin_timezone).toBe('UTC');
  });

  it("starts over only the user's own meals", async () => {
    await as(request(app).post('/api/v1/food/checkins').send({ meal_type: 'lunch', recipe_name: 'Theirs', companions: ['Pat'] }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runAsUser(other.id, () => deletePluginData(client, other.id, ['food']));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const rows = await query('SELECT user_id FROM food_checkins');
    expect(rows.rows).toEqual([{ user_id: DEFAULT_USER_ID }]);
    expect((await query(`SELECT name FROM companions WHERE checkin_type = 'food'`)).rows).toEqual([{ name: 'Sam' }]);
  });

  it("restores the owner's backup without taking over the owner's meals or location links", async () => {
    const payload = await exportPluginData(DEFAULT_USER_ID);
    const before = await ownerMeal();
    // A second meal under a fresh id: it comes across, minus the owner's place.
    const extra = { ...(payload.food.checkins as Record<string, unknown>[])[0], id: '5f5f5f5f-0000-4000-8000-000000000001' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runAsUser(other.id, () => importPluginData(client, other.id, {
        food: { ...payload.food, checkins: [...(payload.food.checkins as unknown[]), extra] },
      }));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await ownerMeal()).toEqual(before);
    const theirs = (await query('SELECT id, user_id, location_checkin_id FROM food_checkins WHERE user_id = $1', [other.id])).rows;
    expect(theirs).toEqual([{ id: extra.id, user_id: other.id, location_checkin_id: null }]);
  });

  it("doesn't let the other user poll the owner's suggestion task", async () => {
    await query(
      `INSERT INTO user_settings (user_id, llm_api_url, llm_model, llm_context_window) VALUES ($1, 'http://llm.test/v1', 'test', 32768)
       ON CONFLICT (user_id) DO UPDATE SET llm_api_url = EXCLUDED.llm_api_url, llm_model = EXCLUDED.llm_model`,
      [DEFAULT_USER_ID],
    );
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '{"suggestions": []}' } }] })));
    const started = await request(app).post('/api/v1/food/suggestions').send({
      meal_types: ['dinner'], days: 1, start_date: '2026-10-28', variety: 'balanced', timezone: 'UTC',
    });
    expect(started.status).toBe(202);
    expect((await as(request(app).get(`/api/v1/food/suggestions/${started.body.task_id}`))).status).toBe(404);
    expect((await request(app).get(`/api/v1/food/suggestions/${started.body.task_id}`)).status).toBe(200);
  });

  it("doesn't serve the owner's cached recipe list to another token on the same Mealie", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      if (String(input).startsWith(`${MEALIE}/api/recipes?`)) {
        return auth === 'Bearer owner-token'
          ? json({ items: [{ id: 'r1', slug: 'secret-stew', name: 'Secret Stew' }], total_pages: 1 })
          : json({ detail: 'Unauthorized' }, 401);
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await request(app).put('/api/v1/plugins/food/settings').send({ mealie_url: MEALIE, mealie_api_token: 'owner-token' });
    await as(request(app).put('/api/v1/plugins/food/settings').send({ mealie_url: MEALIE, mealie_api_token: 'wrong-token' }));
    expect((await request(app).get('/api/v1/food/mealie/recipes')).body.recipes).toHaveLength(1);
    const theirs = await as(request(app).get('/api/v1/food/mealie/recipes'));
    expect(theirs.status).toBe(502);
    expect(JSON.stringify(theirs.body)).not.toContain('Secret Stew');
  });
});
