/**
 * Food check-in type — client API helpers for the plugin's `/food` router.
 */

import { request } from '../../../client/src/api/client';
import type { MealType } from '../manifest';

export interface FoodCheckin {
  id: string;
  meal_type: MealType;
  recipe_name: string;
  mealie_recipe_id: string | null;
  mealie_recipe_slug: string | null;
  rating: number | null;
  notes: string | null;
  location_checkin_id: string | null;
  mealie_event_id: string | null;
  checked_in_at: string;
  checkin_timezone: string | null;
  created_at: string;
  updated_at: string;
  companions: string[];
}

export interface MealieSync {
  status: 'synced' | 'skipped' | 'failed';
  message?: string;
}

export interface FoodCheckinInput {
  meal_type: MealType;
  recipe_name: string;
  mealie_recipe_id: string | null;
  mealie_recipe_slug: string | null;
  rating: number | null;
  notes: string | null;
  location_checkin_id: string | null;
  checked_in_at: string | null;
  checkin_timezone: string | null;
  companions: string[];
}

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

export type MealieStatus =
  | { configured: false }
  | {
    configured: true;
    reachable: boolean;
    base_url: string;
    group_slug: string | null;
    create_recipe_url: string;
    error?: string;
  };

export interface FoodStats {
  total: number;
  at_home: number;
  eaten_out: number;
  last_30_days: number;
  distinct_recipes: number;
  by_meal_type: Record<MealType, number>;
  top_recipes: {
    recipe_name: string;
    mealie_recipe_slug: string | null;
    count: number;
    avg_rating: number | null;
    last_eaten_at: string;
  }[];
}

export type Variety = 'comfort' | 'balanced' | 'adventurous';

export interface Suggestion {
  date: string;
  meal_type: MealType;
  kind: 'recipe' | 'idea';
  recipe_id: string | null;
  recipe_slug: string | null;
  title: string;
  reason: string;
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  missing: { date: string; meal_type: MealType }[];
  weather: boolean;
  library_size: number;
}

export interface SuggestRequest {
  meal_types: MealType[];
  days: number;
  start_date: string;
  variety: Variety;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
}

const BASE = '/food';

export const food = {
  list: (params?: Record<string, string>) =>
    request<FoodCheckin[]>(`${BASE}/checkins?${new URLSearchParams(params)}`),
  get: (id: string) => request<FoodCheckin>(`${BASE}/checkins/${id}`),
  create: (data: FoodCheckinInput) =>
    request<FoodCheckin & { mealie_sync: MealieSync }>(`${BASE}/checkins`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: FoodCheckinInput) =>
    request<FoodCheckin & { mealie_sync: MealieSync }>(`${BASE}/checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) =>
    request<{ id: string; mealie_sync: MealieSync }>(`${BASE}/checkins/${id}`, { method: 'DELETE' }),
  stats: () => request<FoodStats>(`${BASE}/stats`),

  mealieStatus: () => request<MealieStatus>(`${BASE}/mealie/status`),
  recipes: (refresh = false) =>
    request<{ recipes: MealieRecipe[] }>(`${BASE}/mealie/recipes${refresh ? '?refresh=1' : ''}`),
  addToMealPlan: (entries: { date: string; meal_type: MealType; recipe_id: string | null; title: string; reason: string }[]) =>
    request<{ results: { ok: boolean; id?: string | null; error?: string }[] }>(`${BASE}/mealie/mealplan`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),

  suggest: (body: SuggestRequest) =>
    request<{ task_id: string }>(`${BASE}/suggestions`, { method: 'POST', body: JSON.stringify(body) }),
  suggestStatus: (taskId: string) =>
    request<
      | { status: 'running' }
      | { status: 'error'; error: string }
      | { status: 'done'; result: SuggestionResult }
    >(`${BASE}/suggestions/${encodeURIComponent(taskId)}`),
};

/** Mealie front-end URL for a recipe (group-scoped on Mealie v1+). */
export function mealieRecipeUrl(status: MealieStatus | null, slug: string): string | null {
  if (!status || !status.configured) return null;
  return status.group_slug ? `${status.base_url}/g/${status.group_slug}/r/${slug}` : `${status.base_url}/recipe/${slug}`;
}

/** Default meal for a time of day (local hour). */
export function mealTypeForHour(hour: number): MealType {
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}
