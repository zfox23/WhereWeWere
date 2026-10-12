/**
 * ReflectionCard — shared layout for plugin "this day in previous years"
 * cards. Each plugin supplies its icon, title, optional meta text, note and
 * timezone; the layout (title row, quoted note, timestamp link) is uniform.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { normalizeTimezoneForDisplay } from '../../utils/checkin';

export function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(new Date(dateStr));
}

interface ReflectionCardProps {
  /** Detail-page link for the title and timestamp; null/undefined renders plain text. */
  to?: string | null;
  /** Optional leading icon (plugin accent). */
  icon?: ReactNode;
  title: string;
  /** Title classes (plugin accent color); defaults to neutral. */
  titleClassName?: string;
  /** Optional secondary text on the title row (e.g. category, distance). */
  meta?: ReactNode;
  /** Optional quoted note line. */
  note?: string | null;
  checkedInAt: string;
  timezone?: string | null;
  /** Override the timestamp link destination (defaults to `to`). */
  timeTo?: string | null;
}

export function ReflectionCard({ to, icon, title, titleClassName, meta, note, checkedInAt, timezone, timeTo }: ReflectionCardProps) {
  const titleHref = to ?? null;
  const timestampHref = timeTo ?? titleHref;
  const titleClass = titleClassName ?? 'font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors';

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {icon}
        {titleHref ? (
          <Link
            to={titleHref}
            target="_blank"
            rel="noopener noreferrer"
            className={titleClass}
          >
            {title}
          </Link>
        ) : (
          <span className={titleClass}>{title}</span>
        )}
        {meta ? <span className="text-gray-500 dark:text-gray-400">{meta}</span> : null}
      </div>
      {note ? (
        <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">{`"${note}"`}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400">
        {timestampHref ? (
          <Link
            to={timestampHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            {formatReflectionTime(checkedInAt, timezone)}
          </Link>
        ) : (
          <span>{formatReflectionTime(checkedInAt, timezone)}</span>
        )}
      </div>
    </div>
  );
}
