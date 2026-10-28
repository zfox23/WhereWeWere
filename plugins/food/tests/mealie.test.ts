import { describe, expect, it, vi } from 'vitest';
import {
  MealieError,
  bumpLastMade,
  createMadeThisEvent,
  createMealPlanEntry,
  createRecipeUrl,
  deleteMadeThisEvent,
  listAllRecipes,
  normalizeBaseUrl,
  recipeUrl,
  toMealieRecipe,
  type FetchImpl,
} from '../services/mealie';

const CONFIG = { baseUrl: 'https://mealie.mydomain.io', token: 'tok' };

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch mock that answers in order and records calls. */
function mockFetch(...responses: Response[]) {
  const fn = vi.fn<FetchImpl>();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn;
}

function bodyOf(fn: ReturnType<typeof mockFetch>, call: number) {
  return JSON.parse(String((fn.mock.calls[call][1] as RequestInit).body));
}

describe('urls', () => {
  it('normalizes pasted base URLs', () => {
    expect(normalizeBaseUrl(' https://mealie.mydomain.io/api/ ')).toBe('https://mealie.mydomain.io');
  });

  it('builds group-scoped front-end links', () => {
    expect(recipeUrl(CONFIG.baseUrl, 'home', 'soup')).toBe('https://mealie.mydomain.io/g/home/r/soup');
    expect(createRecipeUrl(CONFIG.baseUrl, 'home')).toBe('https://mealie.mydomain.io/g/home/r/create/url');
  });
});

describe('recipes', () => {
  it('trims a RecipeSummary and drops rows without id/slug', () => {
    expect(toMealieRecipe({
      id: 'r1', slug: 'soup', name: ' Soup ', tags: [{ name: 'quick' }], recipeCategory: [{ name: 'Dinner' }],
      totalTime: '30 min', rating: 0, image: 'abc',
    })).toEqual({
      id: 'r1', slug: 'soup', name: 'Soup', description: null, tags: ['quick'], categories: ['Dinner'],
      total_time: '30 min', rating: null, has_image: true,
    });
    expect(toMealieRecipe({ slug: 'x' })).toBeNull();
  });

  it('pages through the library with the bearer token', async () => {
    const fetchImpl = mockFetch(
      json({ items: [{ id: 'a', slug: 'a', name: 'A' }], total_pages: 2 }),
      json({ items: [{ id: 'b', slug: 'b', name: 'B' }], total_pages: 2 }),
    );
    const recipes = await listAllRecipes(CONFIG, fetchImpl);
    expect(recipes.map((r) => r.id)).toEqual(['a', 'b']);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/api/recipes?page=2&perPage=200');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('explains a rejected token', async () => {
    await expect(listAllRecipes(CONFIG, mockFetch(json({ detail: 'nope' }, 401))))
      .rejects.toThrow(/rejected the API token/);
  });
});

describe('made this', () => {
  it('moves last-made forward', async () => {
    const fetchImpl = mockFetch(json({ lastMade: '2026-10-01T00:00:00Z' }), json(undefined, 200));
    expect(await bumpLastMade(CONFIG, 'soup', '2026-10-28T18:00:00.000Z', fetchImpl)).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://mealie.mydomain.io/api/households/self/recipes/soup');
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://mealie.mydomain.io/api/recipes/soup/last-made');
    expect(bodyOf(fetchImpl, 1)).toEqual({ timestamp: '2026-10-28T18:00:00.000Z' });
  });

  it('never moves last-made backward', async () => {
    const fetchImpl = mockFetch(json({ lastMade: '2026-10-28T00:00:00Z' }));
    expect(await bumpLastMade(CONFIG, 'soup', '2026-10-01T18:00:00.000Z', fetchImpl)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a missing household row as never made', async () => {
    const fetchImpl = mockFetch(json({ detail: 'not found' }, 404), json(undefined, 200));
    expect(await bumpLastMade(CONFIG, 'soup', '2026-10-01T18:00:00.000Z', fetchImpl)).toBe(true);
  });

  it('posts a comment event and returns its id', async () => {
    const fetchImpl = mockFetch(json({ id: 'evt1' }));
    const id = await createMadeThisEvent(CONFIG, {
      recipeId: 'r1', recipeSlug: 'soup', madeAt: '2026-10-28T18:00:00.000Z', mealLabel: 'Dinner', notes: 'More salt',
    }, fetchImpl);
    expect(id).toBe('evt1');
    expect(bodyOf(fetchImpl, 0)).toEqual({
      recipeId: 'r1',
      subject: 'Made this for dinner (via WhereWeWere)',
      eventType: 'comment',
      eventMessage: 'More salt',
      timestamp: '2026-10-28T18:00:00.000Z',
    });
  });

  it('ignores an already-deleted event but not other errors', async () => {
    await expect(deleteMadeThisEvent(CONFIG, 'evt1', mockFetch(json({ detail: 'gone' }, 404)))).resolves.toBeUndefined();
    await expect(deleteMadeThisEvent(CONFIG, 'evt1', mockFetch(json({ detail: 'boom' }, 500))))
      .rejects.toBeInstanceOf(MealieError);
  });
});

describe('meal plan', () => {
  it('creates recipe entries and title-only entries', async () => {
    const fetchImpl = mockFetch(json({ id: 7 }), json({ id: 8 }));
    expect(await createMealPlanEntry(CONFIG, { date: '2026-10-28', entryType: 'dinner', recipeId: 'r1' }, fetchImpl)).toBe('7');
    await createMealPlanEntry(CONFIG, { date: '2026-10-29', entryType: 'lunch', title: 'Risotto', text: 'Why not' }, fetchImpl);
    expect(bodyOf(fetchImpl, 0)).toEqual({ date: '2026-10-28', entryType: 'dinner', recipeId: 'r1' });
    expect(bodyOf(fetchImpl, 1)).toEqual({ date: '2026-10-29', entryType: 'lunch', title: 'Risotto', text: 'Why not' });
  });
});
