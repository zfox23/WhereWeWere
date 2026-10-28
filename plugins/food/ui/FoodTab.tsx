/**
 * Profile > Food: headline numbers, most-eaten meals, and the Suggestions
 * section (LLM meal planning).
 */

import { useEffect, useState } from 'react';
import { Home, Loader2, MapPin, UtensilsCrossed, BookOpen } from 'lucide-react';
import { StatCard } from '../../../client/src/components/Stats';
import Stars from '../../../client/src/components/Stars';
import { MEAL_TYPES, MEAL_TYPE_LABELS } from '../manifest';
import { food, mealieRecipeUrl, type FoodStats, type MealieStatus } from './api';
import FoodSuggestions from './FoodSuggestions';

export function FoodTab() {
  const [stats, setStats] = useState<FoodStats | null>(null);
  const [status, setStatus] = useState<MealieStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    food.stats().then(setStats).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    food.mealieStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!stats && !error && (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>
      )}
      {stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={UtensilsCrossed} label="Meals logged" value={stats.total} />
            <StatCard icon={Home} label="At home" value={stats.at_home} />
            <StatCard icon={MapPin} label="Eaten out" value={stats.eaten_out} />
            <StatCard icon={BookOpen} label="Recipes cooked" value={stats.distinct_recipes} />
          </div>

          {stats.total > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Most eaten</h3>
                <ol className="space-y-1.5">
                  {stats.top_recipes.map((r) => {
                    const url = r.mealie_recipe_slug ? mealieRecipeUrl(status, r.mealie_recipe_slug) : null;
                    return (
                      <li key={`${r.recipe_name}-${r.mealie_recipe_slug ?? ''}`} className="flex items-center gap-2 text-sm">
                        <span className="w-6 text-right text-xs tabular-nums text-gray-400">{r.count}×</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="truncate text-gray-900 dark:text-gray-100 hover:text-primary-600">{r.recipe_name}</a>
                        ) : (
                          <span className="truncate text-gray-900 dark:text-gray-100">{r.recipe_name}</span>
                        )}
                        {r.avg_rating != null && <span className="ml-auto shrink-0"><Stars value={r.avg_rating} size={11} /></span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">By meal</h3>
                <ul className="space-y-1.5">
                  {MEAL_TYPES.map((t) => {
                    const count = stats.by_meal_type[t] ?? 0;
                    const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
                    return (
                      <li key={t} className="text-sm">
                        <div className="flex justify-between text-gray-700 dark:text-gray-300">
                          <span>{MEAL_TYPE_LABELS[t]}</span>
                          <span className="tabular-nums text-gray-500">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
                          <div className="h-1.5 rounded-full bg-orange-400" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      <FoodSuggestions />
    </div>
  );
}
