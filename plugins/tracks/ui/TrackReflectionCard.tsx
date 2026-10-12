/**
 * Tracks "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'tracks'. The typed payload arrives in
 * `item.data` (built by the server's `reflectionBranch`).
 */

import { useEffect, useState } from 'react';
import { Route } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { formatDistance, type DistanceUnit } from '../../location/ui/geo';
import { settings } from '../../../client/src/api/client';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';

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

export function TrackReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as TrackReflectionData;
  const name = data.name || 'Track';
  const activityType = data.activity_type ? `${data.activity_type} ` : '';
  const distanceM = typeof data.distance_m === 'number' ? data.distance_m : 0;
  const elapsedS = typeof data.elapsed_time_s === 'number' ? data.elapsed_time_s : 0;
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
    <ReflectionCard
      to={`/tracks/${item.id}`}
      icon={<Route size={13} className="shrink-0 text-rose-500" />}
      title={`${activityType}${name}`}
      titleClassName="font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
      meta={`${formatDistance(distanceM, distanceUnit)} in ${formatDuration(elapsedS)}`}
      checkedInAt={item.checked_in_at}
      timezone={data.timezone}
    />
  );
}
