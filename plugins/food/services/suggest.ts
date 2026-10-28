// ============================================================================
// Meal suggestions: prompt building and response validation for the LLM call
// behind Profile > Food > Suggestions. Pure functions (no DB, no network) so
// they can be unit-tested; the route in ../server.ts gathers the inputs.
// ============================================================================

import { MEAL_TYPES, MEAL_TYPE_LABELS, isMealType, type MealType } from '../manifest';
import { describeWeatherCode, type ForecastDay } from './forecast';
import type { MealieRecipe } from './mealie';

export const VARIETY_LEVELS = ['comfort', 'balanced', 'adventurous'] as const;
export type Variety = (typeof VARIETY_LEVELS)[number];

export function isVariety(value: unknown): value is Variety {
  return typeof value === 'string' && (VARIETY_LEVELS as readonly string[]).includes(value);
}

export const MAX_SUGGESTION_DAYS = 14;
export const HISTORY_DAYS = 90;

/** One past meal, already converted to its local date. */
export interface HistoryMeal {
  date: string;
  meal_type: MealType;
  recipe_name: string;
  mealie_recipe_id: string | null;
  rating: number | null;
  /** True when linked to a location check-in (eaten out). */
  eaten_out: boolean;
  notes: string | null;
}

/** A library recipe plus what WhereWeWere knows about it (all-time). */
export interface LibraryRecipe extends MealieRecipe {
  last_made: string | null;
  times_made: number;
  avg_rating: number | null;
}

export interface Slot {
  date: string;
  meal_type: MealType;
}

export interface Suggestion extends Slot {
  /** 'recipe' = from the Mealie library; 'idea' = not in Mealie. */
  kind: 'recipe' | 'idea';
  recipe_id: string | null;
  recipe_slug: string | null;
  title: string;
  reason: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Every (date, meal) slot to fill, in date then meal order. */
export function buildSlots(startDate: string, days: number, mealTypes: MealType[]): Slot[] {
  const ordered = MEAL_TYPES.filter((t) => mealTypes.includes(t));
  const slots: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    for (const meal_type of ordered) slots.push({ date, meal_type });
  }
  return slots;
}

/** How many "not in Mealie" ideas the plan may contain. */
export function maxNewIdeas(slotCount: number, variety: Variety, libraryEmpty: boolean): number {
  if (libraryEmpty) return slotCount;
  if (variety === 'comfort') return Math.floor(slotCount / 7);
  if (variety === 'balanced') return Math.max(1, Math.round(slotCount * 0.15));
  return Math.max(1, Math.round(slotCount * 0.3));
}

export const VARIETY_GUIDANCE: Record<Variety, string> = {
  comfort:
    'Comfort rotation: lean on the household favorites they have made recently and rated well. Repeating a recent recipe is fine and expected, just not on back-to-back days.',
  balanced:
    'Balanced: mix reliable favorites with good recipes they have not made in a while. Avoid anything eaten in the last 7 days and do not repeat a recipe within this plan.',
  adventurous:
    'Switch it up: something different every time. Avoid anything eaten in the last 3 weeks, prefer recipes made rarely or never, vary cuisines and proteins from slot to slot, and never repeat a recipe within this plan.',
};

const SYSTEM_PROMPT = `You are a practical home meal planner. You suggest meals for specific upcoming days, using the household's own recipe library and their recent meal history.

Rules:
- Fill every requested slot with exactly one suggestion.
- Prefer recipes from the library and reference them by their exact id. Only suggest a dish that is not in the library when allowed (see the limit), and then set "recipe_id" to null.
- Weeknights favor quicker recipes (shorter total time); weekends can take longer ones.
- Let the weather nudge choices (soups, stews and bakes on cold or wet days; grilling and salads on warm, dry days) without overriding the variety preference.
- Favor recipes they rated highly; avoid ones they rated poorly.
- Each "reason" is one short, specific sentence (why this dish on this day).

Respond with JSON only, no prose and no code fences, in exactly this shape:
{"suggestions":[{"date":"YYYY-MM-DD","meal_type":"dinner","recipe_id":"<library id or null>","title":"<dish name>","reason":"<one sentence>"}]}`;

function formatTemp(c: number | null): string | null {
  if (c == null) return null;
  return `${Math.round(c)}°C/${Math.round(c * 9 / 5 + 32)}°F`;
}

