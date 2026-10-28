/**
 * Food check-in type — server half.
 *
 * CUSTOM storage (`food_checkins`, migration 071): a food check-in carries
 * companions (shared core table), an optional link to a location check-in,
 * and Mealie writeback on save/delete, none of which the generic store has
 * hooks for.
 *
 * Mounted at /api/v1/food:
 *   GET/POST        /checkins          list (?location_checkin_id=) / create
 *   GET/PUT/DELETE  /checkins/:id
 *   GET             /stats             Profile > Food headline numbers
 *   GET             /mealie/status     configured? + front-end links
 *   GET             /mealie/recipes    the recipe library (?refresh=1)
 *   POST            /mealie/mealplan   add suggestions to Mealie's meal plan
 *   POST            /suggestions       start an LLM suggestion run (202 + task id)
 *   GET             /suggestions/:id   poll it
 *
 * Mealie writeback is best-effort: a save never fails because Mealie is down;
 * the response carries a `mealie_sync` status the form shows instead.
 */

import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import type {
  CheckinTypeServerPlugin,
  PluginLlmRow,
  PluginReconciliationRow,
  PluginTimelineContext,
} from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { isUuid } from '../../server/src/services/batching';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';
import {
  companionNamesSql,
  deleteCompanionsForCheckins,
  getCompanions,
  getCompanionsByCheckin,
  insertCompanions,
  setCompanions,
} from '../../server/src/services/companions';
import { callLlm, finalCharBudget, getLlmSettings } from '../../server/src/services/llmClient';
import { MEAL_TYPES, MEAL_TYPE_LABELS, isMealType, type MealType } from './manifest';
import {
  MealieError,
  bumpLastMade,
  createMadeThisEvent,
  createMealPlanEntry,
  createRecipeUrl,
  deleteMadeThisEvent,
  getGroupSlug,
  getMealieConfig,
  getRecipesCached,
  updateMadeThisEvent,
  type MealieConfig,
} from './services/mealie';
import { MAX_FORECAST_DAYS, fetchForecast, type ForecastDay } from './services/forecast';
import {
  HISTORY_DAYS,
  MAX_SUGGESTION_DAYS,
  addDays,
  buildPrompt,
  buildSlots,
  isVariety,
  parseSuggestions,
  type HistoryMeal,
  type LibraryRecipe,
  type ParsedSuggestions,
} from './services/suggest';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 200;

