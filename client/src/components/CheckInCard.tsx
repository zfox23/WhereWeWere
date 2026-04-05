import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapPin, Clock, Pencil, Camera, Link2, Map, Calendar } from 'lucide-react';
import { immich as immichApi } from '../api/client';
import type { CheckIn, Scrobble, ImmichAsset } from '../types';
import { formatDate, buildImmichTimeUrl } from '../utils/checkin';
import { PhotoStrip } from './PhotoStrip';
import { ScrobbleList } from './ScrobbleList';

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
  // Self-fetch photos as fallback when parent doesn't manage them (photos === undefined)
  const [selfFetchedAssets, setSelfFetchedAssets] = useState<ImmichAsset[] | null>(null);
  const { pathname } = useLocation();

  const showOnThisDay = pathname.startsWith("/venues");

  useEffect(() => {
    if (photos !== undefined) return; // Parent manages photos
    if (!immichUrl) return;
    let cancelled = false;
    immichApi.photos(checkin.id).then((data) => {
      if (!cancelled) setSelfFetchedAssets(data.assets);
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [checkin.id, immichUrl, photos]);

  const resolvedAssets = photos !== undefined ? photos : selfFetchedAssets;

  const hasPhotos = resolvedAssets && resolvedAssets.length > 0;
  // Show "in time" only while still loading (null) as a fallback link
  const showInTime = immichUrl && resolvedAssets === null;
  const showImmichRow = showInTime;

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4 hover:shadow-md transition-all">
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
          {checkin.notes && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {checkin.notes}
            </p>
          )}

          {/* Immich photo thumbnails */}
          {immichUrl && hasPhotos && (
            <PhotoStrip
              assets={resolvedAssets!}
              moreUrl={buildImmichTimeUrl(immichUrl, checkin.checked_in_at)}
              immichUrl={immichUrl}
            />
          )}

          {/* Immich links */}
          {showImmichRow && (
            <div className="flex items-center gap-2 mt-2 text-indigo-600 dark:text-indigo-300">
              <Camera size={12} />
              {showInTime && (
                <a
                  href={buildImmichTimeUrl(immichUrl!, checkin.checked_in_at)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium hover:text-indigo-800 dark:hover:text-indigo-500"
                >
                  in time
                </a>
              )}
            </div>
          )}

          {/* Scrobbles */}
          {scrobbles && <ScrobbleList scrobbles={scrobbles} checkedInAt={checkin.checked_in_at} malojaUrl={malojaUrl} />}

          {/* Date/time */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <Link
              to={`/checkins/${checkin.id}`}
              className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              title="View details"
            >
              <time dateTime={checkin.checked_in_at}>
                {formatDate(checkin.checked_in_at, checkin.venue_timezone)}
              </time>
            </Link>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {dawarichUrl && (
            <a
              href={buildDawarichCheckinUrl(dawarichUrl, checkin.checked_in_at)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              title='View on Dawarich'
            >
              <Map size={14} />
            </a>
          )}
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
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
