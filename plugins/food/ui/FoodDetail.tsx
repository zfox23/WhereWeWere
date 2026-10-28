/**
 * Food check-in detail page: /food-checkins/:id
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, ExternalLink, Loader2, MapPin, Pencil, Trash2, Users, UtensilsCrossed } from 'lucide-react';
import { BackButton } from '../../../client/src/components/BackButton';
import Stars from '../../../client/src/components/Stars';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { CompanionName } from '../../../client/src/components/CompanionName';
import { checkins as locationCheckins } from '../../../client/src/api/client';
import { formatDate, formatTime, localDateKey, normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';
import { usePageTitle } from '../../../client/src/utils/pageTitle';
import { MEAL_TYPE_LABELS } from '../manifest';
import { food, mealieRecipeUrl, type FoodCheckin, type MealieStatus } from './api';

export default function FoodDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [row, setRow] = useState<FoodCheckin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MealieStatus | null>(null);
  // undefined = loading/none, null = the linked check-in is gone.
  const [venue, setVenue] = useState<{ name: string } | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  usePageTitle(row ? `${row.recipe_name} · Food` : 'Food Check-In');

  useEffect(() => {
    if (!id) return;
    food.get(id).then(setRow).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    food.mealieStatus().then(setStatus).catch(() => setStatus(null));
  }, [id]);

  useEffect(() => {
    if (!row?.location_checkin_id) return;
    locationCheckins.get(row.location_checkin_id)
      .then((c) => setVenue({ name: c.venue_name }))
      .catch(() => setVenue(null));
  }, [row?.location_checkin_id]);

  const remove = async () => {
    if (!row || !window.confirm('Are you sure you want to delete this food check-in?')) return;
    setDeleting(true);
    try {
      await food.remove(row.id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (error) return <div className="py-16 text-center text-sm text-red-600 dark:text-red-400">{error}</div>;
  if (!row) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const tz = normalizeTimezoneForDisplay(row.checkin_timezone);
  const dayKey = localDateKey(row.checked_in_at, tz);
  const recipeUrl = row.mealie_recipe_slug ? mealieRecipeUrl(status, row.mealie_recipe_slug) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <BackButton />

      <div className="mt-4 rounded-2xl border border-white/40 dark:border-gray-700/40 bg-white/60 dark:bg-gray-900/60 shadow-sm shadow-black/3 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <UtensilsCrossed size={22} className="text-orange-500 shrink-0 mt-1" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">{row.recipe_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="rounded-full bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                {MEAL_TYPE_LABELS[row.meal_type]}
              </span>
              <span>{formatDate(row.checked_in_at, tz)} · {formatTime(row.checked_in_at, tz)}</span>
              <Link
                to={`/?from=${dayKey}&to=${dayKey}`}
                aria-label="View this day on Home"
                title="View this day on Home"
                className="inline-flex items-center justify-center rounded-md p-1 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <CalendarDays size={14} />
              </Link>
            </div>
          </div>
        </div>

        {row.rating != null && <Stars value={row.rating} size={18} />}

        {recipeUrl && (
          <a href={recipeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline">
            View recipe in Mealie <ExternalLink size={13} />
          </a>
        )}

        {row.location_checkin_id && (
          <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <MapPin size={14} className="text-gray-400" />
            {venue === null ? (
              <span className="text-gray-400">The linked location check-in was deleted.</span>
            ) : (
              <Link to={`/location-checkins/${row.location_checkin_id}`} className="hover:text-primary-600 hover:underline">
                {venue?.name ?? 'Location check-in'}
              </Link>
            )}
          </div>
        )}

        {row.companions.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
            <Users size={14} className="text-gray-400 shrink-0" />
            {row.companions.map((name) => <CompanionName key={name} name={name} />)}
          </p>
        )}

        {row.notes && <MarkdownNote note={row.notes} />}

        <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Link
            to={`/food-check-in?edit=${row.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Pencil size={14} /> Edit
          </Link>
          <button
            onClick={remove}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
