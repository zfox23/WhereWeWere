/**
 * Tracks check-in type — timeline card.
 *
 * Adapted from the former core `components/TrackCard` to the plugin prop
 * contract (`CheckinCardProps`). Reads the legacy `track_*` timeline columns
 * off the timeline entry and integration URLs off `integrations`.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, Route } from 'lucide-react';
import type { CheckinCardProps } from 'wwp-shared';
import type { TrackTimelineFields } from './types';
import { formatDistance, type DistanceUnit } from '../../location/ui/geo';
import { settings } from '../../../client/src/api/client';
import { ScrobbleList } from '../../../client/src/components/ScrobbleList';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { PhotoSection } from '../../../client/src/components/checkin-card/PhotoSection';
import { TimestampLink } from '../../../client/src/components/checkin-card/TimestampLink';
import { useResolvedPhotos } from '../../../client/src/components/checkin-card/useResolvedPhotos';

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function TrackCard({ item, integrations, photos, scrobbles, compact = false }: CheckinCardProps) {
  const { pathname } = useLocation();
  const track = item as unknown as TrackTimelineFields;
  const immichUrl = integrations.immich_url ?? null;
  const malojaUrl = integrations.maloja_url ?? null;
  const resolvedAssets = useResolvedPhotos(item.id, immichUrl, photos as any[] | null);
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

  const name = track.track_name || 'Track';
  const startedAt = track.track_started_at || item.checked_in_at;
  const timezone = track.track_timezone || item.timezone || 'UTC';
  const distanceM = Number(track.track_distance_m || 0);
  const elapsedS = Number(track.track_elapsed_time_s || 0);

  if (compact) {
    return (
      <CardShell compact>
        <div className="flex items-center gap-2 min-w-0">
          <Route size={14} className="text-rose-500 shrink-0" />
          <Link
            to={`/tracks/${item.id}`}
            className="text-sm font-semibold text-rose-700 dark:text-rose-300 hover:text-rose-600 dark:hover:text-rose-200 transition-colors truncate"
          >
            {name}
          </Link>
          <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 truncate">
            · {formatDistance(distanceM, distanceUnit)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0">
            <Clock size={12} />
            {formatDuration(elapsedS)}
          </span>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Route size={16} className="text-rose-500 shrink-0" />
            <Link
              to={`/tracks/${item.id}`}
              className="text-base font-semibold text-rose-700 dark:text-rose-300 hover:text-rose-600 dark:hover:text-rose-200 transition-colors"
            >
              {name}
            </Link>
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium">
              {formatDistance(distanceM, distanceUnit)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {formatDuration(elapsedS)}
            </span>
          </div>

          <PhotoSection
            immichUrl={immichUrl}
            assets={resolvedAssets}
            checkedInAt={startedAt}
          />

          {scrobbles && <ScrobbleList scrobbles={scrobbles as any[]} checkedInAt={startedAt} malojaUrl={malojaUrl} />}

          <TimestampLink
            to={`/tracks/${item.id}`}
            checkedInAt={startedAt}
            timezone={timezone}
            mode={pathname === '/' ? 'time' : 'full'}
          />
        </div>
      </div>
    </CardShell>
  );
}
