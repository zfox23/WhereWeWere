import { Link } from 'react-router-dom';
import type { PluginReflectionCardProps, ReflectionEntry } from 'wwp-shared';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';

function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(new Date(dateStr));
}

/**
 * "This day in previous years" card for location check-ins. Location
 * reflection entries keep their venue columns at the top level (the server's
 * reflection branch fills them).
 */
export function LocationReflectionCard({ item }: PluginReflectionCardProps) {
  const it = item as ReflectionEntry;
  const detailHref = it.venue_id ? `/venues/${it.venue_id}` : `/location-checkins/${it.id}`;
  const timeHref = `/location-checkins/${it.id}`;

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={detailHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {it.venue_name || 'Unknown venue'}
        </Link>
        {it.venue_category || it.city ? (
          <span className="text-gray-500 dark:text-gray-400">
            {it.venue_category}
            {it.city ? ` · ${it.city}${it.country ? `, ${it.country}` : ''}` : ''}
          </span>
        ) : null}
      </div>
      {it.note ? (
        <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">{`"${it.note}"`}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <Link
          to={timeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {formatReflectionTime(it.checked_in_at, it.venue_timezone)}
        </Link>
      </div>
    </div>
  );
}
