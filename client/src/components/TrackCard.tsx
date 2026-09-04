import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, Route } from 'lucide-react';
import type { TimelineItem, ImmichAsset, Scrobble } from '../types';
import { formatDistance, type DistanceUnit } from '../utils/geo';
import { settings } from '../api/client';
import { ScrobbleList } from './ScrobbleList';
import { CardShell } from './checkin-card/CardShell';
import { PhotoSection } from './checkin-card/PhotoSection';
import { TimestampLink } from './checkin-card/TimestampLink';
import { useResolvedPhotos } from './checkin-card/useResolvedPhotos';

interface TrackCardProps {
  item: TimelineItem;
  immichUrl?: string | null;
  photos?: ImmichAsset[] | null;
  scrobbles?: Scrobble[];
  malojaUrl?: string | null;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export default function TrackCard({ item, immichUrl, photos, scrobbles, malojaUrl }: TrackCardProps) {
  const { pathname } = useLocation();
  const resolvedAssets = useResolvedPhotos(item.id, immichUrl, photos);
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

  const name = item.track_name || 'Track';
  const startedAt = item.track_started_at || item.checked_in_at;
  const timezone = item.track_timezone || 'UTC';
  const distanceM = Number(item.track_distance_m || 0);
  const elapsedS = Number(item.track_elapsed_time_s || 0);

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

          {scrobbles && <ScrobbleList scrobbles={scrobbles} checkedInAt={startedAt} malojaUrl={malojaUrl} />}

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
