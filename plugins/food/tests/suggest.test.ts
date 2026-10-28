import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildPrompt,
  buildSlots,
  extractJson,
  maxNewIdeas,
  parseSuggestions,
  weekdayOf,
  type HistoryMeal,
  type LibraryRecipe,
} from '../services/suggest';
import { describeWeatherCode, parseForecast } from '../services/forecast';

function recipe(id: string, name: string, over: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id, slug: name.toLowerCase().replace(/\s+/g, '-'), name,
    description: null, tags: [], categories: [], total_time: null, rating: null, has_image: false,
    last_made: null, times_made: 0, avg_rating: null,
    ...over,
  };
}

const LIBRARY = [recipe('r1', 'Chicken Tikka Masala'), recipe('r2', 'Black Bean Soup'), recipe('r3', 'Fish Tacos')];

describe('dates and slots', () => {
  it('adds days across month ends and names weekdays', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-10-28')).toBe('Wednesday');
  });

  it('builds one slot per day per meal, in meal order', () => {
    expect(buildSlots('2026-10-28', 2, ['dinner', 'breakfast'])).toEqual([
      { date: '2026-10-28', meal_type: 'breakfast' },
      { date: '2026-10-28', meal_type: 'dinner' },
      { date: '2026-10-29', meal_type: 'breakfast' },
      { date: '2026-10-29', meal_type: 'dinner' },
    ]);
  });

  it('allows more new ideas as variety goes up, and all of them with no library', () => {
    expect(maxNewIdeas(7, 'comfort', false)).toBe(1);
    expect(maxNewIdeas(3, 'comfort', false)).toBe(0);
    expect(maxNewIdeas(7, 'balanced', false)).toBe(1);
    expect(maxNewIdeas(14, 'adventurous', false)).toBe(4);
    expect(maxNewIdeas(5, 'comfort', true)).toBe(5);
  });
});

describe('buildPrompt', () => {
  const history: HistoryMeal[] = Array.from({ length: 40 }, (_, i) => ({
    date: addDays('2026-10-27', -i),
    meal_type: 'dinner',
    recipe_name: `Meal ${i}`,
    mealie_recipe_id: null,
    rating: i === 0 ? 4 : null,
    eaten_out: i === 1,
    notes: i === 0 ? 'too spicy\nnext time less chili' : null,
  }));

  it('includes slots with weather, the variety guidance, the library and history', () => {
    const { system, user } = buildPrompt({
      slots: buildSlots('2026-10-28', 2, ['dinner']),
      variety: 'adventurous',
      library: [recipe('r1', 'Chicken Tikka Masala', { total_time: '45 min', last_made: '2026-10-01', times_made: 3, avg_rating: 3.5 })],
      history,
      forecast: [{ date: '2026-10-28', tmax: 10, tmin: 2, precip_probability: 80, code: 63 }],
      today: '2026-10-28',
      charBudget: 100_000,
    });
    expect(system).toContain('JSON only');
    expect(user).toContain('2026-10-28 (Wednesday): dinner — rain, high 10°C/50°F, low 2°C/36°F, 80% chance of rain');
    expect(user).toContain('2026-10-29 (Thursday): dinner — weather unknown');
    expect(user).toContain('Switch it up');
    expect(user).toContain('id=r1 | "Chicken Tikka Masala" | total 45 min | their rating 3.5/4 | last made 2026-10-01 | made 3x');
    expect(user).toContain('Meal 0 (rated 4/4) — note: "too spicy next time less chili"');
    expect(user).toContain('Meal 1 (eaten out)');
    expect(user).toContain('at most 1');
  });

  it('drops the oldest history to fit the budget', () => {
    const full = buildPrompt({
      slots: buildSlots('2026-10-28', 1, ['dinner']), variety: 'balanced', library: LIBRARY, history,
      forecast: [], today: '2026-10-28', charBudget: 100_000,
    });
    const trimmed = buildPrompt({
      slots: buildSlots('2026-10-28', 1, ['dinner']), variety: 'balanced', library: LIBRARY, history,
      forecast: [], today: '2026-10-28', charBudget: full.user.length - 200,
    });
    expect(trimmed.user.length).toBeLessThanOrEqual(full.user.length - 200);
    expect(trimmed.user).toContain('Meal 0');
    expect(trimmed.user).not.toContain('Meal 39');
  });
});

