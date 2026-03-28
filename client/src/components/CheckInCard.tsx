import { Link } from 'react-router-dom';
import { Star, MapPin, Image, Trash2, Clock, Pencil } from 'lucide-react';
import type { CheckIn } from '../types';

interface CheckInCardProps {
  checkin: CheckIn;
  onDelete?: (id: string) => void;
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

export default function CheckInCard({ checkin, onDelete }: CheckInCardProps) {
  const handleDelete = () => {
    if (onDelete && window.confirm('Delete this check-in?')) {
      onDelete(checkin.id);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
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

          {/* Rating and photo count */}
          <div className="flex items-center gap-4 mt-2">
            {checkin.rating != null && checkin.rating > 0 && (
              <StarRating rating={checkin.rating} />
            )}
            {checkin.photo_count != null && checkin.photo_count > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Image size={13} />
                {checkin.photo_count} photo{checkin.photo_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
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
