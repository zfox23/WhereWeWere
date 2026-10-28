// ============================================================================
// Mealie API client (self-hosted recipe manager, https://docs.mealie.io).
//
// Every call needs the instance URL and a user API token (Mealie > User
// Profile > API Tokens), stored in this plugin's settings. Reads list the
// recipe library; writes mark a recipe as made (last-made + a timeline event)
// and add entries to the household meal plan.
// ============================================================================

import { query } from '../../../server/src/db';

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 200;
/** Safety cap on pagination (200 * 50 = 10k recipes). */
const MAX_PAGES = 50;
const RECIPE_CACHE_MS = 5 * 60 * 1000;

export interface MealieConfig {
  baseUrl: string;
  token: string;
}

export class MealieError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'MealieError';
  }
}

/** A recipe as WhereWeWere uses it (a trimmed Mealie RecipeSummary). */
export interface MealieRecipe {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  categories: string[];
  total_time: string | null;
  rating: number | null;
  has_image: boolean;
}

export type FetchImpl = typeof fetch;

/** Strip trailing slashes and a pasted `/api` suffix. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

/** The Mealie URL + token from plugin_settings; null until both are set. */
export async function getMealieConfig(userId: string): Promise<MealieConfig | null> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'food' AND key IN ('mealie_url', 'mealie_api_token')`,
    [userId],
  );
  const values: Record<string, unknown> = {};
  for (const row of result.rows) values[row.key] = row.value;
  const url = typeof values.mealie_url === 'string' ? normalizeBaseUrl(values.mealie_url) : '';
  const token = typeof values.mealie_api_token === 'string' ? values.mealie_api_token.trim() : '';
  if (!url || !token) return null;
  return { baseUrl: url, token };
}

async function mealieFetch<T>(
  config: MealieConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchImpl = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (err) {
    throw new MealieError(`Could not reach Mealie: ${err instanceof Error ? err.message : 'network error'}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (body.detail && typeof body.detail === 'object') {
        const message = (body.detail as { message?: unknown }).message;
        if (typeof message === 'string') detail = message;
      }
    } catch { /* not JSON */ }
    if (res.status === 401 || res.status === 403) {
      throw new MealieError('Mealie rejected the API token. Check it in Settings > Food.', res.status);
    }
    throw new MealieError(`Mealie error ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface RawRecipeSummary {
  id?: string | null;
  slug?: string;
  name?: string | null;
  description?: string | null;
  tags?: { name?: string }[] | null;
  recipeCategory?: { name?: string }[] | null;
  totalTime?: string | null;
  rating?: number | null;
  image?: unknown;
}

export function toMealieRecipe(raw: RawRecipeSummary): MealieRecipe | null {
  if (!raw.id || !raw.slug) return null;
  const names = (list: { name?: string }[] | null | undefined) =>
    (list ?? []).map((t) => t.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name?.trim() || raw.slug,
    description: raw.description?.trim() || null,
    tags: names(raw.tags),
    categories: names(raw.recipeCategory),
    total_time: raw.totalTime?.trim() || null,
    rating: typeof raw.rating === 'number' && raw.rating > 0 ? raw.rating : null,
    has_image: raw.image != null && raw.image !== '',
  };
}

/** Every recipe in the library, sorted by name (pages through the API). */
export async function listAllRecipes(config: MealieConfig, fetchImpl: FetchImpl = fetch): Promise<MealieRecipe[]> {
  const out: MealieRecipe[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qp = new URLSearchParams({
      page: String(page),
      perPage: String(PAGE_SIZE),
      orderBy: 'name',
      orderDirection: 'asc',
    });
    const body = await mealieFetch<{ items?: RawRecipeSummary[]; total_pages?: number }>(
      config, `/api/recipes?${qp}`, {}, fetchImpl,
    );
    for (const raw of body.items ?? []) {
      const recipe = toMealieRecipe(raw);
      if (recipe) out.push(recipe);
    }
    if (!body.total_pages || page >= body.total_pages) break;
  }
  return out;
}

const recipeCache = new Map<string, { at: number; recipes: MealieRecipe[] }>();

/** listAllRecipes behind a short in-memory cache (keyed by instance URL). */
export async function getRecipesCached(
  config: MealieConfig,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<MealieRecipe[]> {
  const hit = recipeCache.get(config.baseUrl);
  if (!refresh && hit && Date.now() - hit.at < RECIPE_CACHE_MS) return hit.recipes;
  const recipes = await listAllRecipes(config);
  recipeCache.set(config.baseUrl, { at: Date.now(), recipes });
  return recipes;
}

export function clearRecipeCache(): void {
  recipeCache.clear();
}

/** The group slug Mealie's front-end URLs are scoped by (/g/<slug>/...). */
export async function getGroupSlug(config: MealieConfig, fetchImpl: FetchImpl = fetch): Promise<string | null> {
  const self = await mealieFetch<{ groupSlug?: string | null }>(config, '/api/users/self', {}, fetchImpl);
  return self.groupSlug || null;
}

export function recipeUrl(baseUrl: string, groupSlug: string | null, slug: string): string {
  return groupSlug ? `${baseUrl}/g/${groupSlug}/r/${slug}` : `${baseUrl}/recipe/${slug}`;
}

export function createRecipeUrl(baseUrl: string, groupSlug: string | null): string {
  return groupSlug ? `${baseUrl}/g/${groupSlug}/r/create/url` : `${baseUrl}/recipe/create`;
}

// ---------------------------------------------------------------------------
// "Made this" writeback
// ---------------------------------------------------------------------------

export interface MadeThisInput {
  recipeId: string;
  recipeSlug: string;
  /** ISO instant the meal was eaten. */
  madeAt: string;
  mealLabel: string;
  notes: string | null;
}

/**
 * Move the recipe's household last-made date forward to `madeAt`. Never
 * moves it backward, so a backdated check-in doesn't hide a newer one.
 */
export async function bumpLastMade(
  config: MealieConfig,
  slug: string,
  madeAt: string,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const current = await mealieFetch<{ lastMade?: string | null }>(
    config, `/api/households/self/recipes/${encodeURIComponent(slug)}`, {}, fetchImpl,
  ).catch((err) => {
    // No household row yet just means "never made".
    if (err instanceof MealieError && err.status === 404) return { lastMade: null };
    throw err;
  });
  if (current.lastMade && new Date(current.lastMade).getTime() >= new Date(madeAt).getTime()) return false;
  await mealieFetch(config, `/api/recipes/${encodeURIComponent(slug)}/last-made`, {
    method: 'PATCH',
    body: JSON.stringify({ timestamp: madeAt }),
  }, fetchImpl);
  return true;
}

function madeThisSubject(mealLabel: string): string {
  return `Made this for ${mealLabel.toLowerCase()} (via WhereWeWere)`;
}

/** Add a "made this" comment to the recipe's timeline; returns the event id. */
export async function createMadeThisEvent(
  config: MealieConfig,
  input: MadeThisInput,
  fetchImpl: FetchImpl = fetch,
): Promise<string | null> {
  const event = await mealieFetch<{ id?: string }>(config, '/api/recipes/timeline/events', {
    method: 'POST',
    body: JSON.stringify({
      recipeId: input.recipeId,
      subject: madeThisSubject(input.mealLabel),
      eventType: 'comment',
      eventMessage: input.notes || null,
      timestamp: input.madeAt,
    }),
  }, fetchImpl);
  return event?.id ?? null;
}

/** Update the subject/message of an event this plugin created (timestamp is immutable in Mealie). */
export async function updateMadeThisEvent(
  config: MealieConfig,
  eventId: string,
  input: Pick<MadeThisInput, 'mealLabel' | 'notes'>,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await mealieFetch(config, `/api/recipes/timeline/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    body: JSON.stringify({ subject: madeThisSubject(input.mealLabel), eventMessage: input.notes || null }),
  }, fetchImpl);
}

/** Remove an event this plugin created. A missing event is not an error. */
export async function deleteMadeThisEvent(
  config: MealieConfig,
  eventId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  try {
    await mealieFetch(config, `/api/recipes/timeline/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, fetchImpl);
  } catch (err) {
    if (err instanceof MealieError && err.status === 404) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------------------

export interface MealPlanEntryInput {
  date: string;
  entryType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** A library recipe; omit for a title-only "note" entry. */
  recipeId?: string | null;
  title?: string;
  text?: string;
}

export async function createMealPlanEntry(
  config: MealieConfig,
  entry: MealPlanEntryInput,
  fetchImpl: FetchImpl = fetch,
): Promise<string | null> {
  const body = entry.recipeId
    ? { date: entry.date, entryType: entry.entryType, recipeId: entry.recipeId }
    : { date: entry.date, entryType: entry.entryType, title: entry.title ?? '', text: entry.text ?? '' };
  const created = await mealieFetch<{ id?: number | string }>(config, '/api/households/mealplans', {
    method: 'POST',
    body: JSON.stringify(body),
  }, fetchImpl);
  return created?.id != null ? String(created.id) : null;
}
