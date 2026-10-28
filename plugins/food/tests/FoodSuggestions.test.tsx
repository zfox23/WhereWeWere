import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FoodSuggestions from '../ui/FoodSuggestions';
import { filterRecipes } from '../ui/RecipePicker';

const apiMocks = vi.hoisted(() => ({
  mealieStatus: vi.fn(),
  suggest: vi.fn(),
  suggestStatus: vi.fn(),
  addToMealPlan: vi.fn(),
  locationList: vi.fn(),
}));

vi.mock('../ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/api')>()),
  food: {
    mealieStatus: apiMocks.mealieStatus,
    suggest: apiMocks.suggest,
    suggestStatus: apiMocks.suggestStatus,
    addToMealPlan: apiMocks.addToMealPlan,
  },
}));

vi.mock('../../../client/src/api/client', () => ({
  checkins: { list: apiMocks.locationList },
}));

const RESULT = {
  suggestions: [
    { date: '2026-10-28', meal_type: 'dinner', kind: 'recipe', recipe_id: 'r1', recipe_slug: 'soup', title: 'Black Bean Soup', reason: 'Cold and rainy.' },
    { date: '2026-10-29', meal_type: 'dinner', kind: 'idea', recipe_id: null, recipe_slug: null, title: 'Mushroom risotto', reason: 'Something new.' },
  ],
  missing: [],
  weather: true,
  library_size: 12,
};

function renderIt() {
  return render(<MemoryRouter><FoodSuggestions /></MemoryRouter>);
}

describe('FoodSuggestions', () => {
  beforeEach(() => {
    apiMocks.mealieStatus.mockResolvedValue({
      configured: true, reachable: true, base_url: 'https://mealie.mydomain.io', group_slug: 'home', create_recipe_url: 'x',
    });
    apiMocks.locationList.mockResolvedValue([{ venue_latitude: '40.7', venue_longitude: '-74' }]);
    apiMocks.suggest.mockResolvedValue({ task_id: 't1' });
    apiMocks.suggestStatus.mockResolvedValue({ status: 'done', result: RESULT });
    apiMocks.addToMealPlan.mockResolvedValue({ results: [{ ok: true, id: '1' }, { ok: true, id: '2' }] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('describes each stop of the comfort-variety slider', () => {
    renderIt();
    const slider = screen.getByLabelText('Comfort or variety?');
    expect(screen.getByText(/Mix reliable favorites/)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText(/Repeats are welcome/)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByText(/Something different every time/)).toBeTruthy();
  });

  it('sends the chosen meals, days, variety and last location, then adds results to the meal plan', async () => {
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole('button', { name: 'All' }));
    const days = screen.getByLabelText(/Days ahead/);
    await user.clear(days);
    await user.type(days, '3');
    fireEvent.change(screen.getByLabelText('Comfort or variety?'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: /Suggest/ }));

    await waitFor(() => expect(screen.getByText('Mushroom risotto')).toBeTruthy(), { timeout: 4000 });
    expect(apiMocks.suggest).toHaveBeenCalledWith(expect.objectContaining({
      meal_types: ['breakfast', 'lunch', 'dinner', 'snack'],
      days: 3,
      variety: 'adventurous',
      latitude: 40.7,
      longitude: -74,
    }));
    expect(screen.getByText('Not in Mealie')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Black Bean Soup/ }).getAttribute('href'))
      .toBe('https://mealie.mydomain.io/g/home/r/soup');

    await user.click(screen.getByRole('button', { name: /Add all to Mealie meal plan/ }));
    await waitFor(() => expect(screen.getAllByText('In meal plan')).toHaveLength(2));
    expect(apiMocks.addToMealPlan).toHaveBeenCalledWith([
      { date: '2026-10-28', meal_type: 'dinner', recipe_id: 'r1', title: 'Black Bean Soup', reason: 'Cold and rainy.' },
      { date: '2026-10-29', meal_type: 'dinner', recipe_id: null, title: 'Mushroom risotto', reason: 'Something new.' },
    ]);
  });

  it('surfaces server errors', async () => {
    apiMocks.suggestStatus.mockResolvedValue({ status: 'error', error: 'Set up the LLM integration first.' });
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: /Suggest/ }));
    await waitFor(() => expect(screen.getByText(/Set up the LLM integration first/)).toBeTruthy(), { timeout: 4000 });
  });
});

describe('filterRecipes', () => {
  const recipes = [
    { id: '1', slug: 'a', name: 'Crème Brûlée', description: null, tags: ['dessert'], categories: [], total_time: null, rating: null, has_image: false },
    { id: '2', slug: 'b', name: 'Chicken Curry', description: null, tags: ['quick'], categories: ['Dinner'], total_time: null, rating: null, has_image: false },
  ];

  it('matches every term across name, tags and categories, ignoring accents', () => {
    expect(filterRecipes(recipes, 'creme').map((r) => r.id)).toEqual(['1']);
    expect(filterRecipes(recipes, 'quick dinner').map((r) => r.id)).toEqual(['2']);
    expect(filterRecipes(recipes, '  ')).toHaveLength(2);
  });
});
