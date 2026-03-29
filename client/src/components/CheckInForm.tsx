import { useState } from 'react';
import { Star, Loader2, MapPin } from 'lucide-react';
import { checkins } from '../api/client';
import VenueSearch from './VenueSearch';

const HARDCODED_USER_ID = '00000000-0000-0000-0000-000000000001';

interface CheckInFormProps {
  venueId?: string;
  venueName?: string;
  parentVenueId?: string | null;
  parentVenueName?: string | null;
  onSuccess?: () => void;
}

export default function CheckInForm({
  venueId: initialVenueId,
  venueName: initialVenueName,
  parentVenueId,
  parentVenueName,
  onSuccess,
}: CheckInFormProps) {
  const [venueId, setVenueId] = useState(initialVenueId || '');
  const [venueName, setVenueName] = useState(initialVenueName || '');
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [alsoCheckinParent, setAlsoCheckinParent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVenueSelect = (venue: { id: string; name: string }) => {
    setVenueId(venue.id);
    setVenueName(venue.name);
  };

  const handleClearVenue = () => {
    setVenueId('');
    setVenueName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueId) {
      setError('Please select a venue.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const newCheckin = await checkins.create({
        user_id: HARDCODED_USER_ID,
        venue_id: venueId,
        notes: notes.trim() || null,
        rating: rating > 0 ? rating : null,
        checked_in_at: new Date().toISOString(),
        also_checkin_parent: alsoCheckinParent && !!parentVenueId,
      });

      // Reset form
      if (!initialVenueId) {
        setVenueId('');
        setVenueName('');
      }
      setNotes('');
      setRating(0);

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Venue selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Venue
        </label>
        {venueId ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-primary-50 border border-primary-200 rounded-lg">
            <MapPin size={16} className="text-primary-600 shrink-0" />
            <span className="text-sm font-medium text-primary-800 flex-1">
              {venueName}
            </span>
            <button
              type="button"
              onClick={handleClearVenue}
              className="text-xs text-primary-600 hover:text-primary-800 font-medium"
            >
              Change
            </button>
          </div>
        ) : (
          <VenueSearch onSelect={handleVenueSelect} />
        )}
      </div>

      {/* Also check in at parent venue */}
      {parentVenueName && parentVenueId && (
        <label
          htmlFor="also-checkin-parent"
          className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer"
        >
          <input
            type="checkbox"
            id="also-checkin-parent"
            checked={alsoCheckinParent}
            onChange={(e) => setAlsoCheckinParent(e.target.checked)}
            className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-blue-800">
            Also check in at <strong>{parentVenueName}</strong>
          </span>
        </label>
      )}

      {/* Notes */}
      <div>
        <label
          htmlFor="checkin-notes"
          className="block text-sm font-medium text-gray-700 mb-1.5"
        >
          Notes
        </label>
        <textarea
          id="checkin-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What are you up to?"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Star rating */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Rating
        </label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value === rating ? 0 : value)}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              className="p-0.5 transition-transform hover:scale-110"
              aria-label={`Rate ${value} star${value !== 1 ? 's' : ''}`}
            >
              <Star
                size={24}
                className={
                  value <= (hoverRating || rating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-300'
                }
              />
            </button>
          ))}
          {rating > 0 && (
            <span className="ml-2 text-xs text-gray-500">
              {rating}/5
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || !venueId}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Checking in...
          </>
        ) : (
          <>
            <MapPin size={16} />
            Check In
          </>
        )}
      </button>
    </form>
  );
}
