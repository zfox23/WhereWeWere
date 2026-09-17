/**
 * Mood "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'mood'. The typed payload arrives in `item.data`
 * (built by the server's `reflectionBranch`).
 */

import { Link } from 'react-router-dom';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { MOOD_LABELS, MOOD_COLORS } from './MoodIcons';
import { pluginDetailPath } from '../../../client/src/plugins/registry';

function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(dateStr));
}

export function MoodReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as Record<string, unknown>;
  const mood = typeof data.mood === 'number' ? data.mood : null;
  const moodTimezone = typeof data.mood_timezone === 'string' ? data.mood_timezone : null;
  const label =
    mood && mood >= 1 && mood <= 5 ? MOOD_LABELS[mood] : 'Mood check-in';
  const detailPath = pluginDetailPath(item.type, item.id);

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-2">
        {mood ? (
          <span className={`font-semibold ${MOOD_COLORS[mood] || 'text-gray-700 dark:text-gray-300'}`}>
            {label}
          </span>
        ) : null}
      </div>
      {item.note ? (
        <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">
          {`"${item.note}"`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <Link
          to={detailPath}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {formatReflectionTime(item.checked_in_at, moodTimezone)}
        </Link>
      </div>
    </div>
  );
}
