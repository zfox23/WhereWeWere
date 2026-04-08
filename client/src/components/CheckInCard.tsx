import { Camera, Calendar, Map, MapPin, Pencil } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { CheckIn, Scrobble, ImmichAsset } from '../types';
import { ScrobbleList } from './ScrobbleList';
import { CardShell } from './checkin-card/CardShell';
import { MarkdownNote } from './checkin-card/MarkdownNote';
import { PhotoSection } from './checkin-card/PhotoSection';
import { TimestampLink } from './checkin-card/TimestampLink';
import { useResolvedPhotos } from './checkin-card/useResolvedPhotos';

interface CheckInCardProps {
  checkin: CheckIn;
  immichUrl?: string | null;
  photos?: ImmichAsset[] | null;
  scrobbles?: Scrobble[];
  malojaUrl?: string | null;
  dawarichUrl?: string | null;
}

function buildDawarichCheckinUrl(dawarichUrl: string, checkedInAt: string): string {
  const t = new Date(checkedInAt);
  const startTime = new Date(t.getTime() - 2 * 60 * 60 * 1000);
  const endTime = new Date(t.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  const start = encodeURIComponent(encodeURIComponent(fmt(startTime)));
  const end = encodeURIComponent(encodeURIComponent(fmt(endTime)));
  return `${dawarichUrl}/map/v2?start_at=${start}&end_at=${end}`;
}

export default function CheckInCard({ checkin, immichUrl, photos, scrobbles, malojaUrl, dawarichUrl }: CheckInCardProps) {
  const { pathname } = useLocation();

  const isHomePage = pathname === '/';
  const showOnThisDay = pathname.startsWith("/venues");
  const resolvedAssets = useResolvedPhotos(checkin.id, immichUrl, photos);

  return (
    <CardShell>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Venue name */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <MapPin size={16} className="text-primary-500 shrink-0" />
            <Link
              to={`/venues/${checkin.venue_id}`}
              className="text-base font-semibold text-primary-700 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
            >
              {checkin.venue_name || 'Unknown Venue'}
            </Link>
            {checkin.parent_venue_name && (
              <span className="text-sm text-gray-400 font-normal">
                {' \u2014 '}
                <Link
                  to={`/venues/${checkin.parent_venue_id}`}
                  className="hover:text-primary-600 transition-colors"
                >
                  {checkin.parent_venue_name}
                </Link>
              </span>
            )}
          </div>

          {/* Category badge */}
          {checkin.venue_category && (
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
              {checkin.venue_category}
            </span>
          )}

          {/* Notes */}
          <MarkdownNote note={checkin.notes} />

          <PhotoSection
            immichUrl={immichUrl}
            assets={resolvedAssets}
            checkedInAt={checkin.checked_in_at}
            fallbackLinkContent={<Camera size={12} />}
          />

          {/* Scrobbles */}
          {scrobbles && <ScrobbleList scrobbles={scrobbles} checkedInAt={checkin.checked_in_at} malojaUrl={malojaUrl} />}

          {/* Date/time */}
          <TimestampLink
            to={`/checkins/${checkin.id}`}
            checkedInAt={checkin.checked_in_at}
            timezone={checkin.venue_timezone}
            mode={isHomePage ? 'time' : 'full'}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          { showOnThisDay &&
            <Link
              to={`/?from=${checkin.checked_in_at.substring(0, 10)}&to=${checkin.checked_in_at.substring(0, 10)}`}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              title="View day"
            >
              <Calendar size={14} />
            </Link>
          }
          <Link
            to={`/check-in?edit=${checkin.id}`}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
            title="Edit"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>
    </CardShell>
  );
}