function forecastLine(day: ForecastDay | undefined): string {
  if (!day) return 'weather unknown';
  const parts = [
    describeWeatherCode(day.code),
    day.tmax != null ? `high ${formatTemp(day.tmax)}` : null,
    day.tmin != null ? `low ${formatTemp(day.tmin)}` : null,
    day.precip_probability != null ? `${Math.round(day.precip_probability)}% chance of rain` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'weather unknown';
}

function libraryLine(r: LibraryRecipe): string {
  const labels = [...r.categories, ...r.tags].slice(0, 6).join(', ');
  return [
    `- id=${r.id}`,
    `"${r.name}"`,
    labels ? `[${labels}]` : null,
    r.total_time ? `total ${r.total_time}` : null,
    r.avg_rating != null ? `their rating ${r.avg_rating.toFixed(1)}/4` : null,
    r.rating != null ? `Mealie rating ${r.rating}/5` : null,
    r.last_made ? `last made ${r.last_made}` : 'never logged',
    r.times_made ? `made ${r.times_made}x` : null,
  ].filter(Boolean).join(' | ');
}

function historyLine(m: HistoryMeal): string {
  const notes = m.notes ? ` — note: "${m.notes.replace(/\s+/g, ' ').slice(0, 120)}"` : '';
  return `- ${m.date} (${weekdayOf(m.date).slice(0, 3)}) ${MEAL_TYPE_LABELS[m.meal_type].toLowerCase()}: ${m.recipe_name}`
    + `${m.mealie_recipe_id ? ` [id=${m.mealie_recipe_id}]` : ''}`
    + `${m.eaten_out ? ' (eaten out)' : ''}`
    + `${m.rating != null ? ` (rated ${m.rating}/4)` : ''}${notes}`;
}

export interface PromptInput {
  slots: Slot[];
  variety: Variety;
  library: LibraryRecipe[];
  history: HistoryMeal[];
  forecast: ForecastDay[];
  today: string;
  /** Max characters for the user message (history is trimmed oldest-first to fit). */
  charBudget: number;
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const forecastByDate = new Map(input.forecast.map((d) => [d.date, d]));
  const byDate = new Map<string, MealType[]>();
  for (const s of input.slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.meal_type]);
  const planLines = [...byDate].map(([date, types]) =>
    `- ${date} (${weekdayOf(date)}): ${types.map((t) => MEAL_TYPE_LABELS[t].toLowerCase()).join(', ')} — ${forecastLine(forecastByDate.get(date))}`);

  const limit = maxNewIdeas(input.slots.length, input.variety, input.library.length === 0);
  const head = [
    `Today is ${input.today} (${weekdayOf(input.today)}).`,
    '',
    `## Slots to fill (${input.slots.length})`,
    ...planLines,
    '',
    '## Variety preference',
    VARIETY_GUIDANCE[input.variety],
    '',
    `## Limit on dishes not in the library: at most ${limit}`,
    '',
    `## Recipe library (${input.library.length} recipes)`,
    ...(input.library.length ? input.library.map(libraryLine) : ['(empty: every suggestion is a new idea)']),
    '',
    `## Meals eaten in the last ${HISTORY_DAYS} days (newest first)`,
  ].join('\n');

  // History is newest-first; drop the oldest lines until it fits.
  const history = [...input.history].sort((a, b) => b.date.localeCompare(a.date)).map(historyLine);
  let user = `${head}\n${history.length ? history.join('\n') : '(none logged yet)'}`;
  while (user.length > input.charBudget && history.length > 0) {
    history.pop();
    user = `${head}\n${history.join('\n')}`;
  }
  return { system: SYSTEM_PROMPT, user };
}

/** Pull the JSON object out of a reply that may carry fences or prose. */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The LLM reply contained no JSON.');
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new Error('The LLM reply was not valid JSON.');
  }
}

export interface ParsedSuggestions {
  suggestions: Suggestion[];
  /** Slots the reply left empty (or filled with something unusable). */
  missing: Slot[];
}

/**
 * Validate the LLM reply against the requested slots and the library. Ids
 * that don't match the library (hallucinated or mangled) fall back to a name
 * match, then become a "not in Mealie" idea.
 */
export function parseSuggestions(text: string, slots: Slot[], library: MealieRecipe[]): ParsedSuggestions {
  const json = extractJson(text) as { suggestions?: unknown };
  const items = Array.isArray(json?.suggestions) ? json.suggestions : [];
  const byId = new Map(library.map((r) => [r.id, r]));
  const byName = new Map(library.map((r) => [r.name.trim().toLowerCase(), r]));
  const key = (s: Slot) => `${s.date}|${s.meal_type}`;
  const wanted = new Set(slots.map(key));
  const filled = new Map<string, Suggestion>();

  for (const raw of items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const date = typeof raw.date === 'string' ? raw.date : '';
    const mealType = raw.meal_type;
    if (!isMealType(mealType)) continue;
    const slot = { date, meal_type: mealType };
    if (!wanted.has(key(slot)) || filled.has(key(slot))) continue;

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 400) : '';
    const recipe = (typeof raw.recipe_id === 'string' && byId.get(raw.recipe_id.trim()))
      || (title ? byName.get(title.toLowerCase()) : undefined);
    if (recipe) {
      filled.set(key(slot), { ...slot, kind: 'recipe', recipe_id: recipe.id, recipe_slug: recipe.slug, title: recipe.name, reason });
    } else if (title) {
      filled.set(key(slot), { ...slot, kind: 'idea', recipe_id: null, recipe_slug: null, title: title.slice(0, 200), reason });
    }
  }

  return {
    suggestions: slots.map((s) => filled.get(key(s))).filter((s): s is Suggestion => Boolean(s)),
    missing: slots.filter((s) => !filled.has(key(s))),
  };
}
