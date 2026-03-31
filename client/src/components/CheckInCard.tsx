import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Star, MapPin, Clock, Pencil, Camera, Music, ChevronRight, Link2, Map } from 'lucide-react';
import { immich as immichApi } from '../api/client';
import type { CheckIn, Scrobble, ImmichAsset } from '../types';

interface CheckInCardProps {
  checkin: CheckIn;
  immichUrl?: string | null;
  photos?: ImmichAsset[] | null;
  scrobbles?: Scrobble[];
  malojaUrl?: string | null;
  dawarichUrl?: string | null;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatMalojaDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={
            i <= rating
              ? 'fill-yellow-400 text-yellow-400'
              : 'text-gray-300'
          }
        />
      ))}
    </div>
  );
}

function buildImmichTimeUrl(immichUrl: string, checkedInAt: string): string {
  const t = new Date(checkedInAt);
  const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
  const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const query = JSON.stringify({ takenAfter, takenBefore });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

function buildImmichMapUrl(immichUrl: string, lat: number, lng: number): string {
  return `${immichUrl}/map#15/${lat}/${lng}`;
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

function buildMalojaTrackUrl(malojaUrl: string, artists: string[], title?: string): string {
  const params = new URLSearchParams();
  for (const artist of artists) {
    params.append('trackartist', artist);
  }
  if (title) params.append('title', title);
  return `${malojaUrl}/track?${params.toString()}`;
}

const THUMB_SIZE = 64;
const THUMB_GAP = 4;

function PhotoStrip({ assets, moreUrl, immichUrl }: { assets: ImmichAsset[]; moreUrl: string; immichUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(assets.length);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    const moreButtonWidth = 40;
    const maxFit = Math.floor((width + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP));
    const maxFitWithMore = Math.floor((width - moreButtonWidth - THUMB_GAP + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP));

    if (maxFit >= assets.length) {
      setVisibleCount(assets.length);
    } else {
      setVisibleCount(Math.max(1, maxFitWithMore));
    }
  }, [assets.length]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const hasMore = visibleCount < assets.length;

  return (
    <div ref={containerRef} className="mt-2 flex items-center gap-1">
      {assets.slice(0, visibleCount).map((asset) => (
        <a
          key={asset.id}
          href={`${immichUrl}/photos/${asset.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-400 transition-all"
        >
          <img
            src={immichApi.thumbnailUrl(asset.id)}
            alt={asset.originalFileName}
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            className="object-cover"
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            loading="lazy"
          />
        </a>
      ))}
      {hasMore && (
        <a
          href={moreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs font-medium text-gray-500 dark:text-gray-400"
          style={{ width: 36, height: THUMB_SIZE }}
          title={`${assets.length - visibleCount} more`}
        >
          <ChevronRight size={16} />
        </a>
      )}
    </div>
  );
}

export default function CheckInCard({ checkin, immichUrl, photos, scrobbles, malojaUrl, dawarichUrl }: CheckInCardProps) {
  // Self-fetch photos as fallback when parent doesn't manage them (photos === undefined)
  const [selfFetchedAssets, setSelfFetchedAssets] = useState<ImmichAsset[] | null>(null);

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

  const hasInSpace = immichUrl && checkin.venue_latitude != null && checkin.venue_longitude != null;
  const hasPhotos = resolvedAssets && resolvedAssets.length > 0;
  // Show "in time" only while still loading (null) as a fallback link
  const showInTime = immichUrl && resolvedAssets === null;
  const showImmichRow = hasPhotos || showInTime || hasInSpace;

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

          {/* Date/time */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <Clock size={13} className='text-gray-500 shrink-0' />
            <Link
              to={`/checkins/${checkin.id}`}
              className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              title="View details"
            >
              <time dateTime={checkin.checked_in_at}>
                {formatDate(checkin.checked_in_at)}
              </time>
            </Link>
          </div>

          {/* Notes */}
          {checkin.notes && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {checkin.notes}
            </p>
          )}

          {/* Rating */}
          {checkin.rating != null && checkin.rating > 0 && (
            <div className="mt-2">
              <StarRating rating={checkin.rating} />
            </div>
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
              {hasInSpace && (
                <a
                  href={buildImmichMapUrl(immichUrl!, Number(checkin.venue_latitude), Number(checkin.venue_longitude))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium hover:text-indigo-800 dark:hover:text-indigo-500"
                >
                  in space
                </a>
              )}
            </div>
          )}

          {/* Scrobbles */}
          {scrobbles && scrobbles.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5">
              {malojaUrl ? (
                <a
                  href={`${malojaUrl}/scrobbles?in=${formatMalojaDate(checkin.checked_in_at)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 mt-0.5 shrink-0 hover:text-primary-500 transition-colors"
                >
                  <Music size={13} />
                </a>
              ) : (
                <Music size={13} className="text-gray-400 mt-0.5 shrink-0" />
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {scrobbles.map((s, i) => (
                  <span key={i} className="text-xs text-gray-500 dark:text-gray-400">
                    {malojaUrl ? (
                      <>
                        {s.artists.map((artist, j) => (
                          <span key={j}>
                            {j > 0 && ', '}
                            <a
                              href={buildMalojaTrackUrl(malojaUrl, [artist])}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            >
                              {artist}
                            </a>
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="font-medium text-gray-600 dark:text-gray-300">{s.artists.join(', ')}</span>
                    )}
                    {' \u2014 '}
                    {malojaUrl ? (
                      <a
                        href={buildMalojaTrackUrl(malojaUrl, s.artists, s.title)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      >
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
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
