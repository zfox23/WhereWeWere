/**
 * SCUBA dive timeline card.
 *
 * The typed payload arrives in `item.data` (the generic check-in's JSONB).
 * Links to the generic detail page at /checkins/scuba/:id and the plugin's
 * check-in page for editing.
 */

import { Waves } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { CheckinCardProps } from 'wwp-shared';
import Stars from '../../../client/src/components/Stars';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { TimestampLink } from '../../../client/src/components/checkin-card/TimestampLink';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';
import { formatDepth, formatTemp, useScubaUnits } from './units';

interface ScubaData {
  place?: string | null;
  city?: string | null;
  country?: string | null;
  entry_time?: string | null;
  depth?: number | null;
  depth_avg?: number | null;
  bottom_time?: number | null;
  water_temp?: number | null;
  air_temp?: number | null;
  weather?: string | null;
  buddy?: string | null;
  divetype?: string | null;
  rating?: number | null;
  comments?: string | null;
}

function formatBottomTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatClockTime(dateTime: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateTime));
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(dateTime));
  }
}

function siteLabel(data: ScubaData): string {
  return [data.place, data.city].filter(Boolean).join(', ') || 'Dive';
}

export function ScubaCard({ item, compact = false }: CheckinCardProps) {
  const { pathname } = useLocation();
  const unit = useScubaUnits();
  const data = (item.data ?? {}) as ScubaData;
  const timezone = normalizeTimezoneForDisplay(item.timezone) || item.timezone || 'UTC';
  const rating = Number(data.rating ?? 0);
  const detailTo = `/checkins/scuba/${item.id}`;

  const depthLabel = formatDepth(data.depth, unit);
  const waterLabel = formatTemp(data.water_temp, unit);

  const chips: { label: string; value: string }[] = [];
  if (depthLabel) chips.push({ label: 'Depth', value: depthLabel });
  if (data.bottom_time != null) chips.push({ label: 'Bottom time', value: formatBottomTime(Number(data.bottom_time)) });
  if (waterLabel) chips.push({ label: 'Water', value: waterLabel });
  if (data.weather) chips.push({ label: 'Weather', value: String(data.weather) });
  if (data.divetype) chips.push({ label: 'Types', value: String(data.divetype) });
  if (data.buddy) chips.push({ label: 'Buddy', value: String(data.buddy) });

  if (compact) {
    return (
      <CardShell compact>
        <div className="flex items-center gap-2 min-w-0">
          <Waves size={14} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
          <Link to={detailTo} className="text-sm font-semibold text-cyan-700 dark:text-cyan-300 truncate">
            {siteLabel(data)}
          </Link>
          {depthLabel && (
            <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400 truncate">
              · {depthLabel}
            </span>
          )}
          {rating > 0 && (
            <Stars value={rating} size={10} max={5} />
          )}
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {formatClockTime(item.checked_in_at, timezone)}
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
            <Waves size={16} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
            <Link to={detailTo} className="text-base font-semibold text-cyan-700 dark:text-cyan-300 hover:text-cyan-800 dark:hover:text-cyan-200 transition-colors">
              {siteLabel(data)}
            </Link>
            {data.country && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{data.country}</span>
            )}
            {rating > 0 && <Stars value={rating} size={12} max={5} />}
          </div>

          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs text-gray-700 dark:text-gray-300"
                >
                  <span className="text-gray-500 dark:text-gray-500">{chip.label}:</span>
                  <span className="font-medium">{chip.value}</span>
                </span>
              ))}
            </div>
          )}

          {data.comments && (
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
              <MarkdownNote note={String(data.comments)} />
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <TimestampLink
              to={detailTo}
              checkedInAt={item.checked_in_at}
              timezone={timezone}
              mode={pathname === '/' ? 'time' : 'full'}
              classNameOverride=""
            />
            {data.entry_time && (
              <span className="text-xs text-gray-500 dark:text-gray-400">dive start {data.entry_time}</span>
            )}
          </div>
        </div>
      </div>
    </CardShell>
  );
}
