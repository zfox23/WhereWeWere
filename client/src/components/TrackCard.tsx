import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Route } from 'lucide-react';
import type { TimelineItem } from '../types';
import { formatDistance, type DistanceUnit } from '../utils/geo';
import { settings } from '../api/client';
import { CardShell } from './checkin-card/CardShell';
import { normalizeTimezoneForDisplay } from '../utils/checkin';

interface TrackCardProps {
  item: TimelineItem;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatClockTime(dateTime: string, timezone: string | null): string {
  const displayTimeZone = normalizeTimezoneForDisplay(timezone);
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
    }).format(new Date(dateTime));
  } catch {
    return '';
  }
}

export default function TrackCard({ item }: TrackCardProps) {
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
  const endedAt = item.track_ended_at || item.checked_in_at;
  const timezone = item.track_timezone || 'UTC';
  const distanceM = Number(item.track_distance_m || 0);
  const elapsedS = Number(item.track_elapsed_time_s || 0);

  return (
    <Link to={`/tracks/${item.id}`} className="block">
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Route size={16} className="text-rose-500 shrink-0" />
              <span className="text-base font-semibold text-rose-700 dark:text-rose-300">
                {name}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">
                {formatDistance(distanceM, distanceUnit)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={12} />
                {formatDuration(elapsedS)}
              </span>
              <span>
                {formatClockTime(startedAt, timezone)} – {formatClockTime(endedAt, timezone)}
              </span>
            </div>
          </div>
        </div>
      </CardShell>
    </Link>
  );
}
