/**
 * Food check-in type — manifest (pure data, shared by client and server).
 *
 * Food is a custom-storage plugin (`food_checkins`): it needs companions,
 * Mealie writeback on save/delete, and a link to a location check-in, none
 * of which the generic store has hooks for. `fields` still describes the
 * data shape for documentation and the generic detail fallbacks.
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export function isMealType(value: unknown): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value);
}

export const manifest: CheckinTypeManifest = {
  id: 'food',
  version: '1.0.0',
  filterParams: ['meal_type'],
  fields: [
    {
      name: 'meal_type',
      kind: 'select',
      label: 'Meal',
      required: true,
      options: MEAL_TYPES.map((value) => ({ value, label: MEAL_TYPE_LABELS[value] })),
    },
    { name: 'recipe_name', kind: 'text', label: 'What you ate', required: true },
    { name: 'rating', kind: 'rating', label: 'Rating', min: 1, max: 4 },
    { name: 'notes', kind: 'textarea', label: 'Notes' },
  ],
  strings: {
    title: 'Food',
    singular: 'food check-in',
    plural: 'food check-ins',
    newCheckIn: 'What did you eat?',
    profileTab: 'Food',
    confirmDelete: 'Are you sure you want to delete this food check-in?',
  },
};