const router = Router();

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface FoodRow {
  id: string;
  user_id: string;
  meal_type: MealType;
  recipe_name: string;
  mealie_recipe_id: string | null;
  mealie_recipe_slug: string | null;
  rating: number | null;
  notes: string | null;
  location_checkin_id: string | null;
  mealie_event_id: string | null;
  checked_in_at: string | Date;
  checkin_timezone: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const FOOD_COLUMNS = `id, user_id, meal_type, recipe_name, mealie_recipe_id, mealie_recipe_slug,
  rating, notes, location_checkin_id, mealie_event_id, checked_in_at, checkin_timezone,
  created_at, updated_at`;

/** Shared INSERT for backup restore (idempotent on id). */
const FOOD_INSERT_SQL = `
  INSERT INTO food_checkins (${FOOD_COLUMNS})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          COALESCE($13::timestamptz, NOW()), COALESCE($14::timestamptz, NOW()))
  ON CONFLICT (id) DO NOTHING`;

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function isoOf(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface FoodInput {
  meal_type: MealType;
  recipe_name: string;
  mealie_recipe_id: string | null;
  mealie_recipe_slug: string | null;
  rating: number | null;
  notes: string | null;
  location_checkin_id: string | null;
  checked_in_at: string;
  checkin_timezone: string | null;
}

class InputError extends Error {}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new InputError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InputError(`${field} is too long (max ${max} characters)`);
  return trimmed || null;
}

export function parseFoodInput(body: Record<string, unknown>): FoodInput {
  if (!isMealType(body.meal_type)) {
    throw new InputError(`meal_type must be one of ${MEAL_TYPES.join(', ')}`);
  }
  const recipeName = optionalText(body.recipe_name, 'recipe_name', MAX_NAME_LENGTH);
  if (!recipeName) throw new InputError('Pick a recipe or describe what you ate');

  const recipeId = optionalText(body.mealie_recipe_id, 'mealie_recipe_id', 100);
  const recipeSlug = optionalText(body.mealie_recipe_slug, 'mealie_recipe_slug', 300);
  if (Boolean(recipeId) !== Boolean(recipeSlug)) {
    throw new InputError('mealie_recipe_id and mealie_recipe_slug go together');
  }

  let rating: number | null = null;
  if (body.rating != null && body.rating !== 0) {
    const n = Number(body.rating);
    if (!Number.isInteger(n) || n < 1 || n > 4) throw new InputError('rating must be 1-4');
    rating = n;
  }

  const locationId = body.location_checkin_id == null || body.location_checkin_id === '' ? null : body.location_checkin_id;
  if (locationId !== null && !isUuid(locationId)) throw new InputError('location_checkin_id must be a uuid');

  let checkedInAt = new Date().toISOString();
  if (body.checked_in_at != null) {
    const d = new Date(String(body.checked_in_at));
    if (Number.isNaN(d.getTime())) throw new InputError('checked_in_at must be a valid date-time');
    checkedInAt = d.toISOString();
  }

  const tz = body.checkin_timezone ?? body.timezone ?? null;
  if (tz !== null && (typeof tz !== 'string' || !isValidTimeZone(tz))) {
    throw new InputError('checkin_timezone must be a valid IANA timezone');
  }

  return {
    meal_type: body.meal_type,
    recipe_name: recipeName,
    mealie_recipe_id: recipeId,
    mealie_recipe_slug: recipeSlug,
    rating,
    notes: optionalText(body.notes, 'notes', 20_000),
    location_checkin_id: locationId as string | null,
    checked_in_at: checkedInAt,
    checkin_timezone: tz as string | null,
  };
}

// ---------------------------------------------------------------------------
// Mealie "made this" writeback
// ---------------------------------------------------------------------------

export interface MealieSync {
  status: 'synced' | 'skipped' | 'failed';
  message?: string;
}

/**
 * Bring Mealie in line with a check-in change: `prev` is the row before the
 * change (null on create), `next` the row after (null on delete). Returns
 * the timeline event id `next` should store. Never throws.
 */
export async function syncMealie(
  config: MealieConfig | null,
  prev: FoodRow | null,
  next: FoodRow | null,
): Promise<{ eventId: string | null; sync: MealieSync }> {
  const touchesMealie = Boolean(prev?.mealie_event_id || next?.mealie_recipe_id);
  if (!touchesMealie) return { eventId: null, sync: { status: 'skipped' } };
  if (!config) {
    // Keep any stored event id so a later save (once configured) can clean it up.
    return {
      eventId: prev?.mealie_event_id ?? null,
      sync: { status: 'skipped', message: 'Mealie is not configured, so nothing was written there.' },
    };
  }

  const sameRecipeAndTime = Boolean(
    prev && next && prev.mealie_event_id
      && prev.mealie_recipe_id === next.mealie_recipe_id
      && isoOf(prev.checked_in_at) === isoOf(next.checked_in_at),
  );
  let eventId = prev?.mealie_event_id ?? null;
  try {
    if (next?.mealie_recipe_id && next.mealie_recipe_slug) {
      const input = {
        recipeId: next.mealie_recipe_id,
        recipeSlug: next.mealie_recipe_slug,
        madeAt: isoOf(next.checked_in_at),
        mealLabel: MEAL_TYPE_LABELS[next.meal_type],
        notes: next.notes,
      };
      if (sameRecipeAndTime && eventId) {
        await updateMadeThisEvent(config, eventId, input);
      } else {
        // Mealie can't move an event's timestamp or recipe: replace it.
        if (eventId) await deleteMadeThisEvent(config, eventId);
        eventId = null;
        eventId = await createMadeThisEvent(config, input);
        await bumpLastMade(config, input.recipeSlug, input.madeAt);
      }
    } else if (eventId) {
      // Deleted, or switched to a meal that isn't a Mealie recipe.
      await deleteMadeThisEvent(config, eventId);
      eventId = null;
    }
    return { eventId, sync: { status: 'synced' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mealie request failed';
    console.error('Mealie writeback failed:', message);
    return { eventId, sync: { status: 'failed', message: `Saved, but Mealie was not updated: ${message}` } };
  }
}

async function storeEventId(id: string, eventId: string | null): Promise<void> {
  await query('UPDATE food_checkins SET mealie_event_id = $2 WHERE id = $1', [id, eventId]);
}

// ---------------------------------------------------------------------------
// Check-in CRUD
// ---------------------------------------------------------------------------

function sendError(res: Response, err: unknown, fallback: string) {
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

async function loadRow(id: string): Promise<FoodRow | null> {
  const result = await query(`SELECT ${FOOD_COLUMNS} FROM food_checkins WHERE id = $1 AND user_id = $2`, [id, USER_ID]);
  return (result.rows[0] as FoodRow | undefined) ?? null;
}

router.get('/checkins', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const params: unknown[] = [USER_ID];
    let where = 'user_id = $1';
    if (req.query.location_checkin_id) {
      if (!isUuid(req.query.location_checkin_id)) return res.status(400).json({ error: 'location_checkin_id must be a uuid' });
      params.push(req.query.location_checkin_id);
      where += ` AND location_checkin_id = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await query(
      `SELECT ${FOOD_COLUMNS} FROM food_checkins WHERE ${where}
       ORDER BY checked_in_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const companions = await getCompanionsByCheckin('food', result.rows.map((r) => r.id as string));
    res.json(result.rows.map((r) => ({ ...r, companions: companions.get(r.id) ?? [] })));
  } catch (err) {
    sendError(res, err, 'Failed to list food check-ins');
  }
});

router.get('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Check-in not found' });
  try {
    const row = await loadRow(id);
    if (!row) return res.status(404).json({ error: 'Check-in not found' });
    res.json({ ...row, companions: await getCompanions('food', id) });
  } catch (err) {
    sendError(res, err, 'Failed to get food check-in');
  }
});

