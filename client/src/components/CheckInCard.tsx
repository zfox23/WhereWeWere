import { Link } from 'react-router-dom';
import { Star, MapPin, Trash2, Clock, Pencil, Camera } from 'lucide-react';
import type { CheckIn } from '../types';

interface CheckInCardProps {
  checkin: CheckIn;
  onDelete?: (id: string) => void;
  immichUrl?: string | null;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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
  const takenAfter = new Date(t.getTime() - 60 * 60 * 1000).toISOString();
  const takenBefore = new Date(t.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const query = JSON.stringify({ takenAfter, takenBefore });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

function buildImmichMapUrl(immichUrl: string, lat: number, lng: number): string {
  return `${immichUrl}/map#15/${lat}/${lng}`;
}

export default function CheckInCard({ checkin, onDelete, immichUrl }: CheckInCardProps) {
  const handleDelete = () => {
    if (onDelete && window.confirm('Delete this check-in?')) {
      onDelete(checkin.id);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Venue name */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <MapPin size={16} className="text-primary-500 shrink-0" />
            <Link
              to={`/venues/${checkin.venue_id}`}
              className="text-base font-semibold text-gray-900 hover:text-primary-600 transition-colors"
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
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full bg-primary-50 text-primary-700">
              {checkin.venue_category}
            </span>
          )}

          {/* Date/time */}
          <div className="flex items-center gap-1 mt-2 text-sm text-gray-500">
            <Clock size={13} />
            <time dateTime={checkin.checked_in_at}>
              {formatDate(checkin.checked_in_at)}
            </time>
          </div>

          {/* Notes */}
          {checkin.notes && (
            <p className="mt-2 text-sm text-gray-700 leading-relaxed">
              {checkin.notes}
            </p>
          )}

          {/* Rating */}
          {checkin.rating != null && checkin.rating > 0 && (
            <div className="mt-2">
              <StarRating rating={checkin.rating} />
            </div>
          )}

          {/* Immich photo links */}
          {immichUrl && (
            <div className="flex items-center gap-3 mt-2">
              <a
                href={buildImmichTimeUrl(immichUrl, checkin.checked_in_at)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <Clock size={12} />
                Photos by time
              </a>
              {checkin.venue_latitude != null && checkin.venue_longitude != null && (
                <a
                  href={buildImmichMapUrl(immichUrl, Number(checkin.venue_latitude), Number(checkin.venue_longitude))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  <Camera size={12} />
                  Photos nearby
                </a>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/check-in?edit=${checkin.id}`}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </Link>
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
