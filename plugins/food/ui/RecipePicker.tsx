/**
 * Searchable picker over the Mealie recipe library, with an "add it in
 * Mealie" escape hatch (opens Mealie's create page in a new tab; Refresh
 * re-reads the library when the user comes back).
 */

import { useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import type { MealieRecipe, MealieStatus } from './api';

interface RecipePickerProps {
  recipes: MealieRecipe[];
  loading: boolean;
  error: string | null;
  status: MealieStatus | null;
  selectedId: string | null;
  /** Shown when the selected recipe is no longer in the library. */
  selectedName: string | null;
  onSelect: (recipe: MealieRecipe | null) => void;
  onRefresh: () => void;
}

/** Case- and accent-insensitive match on name, tags and categories. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function filterRecipes(recipes: MealieRecipe[], q: string): MealieRecipe[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return recipes;
  return recipes.filter((r) => {
    const hay = fold([r.name, ...r.tags, ...r.categories].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

export default function RecipePicker({
  recipes, loading, error, status, selectedId, selectedName, onSelect, onRefresh,
}: RecipePickerProps) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => filterRecipes(recipes, q), [recipes, q]);
  const selected = selectedId ? recipes.find((r) => r.id === selectedId) ?? null : null;
  const createUrl = status?.configured ? status.create_recipe_url : null;

  if (selectedId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/20 px-3 py-2">
        <Check size={16} className="text-primary-600 dark:text-primary-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {selected?.name ?? selectedName ?? 'Recipe'}
          </div>
          {selected?.total_time && (
            <div className="text-xs text-gray-500 dark:text-gray-400">{selected.total_time}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-800"
        >
          <X size={13} /> Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={loading ? 'Loading your recipes…' : `Search ${recipes.length} recipes`}
          className="input pl-9"
          aria-label="Search Mealie recipes"
          disabled={loading && recipes.length === 0}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !error && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 bg-white/70 dark:bg-gray-900/40">
          {matches.length === 0 && (
            <li className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
              {recipes.length === 0 ? 'Your Mealie library is empty.' : `No recipes match “${q}”.`}
            </li>
          )}
          {matches.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 dark:hover:bg-gray-800 focus:bg-primary-50 dark:focus:bg-gray-800 focus:outline-none"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.name}</div>
                {(r.total_time || r.tags.length > 0 || r.categories.length > 0) && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {[r.total_time, ...r.categories, ...r.tags].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {createUrl && (
          <a
            href={createUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Can&rsquo;t find it? Add it in Mealie <ExternalLink size={12} />
          </a>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
          title="Re-read your Mealie library (e.g. after adding a recipe)"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh recipes
        </button>
      </div>
    </div>
  );
}