router.post('/checkins', async (req: Request, res: Response) => {
  try {
    const input = parseFoodInput(req.body ?? {});
    const client = await pool.connect();
    let row: FoodRow;
    let companions: string[];
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO food_checkins (user_id, meal_type, recipe_name, mealie_recipe_id, mealie_recipe_slug,
           rating, notes, location_checkin_id, checked_in_at, checkin_timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${FOOD_COLUMNS}`,
        [USER_ID, input.meal_type, input.recipe_name, input.mealie_recipe_id, input.mealie_recipe_slug,
          input.rating, input.notes, input.location_checkin_id, input.checked_in_at, input.checkin_timezone],
      );
      row = result.rows[0] as FoodRow;
      await insertCompanions('food', row.id, req.body?.companions, client);
      companions = await getCompanions('food', row.id, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { eventId, sync } = await syncMealie(await getMealieConfig(USER_ID), null, row);
    if (eventId) {
      await storeEventId(row.id, eventId);
      row.mealie_event_id = eventId;
    }
    res.status(201).json({ ...row, companions, mealie_sync: sync });
  } catch (err) {
    sendError(res, err, 'Failed to create food check-in');
  }
});

router.put('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Check-in not found' });
  try {
    const input = parseFoodInput(req.body ?? {});
    const prev = await loadRow(id);
    if (!prev) return res.status(404).json({ error: 'Check-in not found' });

    const client = await pool.connect();
    let row: FoodRow;
    let companions: string[];
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE food_checkins
         SET meal_type = $3, recipe_name = $4, mealie_recipe_id = $5, mealie_recipe_slug = $6,
             rating = $7, notes = $8, location_checkin_id = $9, checked_in_at = $10, checkin_timezone = $11
         WHERE id = $1 AND user_id = $2
         RETURNING ${FOOD_COLUMNS}`,
        [id, USER_ID, input.meal_type, input.recipe_name, input.mealie_recipe_id, input.mealie_recipe_slug,
          input.rating, input.notes, input.location_checkin_id, input.checked_in_at, input.checkin_timezone],
      );
      row = result.rows[0] as FoodRow;
      companions = await setCompanions('food', id, req.body?.companions, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { eventId, sync } = await syncMealie(await getMealieConfig(USER_ID), prev, row);
    if (eventId !== row.mealie_event_id) {
      await storeEventId(id, eventId);
      row.mealie_event_id = eventId;
    }
    res.json({ ...row, companions, mealie_sync: sync });
  } catch (err) {
    sendError(res, err, 'Failed to update food check-in');
  }
});

router.delete('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Check-in not found' });
  try {
    const prev = await loadRow(id);
    if (!prev) return res.status(404).json({ error: 'Check-in not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteCompanionsForCheckins('food', [id], client);
      await client.query('DELETE FROM food_checkins WHERE id = $1 AND user_id = $2', [id, USER_ID]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const { sync } = await syncMealie(await getMealieConfig(USER_ID), prev, null);
    res.json({ message: 'Check-in deleted', id, mealie_sync: sync });
  } catch (err) {
    sendError(res, err, 'Failed to delete food check-in');
  }
});

// ---------------------------------------------------------------------------
// Stats (Profile > Food)
// ---------------------------------------------------------------------------

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [totals, byMeal, top] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE location_checkin_id IS NULL)::int AS at_home,
                COUNT(*) FILTER (WHERE location_checkin_id IS NOT NULL)::int AS eaten_out,
                COUNT(*) FILTER (WHERE checked_in_at >= NOW() - INTERVAL '30 days')::int AS last_30_days,
                COUNT(DISTINCT mealie_recipe_id)::int AS distinct_recipes
         FROM food_checkins WHERE user_id = $1`,
        [USER_ID],
      ),
      query(
        `SELECT meal_type, COUNT(*)::int AS count FROM food_checkins WHERE user_id = $1 GROUP BY meal_type`,
        [USER_ID],
      ),
      query(
        `SELECT MAX(recipe_name) AS recipe_name, MAX(mealie_recipe_slug) AS mealie_recipe_slug,
                COUNT(*)::int AS count, ROUND(AVG(rating), 1)::float AS avg_rating,
                MAX(checked_in_at) AS last_eaten_at
         FROM food_checkins WHERE user_id = $1
         GROUP BY COALESCE(mealie_recipe_id, lower(recipe_name))
         ORDER BY count DESC, last_eaten_at DESC
         LIMIT 10`,
        [USER_ID],
      ),
    ]);
    const byMealType = Object.fromEntries(MEAL_TYPES.map((t) => [t, 0])) as Record<MealType, number>;
    for (const r of byMeal.rows) byMealType[r.meal_type as MealType] = r.count;
    res.json({ ...totals.rows[0], by_meal_type: byMealType, top_recipes: top.rows });
  } catch (err) {
    sendError(res, err, 'Failed to load food stats');
  }
});

// ---------------------------------------------------------------------------
// Mealie proxy (keeps the token server-side; no CORS setup needed)
// ---------------------------------------------------------------------------

function mealieErrorStatus(err: unknown): number {
  return err instanceof MealieError ? 502 : 500;
}

router.get('/mealie/status', async (_req: Request, res: Response) => {
  try {
    const config = await getMealieConfig(USER_ID);
    if (!config) return res.json({ configured: false });
    try {
      const groupSlug = await getGroupSlug(config);
      res.json({
        configured: true,
        reachable: true,
        base_url: config.baseUrl,
        group_slug: groupSlug,
        create_recipe_url: createRecipeUrl(config.baseUrl, groupSlug),
      });
    } catch (err) {
      res.json({
        configured: true,
        reachable: false,
        base_url: config.baseUrl,
        group_slug: null,
        create_recipe_url: createRecipeUrl(config.baseUrl, null),
        error: err instanceof Error ? err.message : 'Could not reach Mealie',
      });
    }
  } catch (err) {
    sendError(res, err, 'Failed to check Mealie');
  }
});

router.get('/mealie/recipes', async (req: Request, res: Response) => {
  try {
    const config = await getMealieConfig(USER_ID);
    if (!config) return res.status(400).json({ error: 'Add your Mealie URL and API token in Settings > Food first.' });
    const recipes = await getRecipesCached(config, { refresh: req.query.refresh === '1' });
    res.json({ recipes });
  } catch (err) {
    console.error('Failed to list Mealie recipes:', err);
    res.status(mealieErrorStatus(err)).json({ error: err instanceof Error ? err.message : 'Failed to list Mealie recipes' });
  }
});

router.post('/mealie/mealplan', async (req: Request, res: Response) => {
  try {
    const config = await getMealieConfig(USER_ID);
    if (!config) return res.status(400).json({ error: 'Add your Mealie URL and API token in Settings > Food first.' });
    const entries = asRecordArray(req.body?.entries);
    if (entries.length === 0 || entries.length > 100) return res.status(400).json({ error: 'entries must hold 1-100 items' });
    for (const e of entries) {
      if (typeof e.date !== 'string' || !DATE_RE.test(e.date) || !isMealType(e.meal_type)) {
        return res.status(400).json({ error: 'Each entry needs a YYYY-MM-DD date and a meal_type' });
      }
      if (!e.recipe_id && !(typeof e.title === 'string' && e.title.trim())) {
        return res.status(400).json({ error: 'Each entry needs a recipe_id or a title' });
      }
    }
    // Sequential: a household meal plan is small and Mealie is self-hosted.
    const results: { ok: boolean; id?: string | null; error?: string }[] = [];
    for (const e of entries) {
      try {
        const id = await createMealPlanEntry(config, {
          date: String(e.date),
          entryType: e.meal_type as MealType,
          recipeId: typeof e.recipe_id === 'string' && e.recipe_id ? e.recipe_id : null,
          title: typeof e.title === 'string' ? e.title.trim().slice(0, 200) : '',
          text: typeof e.reason === 'string' ? e.reason.trim().slice(0, 1000) : '',
        });
        results.push({ ok: true, id });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : 'Mealie request failed' });
      }
    }
    res.json({ results });
  } catch (err) {
    sendError(res, err, 'Failed to add to the Mealie meal plan');
  }
});

// ---------------------------------------------------------------------------
// LLM suggestions. Generation on a local model can take minutes, so the POST
// starts a task and the client polls (same pattern as the life summary).
// ---------------------------------------------------------------------------

interface SuggestionTask {
  state: 'running' | 'done' | 'error';
  result?: ParsedSuggestions & { weather: boolean; library_size: number };
  error?: string;
  finishedAt?: number;
}

const suggestionTasks = new Map<string, SuggestionTask>();
const TASK_TTL_MS = 30 * 60 * 1000;

function pruneSuggestionTasks() {
  const cutoff = Date.now() - TASK_TTL_MS;
  for (const [id, task] of suggestionTasks) {
    if (task.finishedAt && task.finishedAt < cutoff) suggestionTasks.delete(id);
  }
}

export interface SuggestRequest {
  meal_types: MealType[];
  days: number;
  start_date: string;
  variety: 'comfort' | 'balanced' | 'adventurous';
  timezone: string;
  latitude: number | null;
  longitude: number | null;
}

export function parseSuggestRequest(body: Record<string, unknown>): SuggestRequest {
  const mealTypes = Array.isArray(body.meal_types) ? [...new Set(body.meal_types)] : [];
  if (mealTypes.length === 0 || !mealTypes.every(isMealType)) {
    throw new InputError(`meal_types must list one or more of ${MEAL_TYPES.join(', ')}`);
  }
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_SUGGESTION_DAYS) {
    throw new InputError(`days must be 1-${MAX_SUGGESTION_DAYS}`);
  }
  if (typeof body.start_date !== 'string' || !DATE_RE.test(body.start_date)) {
    throw new InputError('start_date must be YYYY-MM-DD');
  }
  if (!isVariety(body.variety)) throw new InputError('variety must be comfort, balanced or adventurous');
  const timezone = typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : 'UTC';
  const lat = body.latitude == null ? null : Number(body.latitude);
  const lon = body.longitude == null ? null : Number(body.longitude);
  const coordsOk = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    meal_types: mealTypes as MealType[],
    days,
    start_date: body.start_date,
    variety: body.variety,
    timezone,
    latitude: coordsOk ? lat : null,
    longitude: coordsOk ? lon : null,
  };
}

async function loadHistory(fromDate: string): Promise<HistoryMeal[]> {
  const result = await query(
    `SELECT (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date::text AS date,
            meal_type, recipe_name, mealie_recipe_id, rating, notes,
            location_checkin_id IS NOT NULL AS eaten_out
     FROM food_checkins
     WHERE user_id = $1
       AND (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date >= $2::date
     ORDER BY checked_in_at DESC`,
    [USER_ID, fromDate],
  );
  return result.rows as HistoryMeal[];
}

/** All-time per-recipe history: last made, count, average rating. */
async function loadRecipeHistory(): Promise<Map<string, { last_made: string; times_made: number; avg_rating: number | null }>> {
  const result = await query(
    `SELECT mealie_recipe_id,
            MAX((checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date)::text AS last_made,
            COUNT(*)::int AS times_made,
            AVG(rating)::float AS avg_rating
     FROM food_checkins
     WHERE user_id = $1 AND mealie_recipe_id IS NOT NULL
     GROUP BY mealie_recipe_id`,
    [USER_ID],
  );
  return new Map(result.rows.map((r) => [r.mealie_recipe_id as string, {
    last_made: r.last_made as string,
    times_made: r.times_made as number,
    avg_rating: r.avg_rating == null ? null : Number(r.avg_rating),
  }]));
}

async function runSuggestions(req: SuggestRequest): Promise<NonNullable<SuggestionTask['result']>> {
  const llm = await getLlmSettings(USER_ID);
  if (!llm) throw new InputError('Set up the LLM integration in Settings > Integrations first.');
  const config = await getMealieConfig(USER_ID);

  const endDate = addDays(req.start_date, req.days - 1);
  const [recipes, history, recipeHistory, forecast] = await Promise.all([
    config ? getRecipesCached(config) : Promise.resolve([]),
    loadHistory(addDays(req.start_date, -HISTORY_DAYS)),
    loadRecipeHistory(),
    req.latitude != null && req.longitude != null && req.days <= MAX_FORECAST_DAYS
      ? fetchForecast(req.latitude, req.longitude, req.timezone, req.start_date, endDate).catch((err) => {
        console.error('Forecast for meal suggestions failed:', err instanceof Error ? err.message : err);
        return [] as ForecastDay[];
      })
      : Promise.resolve([] as ForecastDay[]),
  ]);

  const library: LibraryRecipe[] = recipes.map((r) => {
    const h = recipeHistory.get(r.id);
    return { ...r, last_made: h?.last_made ?? null, times_made: h?.times_made ?? 0, avg_rating: h?.avg_rating ?? null };
  });
  const slots = buildSlots(req.start_date, req.days, req.meal_types);
  const prompt = buildPrompt({
    slots,
    variety: req.variety,
    library,
    history,
    forecast,
    today: req.start_date,
    charBudget: finalCharBudget(llm, 0),
  });
  const maxTokens = Math.min(8192, 800 + slots.length * 120);
  const reply = await callLlm(llm, prompt.system, prompt.user, maxTokens);
  const parsed = parseSuggestions(reply, slots, recipes);
  if (parsed.suggestions.length === 0) throw new Error('The LLM did not return any usable suggestions. Try again.');
  return { ...parsed, weather: forecast.length > 0, library_size: recipes.length };
}

router.post('/suggestions', async (req: Request, res: Response) => {
  let input: SuggestRequest;
  try {
    input = parseSuggestRequest(req.body ?? {});
  } catch (err) {
    return sendError(res, err, 'Invalid suggestion request');
  }
  pruneSuggestionTasks();
  const id = randomUUID();
  const task: SuggestionTask = { state: 'running' };
  suggestionTasks.set(id, task);
  runSuggestions(input)
    .then((result) => {
      task.state = 'done';
      task.result = result;
    })
    .catch((err) => {
      console.error('Meal suggestions failed:', err);
      task.state = 'error';
      task.error = err instanceof Error ? err.message : 'Failed to generate suggestions';
    })
    .finally(() => {
      task.finishedAt = Date.now();
    });
  res.status(202).json({ task_id: id });
});

router.get('/suggestions/:id', (req: Request, res: Response) => {
  const task = suggestionTasks.get(String(req.params.id));
  if (!task) return res.status(404).json({ error: 'Suggestion task not found (the server may have restarted). Please try again.' });
  if (task.state === 'running') return res.json({ status: 'running' });
  if (task.state === 'error') return res.json({ status: 'error', error: task.error });
  res.json({ status: 'done', result: task.result });
});

// ---------------------------------------------------------------------------
// LLM life summary line formatting
// ---------------------------------------------------------------------------

function formatLlmWhen(iso: string | Date, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: { mount: '/food', router },

  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'food'`,
        id: 'fc.id',
        user_id: 'fc.user_id',
        notes: 'fc.notes',
        checked_in_at: 'fc.checked_in_at',
        created_at: 'fc.created_at',
        companions: `(${companionNamesSql('food', 'fc.id')})`,
        data: `jsonb_build_object(
          'meal_type', fc.meal_type,
          'recipe_name', fc.recipe_name,
          'mealie_recipe_id', fc.mealie_recipe_id,
          'mealie_recipe_slug', fc.mealie_recipe_slug,
          'rating', fc.rating,
          'location_checkin_id', fc.location_checkin_id
        )`,
        timezone: 'fc.checkin_timezone',
      })}
      FROM food_checkins fc
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'fc',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'checkin_timezone',
      search: (c, q) =>
        c.push(`(fc.recipe_name ILIKE '%' || ? || '%' OR fc.notes ILIKE '%' || ? || '%')`, q, q),
    });
    if (ctx.filterParams.meal_type) {
      const types = ctx.filterParams.meal_type.split(',').map((s) => s.trim()).filter(isMealType);
      if (types.length > 0) conds.push('fc.meal_type = ANY(?::text[])', types);
    }
    return conds.build();
  },

  // Companion rows are core-owned and ship in the backup's companions.json.
  backupExport: async ({ user_id, client }) => {
    const result = await (client ?? { query }).query(
      `SELECT ${FOOD_COLUMNS} FROM food_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
      [user_id],
    );
    return result.rows;
  },

  // Restore never writes to Mealie: the stored event ids still point at the
  // events created when the check-ins were first saved.
  backupImport: async ({ user_id, client: txClient, errors }, payload) => {
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    let inserted = 0;
    try {
      for (const row of asRecordArray(payload)) {
        if (!isUuid(row.id) || !isMealType(row.meal_type) || typeof row.recipe_name !== 'string' || !row.recipe_name) {
          errors?.push(`Skipped a food check-in with missing or invalid fields (${String(row.id ?? 'no id')}).`);
          continue;
        }
        const rating = row.rating == null ? null : Number(row.rating);
        const result = await client.query(FOOD_INSERT_SQL, [
          row.id, user_id, row.meal_type, row.recipe_name,
          row.mealie_recipe_id ?? null, row.mealie_recipe_slug ?? null,
          rating != null && rating >= 1 && rating <= 4 ? rating : null,
          row.notes ?? null,
          isUuid(row.location_checkin_id) ? row.location_checkin_id : null,
          row.mealie_event_id ?? null,
          row.checked_in_at ?? new Date().toISOString(),
          typeof row.checkin_timezone === 'string' && isValidTimeZone(row.checkin_timezone) ? row.checkin_timezone : null,
          row.created_at ?? null,
          row.updated_at ?? null,
        ]);
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }
    return inserted;
  },

  // Start-over: local rows only. Events already written to Mealie stay there.
  deleteUserData: async ({ user_id, client }) => {
    const run = (sql: string, values: unknown[]) => (client ? client.query(sql, values) : query(sql, values));
    const companions = await run(
      `DELETE FROM companions WHERE checkin_type = 'food'
         AND checkin_id IN (SELECT id FROM food_checkins WHERE user_id = $1) RETURNING id`,
      [user_id],
    );
    const rows = await run('DELETE FROM food_checkins WHERE user_id = $1 RETURNING id', [user_id]);
    return (companions.rowCount ?? 0) + (rows.rowCount ?? 0);
  },

  settingsKeys: [
    { name: 'mealie_url', type: 'string', label: 'Mealie URL' },
    { name: 'mealie_api_token', type: 'string', label: 'Mealie API token' },
  ],

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM food_checkins WHERE id = ANY($1::uuid[])',
  }),

  earliestDate: () => ({
    sql: `SELECT MIN(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')))::text AS date
          FROM food_checkins WHERE user_id = $1`,
  }),

  reflectionBranch: () => ({
    sql: `
      SELECT
        'food' AS type,
        fc.id,
        fc.checked_in_at,
        fc.notes AS note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'meal_type', fc.meal_type,
          'recipe_name', fc.recipe_name,
          'mealie_recipe_slug', fc.mealie_recipe_slug,
          'rating', fc.rating,
          'checkin_timezone', fc.checkin_timezone
        )::jsonb AS data
      FROM food_checkins fc
      WHERE fc.user_id = $1
        AND TO_CHAR(fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  llm: {
    label: 'food check-ins',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT fc.checked_in_at, fc.checkin_timezone AS timezone,
                json_build_object(
                  'meal_type', fc.meal_type,
                  'recipe_name', fc.recipe_name,
                  'rating', fc.rating,
                  'eaten_out', fc.location_checkin_id IS NOT NULL,
                  'companions', (${companionNamesSql('food', 'fc.id')}),
                  'note', fc.notes
                )::jsonb AS data
         FROM food_checkins fc
         WHERE fc.user_id = $1
           AND (fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'))::date >= $2::date
           AND (fc.checked_in_at AT TIME ZONE COALESCE(fc.checkin_timezone, 'UTC'))::date <= $3::date
         ORDER BY fc.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row: PluginLlmRow) => {
      const d = row.data as {
        meal_type: MealType;
        recipe_name: string;
        rating: number | null;
        eaten_out: boolean;
        companions: string[] | null;
        note: string | null;
      };
      const when = formatLlmWhen(row.checked_in_at, row.timezone);
      const meal = (MEAL_TYPE_LABELS[d.meal_type] ?? d.meal_type).toLowerCase();
      const where = d.eaten_out ? ' (eaten out)' : '';
      const rating = d.rating != null ? ` (${d.rating}/4)` : '';
      const withWhom = d.companions?.length ? ` with ${d.companions.join(', ')}` : '';
      const note = d.note ? ` — note: "${d.note}"` : '';
      return [`- ${when} — ${meal}: ${d.recipe_name}${where}${withWhom}${rating}${note}`];
    },
  },

  latestTimezoneAsOf: () => ({
    sql: `SELECT checkin_timezone AS timezone
          FROM food_checkins
          WHERE user_id = $2
            AND checkin_timezone IS NOT NULL
            AND checked_in_at <= $1
          ORDER BY checked_in_at DESC
          LIMIT 1`,
  }),

  timezoneAnchors: () => ({
    sql: `SELECT checked_in_at AS at, checkin_timezone AS timezone
          FROM food_checkins
          WHERE user_id = $1 AND checkin_timezone IS NOT NULL`,
  }),

  reconcile: {
    anchorLabel: 'a food check-in',
    detailPath: (id) => `/food-checkins/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id, checked_in_at, checkin_timezone AS original_timezone
         FROM food_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
        [user_id],
      );
      return result.rows as PluginReconciliationRow[];
    },
    apply: async (id, suggested_timezone, executor) => {
      if (!isValidTimeZone(suggested_timezone)) return false;
      const result = await (executor ?? { query }).query(
        'UPDATE food_checkins SET checkin_timezone = $2 WHERE id = $1 RETURNING id',
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },
};
