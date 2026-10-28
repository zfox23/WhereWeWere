/**
 * Profile > Food > Suggestions: ask the configured LLM what to cook over the
 * next N days, from the Mealie library, recent meal history, the forecast and
 * a comfort-vs-variety preference; then add picks to Mealie's meal plan.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check, CloudSun, ExternalLink, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { checkins as locationCheckins } from '../../../client/src/api/client';
import { deviceTimezone } from '../../../client/src/utils/slugify';
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '../manifest';
import { food, mealieRecipeUrl, type MealieStatus, type Suggestion, type SuggestionResult, type Variety } from './api';

export const VARIETY_STOPS: { value: Variety; label: string; description: string }[] = [
  {
    value: 'comfort',
    label: 'Comfort rotation',
    description: 'Lean on the favorites you’ve been making lately. Repeats are welcome, just not two days in a row.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Mix reliable favorites with good recipes you haven’t made in a while. Nothing from the past week.',
  },
  {
    value: 'adventurous',
    label: 'Switch it up',
    description: 'Something different every time: rarely or never-made recipes, varied cuisines, nothing from the last few weeks.',
  },
];

const MAX_DAYS = 14;
const POLL_MS = 2000;

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const slotKey = (s: { date: string; meal_type: MealType }) => `${s.date}|${s.meal_type}`;

type PlanState = { state: 'adding' } | { state: 'added' } | { state: 'error'; error: string };

export default function FoodSuggestions() {
  const [mealTypes, setMealTypes] = useState<MealType[]>(['dinner']);
  // Raw text while typing (clamping per keystroke turned "" + "3" into "13").
  const [daysInput, setDaysInput] = useState('7');
  const [varietyIndex, setVarietyIndex] = useState(1);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [status, setStatus] = useState<MealieStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planStates, setPlanStates] = useState<Record<string, PlanState>>({});
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    food.mealieStatus().then(setStatus).catch(() => setStatus(null));
    return () => { cancelled.current = true; };
  }, []);

  const allSelected = mealTypes.length === MEAL_TYPES.length;
  const toggleMeal = (t: MealType) =>
    setMealTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const toggleAll = () => setMealTypes(allSelected ? ['dinner'] : [...MEAL_TYPES]);
  const variety = VARIETY_STOPS[varietyIndex];
  const days = Math.max(1, Math.min(MAX_DAYS, parseInt(daysInput, 10) || 1));

  /** The latest location check-in's coordinates, for the forecast. */
  const lastCoordinates = async (): Promise<{ latitude: number | null; longitude: number | null }> => {
    try {
      const [latest] = await locationCheckins.list({ limit: '1' });
      const latitude = Number(latest?.venue_latitude);
      const longitude = Number(latest?.venue_longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
    } catch { /* no location plugin data: suggest without weather */ }
    return { latitude: null, longitude: null };
  };

  const suggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running || mealTypes.length === 0) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setPlanStates({});
    setElapsed(0);
    const started = Date.now();
    try {
      const coords = await lastCoordinates();
      const { task_id } = await food.suggest({
        meal_types: mealTypes,
        days,
        start_date: todayLocal(),
        variety: variety.value,
        timezone: deviceTimezone(),
        ...coords,
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled.current) return;
        setElapsed(Math.round((Date.now() - started) / 1000));
        const poll = await food.suggestStatus(task_id);
        if (poll.status === 'running') continue;
        if (poll.status === 'error') throw new Error(poll.error);
        setResult(poll.result);
        setSelected(new Set(poll.result.suggestions.map(slotKey)));
        break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get suggestions');
    } finally {
      if (!cancelled.current) setRunning(false);
    }
  };

  const byDate = useMemo(() => {
    const map = new Map<string, (Suggestion | { date: string; meal_type: MealType; missing: true })[]>();
    if (!result) return map;
    const all = [
      ...result.suggestions,
      ...result.missing.map((m) => ({ ...m, missing: true as const })),
    ].sort((a, b) => a.date.localeCompare(b.date) || MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type));
    for (const s of all) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  }, [result]);

  const toAdd = result?.suggestions.filter((s) => selected.has(slotKey(s)) && planStates[slotKey(s)]?.state !== 'added') ?? [];
  const canPlan = status?.configured === true;

  const addToPlan = async (items: Suggestion[]) => {
    if (items.length === 0) return;
    setPlanStates((prev) => ({ ...prev, ...Object.fromEntries(items.map((s) => [slotKey(s), { state: 'adding' }])) }));
    try {
      const { results } = await food.addToMealPlan(items.map((s) => ({
        date: s.date, meal_type: s.meal_type, recipe_id: s.recipe_id, title: s.title, reason: s.reason,
      })));
      setPlanStates((prev) => ({
        ...prev,
        ...Object.fromEntries(items.map((s, i) => [slotKey(s), results[i]?.ok
          ? { state: 'added' }
          : { state: 'error', error: results[i]?.error ?? 'Failed' }])),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      setPlanStates((prev) => ({ ...prev, ...Object.fromEntries(items.map((s) => [slotKey(s), { state: 'error', error: message }])) }));
    }
  };

  const pill = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${
      active
        ? 'bg-primary-600 border-primary-600 text-white'
        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-primary-400'
    }`;

  return (
    <section className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sparkles size={18} className="text-orange-500" /> Suggestions
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          What to cook next, based on your recent meals, your Mealie recipes and the forecast.
        </p>
      </div>

      <form onSubmit={suggest} className="space-y-5">
        <div>
          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Meals</span>
          <div className="flex flex-wrap gap-2">
            {MEAL_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={mealTypes.includes(t)} onClick={() => toggleMeal(t)} className={pill(mealTypes.includes(t))}>
                {MEAL_TYPE_LABELS[t]}
              </button>
            ))}
            <button type="button" aria-pressed={allSelected} onClick={toggleAll} className={pill(allSelected)}>
              All
            </button>
          </div>
        </div>

        <div className="max-w-[12rem]">
          <label htmlFor="food-suggest-days" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Days ahead (starting today)
          </label>
          <input
            id="food-suggest-days"
            type="number"
            min={1}
            max={MAX_DAYS}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            onBlur={() => setDaysInput(String(days))}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="food-suggest-variety" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Comfort or variety?
          </label>
          <input
            id="food-suggest-variety"
            type="range"
            min={0}
            max={VARIETY_STOPS.length - 1}
            step={1}
            value={varietyIndex}
            onChange={(e) => setVarietyIndex(Number(e.target.value))}
            aria-valuetext={variety.label}
            className="w-full accent-primary-600"
          />
          <div className="mt-1 grid grid-cols-3 text-xs">
            {VARIETY_STOPS.map((stop, i) => (
              <button
                key={stop.value}
                type="button"
                onClick={() => setVarietyIndex(i)}
                className={`${i === 0 ? 'text-left' : i === VARIETY_STOPS.length - 1 ? 'text-right' : 'text-center'} ${
                  i === varietyIndex ? 'font-semibold text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {stop.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{variety.description}</p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={running || mealTypes.length === 0} className="btn-primary inline-flex items-center gap-2">
            {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {running ? 'Thinking…' : 'Suggest'}
          </button>
          {running && elapsed > 0 && <span className="text-xs text-gray-400">{elapsed}s</span>}
          {mealTypes.length === 0 && <span className="text-xs text-gray-500">Pick at least one meal.</span>}
        </div>
      </form>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <CloudSun size={13} />
            {result.weather ? 'Forecast taken into account.' : 'No forecast used (no recent location check-in).'}
            {' '}{result.library_size} Mealie recipes considered.
          </p>

          {[...byDate].map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatDay(date)}</h3>
              <ul className="mt-1.5 space-y-2">
                {items.map((s) => {
                  const key = slotKey(s);
                  if ('missing' in s) {
                    return (
                      <li key={key} className="text-sm text-gray-400">
                        {MEAL_TYPE_LABELS[s.meal_type]}: no suggestion
                      </li>
                    );
                  }
                  const url = s.recipe_slug ? mealieRecipeUrl(status, s.recipe_slug) : null;
                  const plan = planStates[key];
                  return (
                    <li key={key} className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 px-3 py-2">
                      {canPlan && (
                        <input
                          type="checkbox"
                          aria-label={`Add ${s.title} to the meal plan`}
                          checked={selected.has(key)}
                          disabled={plan?.state === 'added' || plan?.state === 'adding'}
                          onChange={() => setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          })}
                          className="mt-1 accent-primary-600"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">
                            {MEAL_TYPE_LABELS[s.meal_type]}
                          </span>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-600">
                              {s.title} <ExternalLink size={12} className="text-gray-400" />
                            </a>
                          ) : (
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.title}</span>
                          )}
                          {s.kind === 'idea' && (
                            <span className="rounded-full bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                              Not in Mealie
                            </span>
                          )}
                          {plan?.state === 'added' && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-green-600"><Check size={12} /> In meal plan</span>
                          )}
                          {plan?.state === 'adding' && <Loader2 size={12} className="animate-spin text-gray-400" />}
                        </div>
                        {s.reason && <p className="text-sm text-gray-600 dark:text-gray-300">{s.reason}</p>}
                        {plan?.state === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{plan.error}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {canPlan ? (
            <button
              type="button"
              onClick={() => addToPlan(toAdd)}
              disabled={toAdd.length === 0}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <CalendarPlus size={16} />
              Add {toAdd.length === result.suggestions.length ? 'all' : toAdd.length} to Mealie meal plan
            </button>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Connect Mealie in <Link to="/settings?tab=plugin:food" className="underline">Settings &gt; Food</Link> to add these to your meal plan.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
