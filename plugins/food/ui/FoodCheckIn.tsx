/**
 * Food check-in page (create + edit via ?edit=<id>).
 *
 * The meal is either a recipe from the Mealie library or free text (eaten
 * out, leftovers, ...). `?location_checkin_id=<id>` (the "Add what I ate"
 * button on a location check-in) pre-links that check-in and takes its time
 * and companions.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import type { CheckInFormProps } from 'wwp-shared';
import ScorePicker from '../../../client/src/components/ScorePicker';
import CompanionChipInput from '../../../client/src/components/CompanionChipInput';
import { checkins as locationCheckins } from '../../../client/src/api/client';
import { deviceTimezone, localDatetimeToIso, nowLocalDatetimeValue } from '../../../client/src/utils/slugify';
import { usePageTitle } from '../../../client/src/utils/pageTitle';
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '../manifest';
import { food, mealTypeForHour, type FoodCheckinInput, type MealieRecipe, type MealieStatus, type MealieSync } from './api';
import RecipePicker from './RecipePicker';

interface LocationOption {
  id: string;
  venue_name: string;
  checked_in_at: string;
}

function isoToLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function locationLabel(l: LocationOption): string {
  const when = new Date(l.checked_in_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `${l.venue_name} · ${when}`;
}

const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5';

export default function FoodCheckIn({ editId = null, dateParam = null, onCreated }: CheckInFormProps) {
  const navigate = useNavigate();
  const prefillLocationId = new URLSearchParams(window.location.search).get('location_checkin_id');
  usePageTitle(editId ? 'Edit Food Check-In' : 'Food Check-In');

  const [mealType, setMealType] = useState<MealType>(() => mealTypeForHour(new Date().getHours()));
  const [mode, setMode] = useState<'recipe' | 'other'>('recipe');
  const [recipe, setRecipe] = useState<{ id: string; slug: string; name: string } | null>(null);
  const [otherName, setOtherName] = useState('');
  const [dateTime, setDateTime] = useState(() =>
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? `${dateParam}T18:00` : nowLocalDatetimeValue());
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [companions, setCompanions] = useState<string[]>([]);
  const [locationId, setLocationId] = useState<string>('');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  // As loaded in edit mode, so an untouched date/time keeps its stored instant and zone.
  const [loaded, setLoaded] = useState<{ dateTime: string; iso: string; timezone: string | null } | null>(null);

  const [status, setStatus] = useState<MealieStatus | null>(null);
  const [recipes, setRecipes] = useState<MealieRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState<string | null>(null);

  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const loadRecipes = useCallback(async (refresh = false) => {
    setRecipesLoading(true);
    setRecipesError(null);
    try {
      const { recipes: list } = await food.recipes(refresh);
      setRecipes(list);
    } catch (err) {
      setRecipesError(err instanceof Error ? err.message : 'Could not load Mealie recipes');
    } finally {
      setRecipesLoading(false);
    }
  }, []);

  // Mealie status + library. Without Mealie the form falls back to free text.
  useEffect(() => {
    food.mealieStatus()
      .then((s) => {
        setStatus(s);
        if (s.configured) loadRecipes();
        else if (!editId) setMode('other');
      })
      .catch(() => setStatus({ configured: false }));
  }, [editId, loadRecipes]);

  // Recent location check-ins for the "Where" picker.
  useEffect(() => {
    locationCheckins.list({ limit: '25' })
      .then((rows) => setLocations(rows.map((r) => ({ id: r.id, venue_name: r.venue_name, checked_in_at: r.checked_in_at }))))
      .catch(() => setLocations([]));
  }, []);

  // A linked check-in that isn't among the recent ones still needs a label.
  const ensureLocationOption = useCallback(async (id: string) => {
    try {
      const row = await locationCheckins.get(id);
      setLocations((prev) => prev.some((l) => l.id === id)
        ? prev
        : [{ id, venue_name: row.venue_name, checked_in_at: row.checked_in_at }, ...prev]);
      return row;
    } catch {
      return null;
    }
  }, []);

  // Edit mode: load the check-in.
  useEffect(() => {
    if (!editId) return;
    food.get(editId)
      .then((row) => {
        setMealType(row.meal_type);
        if (row.mealie_recipe_id && row.mealie_recipe_slug) {
          setMode('recipe');
          setRecipe({ id: row.mealie_recipe_id, slug: row.mealie_recipe_slug, name: row.recipe_name });
        } else {
          setMode('other');
          setOtherName(row.recipe_name);
        }
        const local = isoToLocalDatetimeValue(row.checked_in_at);
        setDateTime(local);
        setLoaded({ dateTime: local, iso: row.checked_in_at, timezone: row.checkin_timezone });
        setRating(row.rating ?? 0);
        setNotes(row.notes ?? '');
        setCompanions(row.companions);
        if (row.location_checkin_id) {
          setLocationId(row.location_checkin_id);
          ensureLocationOption(row.location_checkin_id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load check-in'))
      .finally(() => setLoading(false));
  }, [editId, ensureLocationOption]);

  // "Add what I ate" from a location check-in: take its time and companions.
  useEffect(() => {
    if (editId || !prefillLocationId) return;
    setLocationId(prefillLocationId);
    setMode('other');
    ensureLocationOption(prefillLocationId).then((row) => {
      if (!row) return;
      setDateTime(isoToLocalDatetimeValue(row.checked_in_at));
      setMealType(mealTypeForHour(new Date(row.checked_in_at).getHours()));
      if (Array.isArray(row.companions)) setCompanions(row.companions);
    });
  }, [editId, prefillLocationId, ensureLocationOption]);

  const buildInput = (): FoodCheckinInput | null => {
    const name = mode === 'recipe' ? recipe?.name : otherName.trim();
    if (!name) {
      setError(mode === 'recipe' ? 'Pick a recipe, or switch to “Something else”.' : 'Describe what you ate.');
      return null;
    }
    const unchangedTime = loaded && loaded.dateTime === dateTime;
    return {
      meal_type: mealType,
      recipe_name: name,
      mealie_recipe_id: mode === 'recipe' ? recipe?.id ?? null : null,
      mealie_recipe_slug: mode === 'recipe' ? recipe?.slug ?? null : null,
      rating: rating > 0 ? rating : null,
      notes: notes.trim() || null,
      location_checkin_id: locationId || null,
      checked_in_at: unchangedTime ? loaded.iso : localDatetimeToIso(dateTime),
      checkin_timezone: unchangedTime ? loaded.timezone : deviceTimezone(),
      companions,
    };
  };

  const afterSave = (sync: MealieSync, done: () => void) => {
    if (sync.status === 'failed' && sync.message) {
      setSyncNotice(sync.message);
      setSaving(false);
      return;
    }
    done();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (editId) {
        const row = await food.update(editId, input);
        afterSave(row.mealie_sync, () => navigate(`/food-checkins/${editId}`));
      } else {
        const row = await food.create(input);
        afterSave(row.mealie_sync, () => onCreated(row.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editId || !window.confirm('Are you sure you want to delete this food check-in?')) return;
    setDeleting(true);
    try {
      await food.remove(editId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (syncNotice) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-8">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>{syncNotice}</p>
        </div>
        <button type="button" onClick={() => navigate(editId ? `/food-checkins/${editId}` : '/')} className="btn-primary">
          Continue
        </button>
      </div>
    );
  }

  const mealieConfigured = status?.configured === true;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {editId ? 'Edit meal' : 'What did you eat?'}
      </h1>

      <form
        onSubmit={submit}
        className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 space-y-5"
      >
        <div>
          <span className={labelClass}>Meal</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Meal">
            {MEAL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={mealType === t}
                onClick={() => setMealType(t)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${
                  mealType === t
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-primary-400'
                }`}
              >
                {MEAL_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">What</span>
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-0.5 text-xs">
              {(['recipe', 'other'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={m === 'recipe' && !mealieConfigured}
                  title={m === 'recipe' && !mealieConfigured ? 'Connect Mealie in Settings > Food' : undefined}
                  className={`rounded-md px-2.5 py-1 font-medium disabled:opacity-40 ${
                    mode === m ? 'bg-primary-600 text-white' : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {m === 'recipe' ? 'Mealie recipe' : 'Something else'}
                </button>
              ))}
            </div>
          </div>
          {mode === 'recipe' ? (
            <RecipePicker
              recipes={recipes}
              loading={recipesLoading}
              error={recipesError}
              status={status}
              selectedId={recipe?.id ?? null}
              selectedName={recipe?.name ?? null}
              onSelect={(r) => setRecipe(r ? { id: r.id, slug: r.slug, name: r.name } : null)}
              onRefresh={() => loadRecipes(true)}
            />
          ) : (
            <>
              <input
                type="text"
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder="e.g. Pad thai, leftovers, scrambled eggs"
                maxLength={200}
                className="input"
                aria-label="What you ate"
              />
              {!mealieConfigured && status && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Connect Mealie in Settings &gt; Food to pick from your recipes.
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="food-when" className={labelClass}>Date &amp; Time</label>
            <input
              id="food-when"
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="input"
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Time zone: {loaded && loaded.dateTime === dateTime && loaded.timezone ? loaded.timezone : deviceTimezone()}
            </p>
          </div>
          <div>
            <label htmlFor="food-where" className={labelClass}>Where</label>
            <select id="food-where" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input">
              <option value="">Home / not linked</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{locationLabel(l)}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Link a location check-in, e.g. a restaurant.</p>
          </div>
        </div>

        <div>
          <span className={labelClass}>Rating</span>
          <ScorePicker value={rating} onChange={setRating} />
        </div>

        <div>
          <span className={labelClass}>Eaten With…</span>
          <CompanionChipInput value={companions} onChange={setCompanions} />
        </div>

        <div>
          <label htmlFor="food-notes" className={labelClass}>Notes.md</label>
          <textarea
            id="food-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Tweaks you made, how it turned out…"
            className="input font-mono text-sm resize-y min-h-[100px]"
          />
          {mode === 'recipe' && mealieConfigured && (
            <p className="text-[11px] text-gray-400 mt-1">
              Saving marks the recipe as made in Mealie and adds these notes to its timeline.
            </p>
          )}
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="flex items-center justify-end gap-3">
          {editId && (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="mr-auto inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete
            </button>
          )}
          <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {editId ? 'Save changes' : 'Check in meal'}
          </button>
        </div>
      </form>
    </div>
  );
}
