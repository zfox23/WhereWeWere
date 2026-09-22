/**
 * Tracks "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'tracks'. The typed payload arrives in
 * `item.data` (built by the server's `reflectionBranch`).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Route } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { formatDistance, type DistanceUnit } from '../../location/ui/geo';
import { settings } from '../../../client/src/api/client';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';

interface TrackReflectionData {
  name?: string | null;
  activity_type?: string | null;
  started_at?: string | null;
  timezone?: string | null;
  distance_m?: number | null;
  elapsed_time_s?: number | null;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(new Date(dateStr));
}

export function TrackReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as TrackReflectionData;
  const name = data.name || 'Track';
  const activityType = data.activity_type ? `${data.activity_type} ` : '';
  const distanceM = typeof data.distance_m === 'number' ? data.distance_m : 0;
  const elapsedS = typeof data.elapsed_time_s === 'number' ? data.elapsed_time_s : 0;
  const timezone = data.timezone ?? null;
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('metric');

  useEffect(() => {
    settings
      .get()
      .then((s) => {
        if (s.distance_unit === 'metric' || s.distance_unit === 'imperial') {
          setDistanceUnit(s.distance_unit);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/tracks/${item.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors inline-flex items-center gap-1"
        >
          <Route size={13} className="shrink-0" />
          {activityType}
          {name}
        </Link>
        <span className="text-gray-500 dark:text-gray-400">
          {formatDistance(distanceM, distanceUnit)} in {formatDuration(elapsedS)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <Link
          to={`/tracks/${item.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {formatReflectionTime(item.checked_in_at, timezone)}
        </Link>
      </div>
    </div>
  );
}