describe('extractJson', () => {
  it('reads fenced and prose-wrapped replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":2}} Enjoy.')).toEqual({ a: { b: 2 } });
  });

  it('throws on replies without valid JSON', () => {
    expect(() => extractJson('no idea')).toThrow(/no JSON/);
    expect(() => extractJson('{"a":')).toThrow(/no JSON|not valid/);
  });
});

describe('parseSuggestions', () => {
  const slots = buildSlots('2026-10-28', 3, ['dinner']);

  it('maps library ids, falls back to a name match, and keeps new ideas', () => {
    const reply = JSON.stringify({
      suggestions: [
        { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r2', title: 'whatever', reason: 'Cold and rainy.' },
        { date: '2026-10-29', meal_type: 'dinner', recipe_id: 'bogus', title: 'fish tacos', reason: 'Quick.' },
        { date: '2026-10-30', meal_type: 'dinner', recipe_id: null, title: 'Mushroom risotto', reason: 'Something new.' },
      ],
    });
    const { suggestions, missing } = parseSuggestions(reply, slots, LIBRARY);
    expect(missing).toEqual([]);
    expect(suggestions).toEqual([
      { date: '2026-10-28', meal_type: 'dinner', kind: 'recipe', recipe_id: 'r2', recipe_slug: 'black-bean-soup', title: 'Black Bean Soup', reason: 'Cold and rainy.' },
      { date: '2026-10-29', meal_type: 'dinner', kind: 'recipe', recipe_id: 'r3', recipe_slug: 'fish-tacos', title: 'Fish Tacos', reason: 'Quick.' },
      { date: '2026-10-30', meal_type: 'dinner', kind: 'idea', recipe_id: null, recipe_slug: null, title: 'Mushroom risotto', reason: 'Something new.' },
    ]);
  });

  it('ignores unrequested slots, duplicates and untitled ideas, and reports gaps', () => {
    const reply = JSON.stringify({
      suggestions: [
        { date: '2026-10-28', meal_type: 'lunch', recipe_id: 'r1' },
        { date: '2026-11-15', meal_type: 'dinner', recipe_id: 'r1' },
        { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r1', reason: 'first' },
        { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r2', reason: 'second' },
        { date: '2026-10-29', meal_type: 'dinner', recipe_id: null, title: '  ' },
      ],
    });
    const { suggestions, missing } = parseSuggestions(reply, slots, LIBRARY);
    expect(suggestions.map((s) => [s.date, s.recipe_id, s.reason])).toEqual([['2026-10-28', 'r1', 'first']]);
    expect(missing.map((m) => m.date)).toEqual(['2026-10-29', '2026-10-30']);
  });
});

describe('forecast', () => {
  it('parses Open-Meteo daily arrays', () => {
    expect(parseForecast({
      daily: {
        time: ['2026-10-28'],
        temperature_2m_max: [12.3],
        temperature_2m_min: [null],
        precipitation_probability_max: [40],
        weather_code: [3],
      },
    })).toEqual([{ date: '2026-10-28', tmax: 12.3, tmin: null, precip_probability: 40, code: 3 }]);
    expect(parseForecast({})).toEqual([]);
  });

  it('describes weather codes coarsely', () => {
    expect(describeWeatherCode(0)).toBe('clear');
    expect(describeWeatherCode(81)).toBe('rain');
    expect(describeWeatherCode(73)).toBe('snow');
    expect(describeWeatherCode(null)).toBeNull();
  });
});
