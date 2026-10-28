/**
 * Food timeline card. The typed payload arrives in `item.data` (built by the
 * plugin's timeline branch); notes and companions are envelope columns.
 */

import { MapPin, UtensilsCrossed, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { CheckinCardProps } from 'wwp-shared';
import Stars from '../../../client/src/components/Stars';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { TimestampLink } from '../../../client/src/components/checkin-card/TimestampLink';
import { CompanionName } from '../../../client/src/components/CompanionName';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';
import { MEAL_TYPE_LABELS, isMealType } from '../manifest';

interface FoodData {
  meal_type?: string;
  recipe_name?: string;
  mealie_recipe_slug?: string | null;
  rating?: number | null;
  location_checkin_id?: string | null;
}

export function FoodCard({ item, compact = false }: CheckinCardProps) {
  const { pathname } = useLocation();
  const data = (item.data ?? {}) as FoodData;
  const timezone = normalizeTimezoneForDisplay(item.timezone) || item.timezone || 'UTC';
  const detailTo = `/food-checkins/${item.id}`;
  const meal = isMealType(data.meal_type) ? MEAL_TYPE_LABELS[data.meal_type] : 'Meal';
  const rating = Number(data.rating ?? 0);
  const companions = (item as { companions?: string[] | null }).companions ?? [];
  const notes = (item as { notes?: string | null }).notes;

  if (compact) {
    return (
      <CardShell compact>
        <div className="flex items-center gap-2 min-w-0">
          <UtensilsCrossed size={14} className="text-orange-500 shrink-0" />
          <Link to={detailTo} className="text-sm font-semibold text-orange-700 dark:text-orange-300 truncate">
            {data.recipe_name ?? meal}
          </Link>
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">· {meal}</span>
          {rating > 0 && <Stars value={rating} size={10} />}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <UtensilsCrossed size={16} className="text-orange-500 shrink-0" />
          <Link
            to={detailTo}
            className="text-base font-semibold text-orange-700 dark:text-orange-300 hover:text-orange-800 dark:hover:text-orange-200 transition-colors"
          >
            {data.recipe_name ?? meal}
          </Link>
          <span className="rounded-full bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
            {meal}
          </span>
          {data.location_checkin_id && (
            <Link
              to={`/location-checkins/${data.location_checkin_id}`}
              className="inline-flex items-center gap-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600"
              title="Eaten out — view the location check-in"
            >
              <MapPin size={12} /> eaten out
            </Link>
          )}
          {rating > 0 && <Stars value={rating} size={12} />}
        </div>

        {companions.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
            <Users size={13} className="text-gray-400 shrink-0" />
            {companions.map((name) => <CompanionName key={name} name={name} />)}
          </p>
        )}

        {notes && (
          <div className="mt-1">
            <MarkdownNote note={notes} collapsible />
          </div>
        )}

        <div className="mt-2">
          <TimestampLink
            to={detailTo}
            checkedInAt={item.checked_in_at}
            timezone={timezone}
            mode={pathname === '/' ? 'time' : 'full'}
            classNameOverride=""
          />
        </div>
      </div>
    </CardShell>
  );
}
