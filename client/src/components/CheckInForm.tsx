import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, MapPin, Trash2 } from 'lucide-react';
import { checkins, venues } from '../api/client';
import VenueSearch from './VenueSearch';
import { makeClientRefId } from '../utils/idempotency';

const HARDCODED_USER_ID = '00000000-0000-0000-0000-000000000001';

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getLocalTimeZoneAbbreviation(localDateTime: string): string {
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const timeZonePart = new Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName');

  return timeZonePart?.value ?? '';
}

interface CheckInFormProps {
  venueId?: string;
  venueName?: string;
  parentVenueId?: string | null;
  parentVenueName?: string | null;
  onSuccess?: () => void;
  editCheckinId?: string;
  initialNotes?: string;
  initialCheckedInAt?: string;
}

export default function CheckInForm({
  venueId: initialVenueId,
  venueName: initialVenueName,
  parentVenueId,
  parentVenueName,
  onSuccess,
  editCheckinId,
  initialNotes,
  initialCheckedInAt,
}: CheckInFormProps) {
  const navigate = useNavigate();
  const [venueId, setVenueId] = useState(initialVenueId || '');
  const [venueName, setVenueName] = useState(initialVenueName || '');
  const [notes, setNotes] = useState(initialNotes || '');
  const [checkedInAt, setCheckedInAt] = useState(() => {
    if (initialCheckedInAt) return toLocalDatetimeString(new Date(initialCheckedInAt));
    return toLocalDatetimeString(new Date());
  });
  const [createClientRefId, setCreateClientRefId] = useState(() => makeClientRefId('checkin'));
  const [alsoCheckinParent, setAlsoCheckinParent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingVenue, setDeletingVenue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venueCheckinCount, setVenueCheckinCount] = useState<number | null>(null);
  const [venueCategoryName, setVenueCategoryName] = useState<string | null>(null);
  const [venueAddress, setVenueAddress] = useState<string | null>(null);
  const timeZoneAbbreviation = getLocalTimeZoneAbbreviation(checkedInAt);

  const isEditMode = !!editCheckinId;

  const handleVenueSelect = (venue: { id: string; name: string }) => {
    setVenueId(venue.id);
    setVenueName(venue.name);
  };

  useEffect(() => {
    if (!venueId || isEditMode) {
      setVenueCheckinCount(null);
      setVenueCategoryName(null);
      setVenueAddress(null);
      return;
    }

    let active = true;
    setVenueCheckinCount(null);

    venues.get(venueId)
      .then((venue) => {
        if (!active) return;
        const parsed = typeof venue.checkin_count === 'number'
          ? venue.checkin_count
          : Number(venue.checkin_count);
        setVenueCheckinCount(Number.isFinite(parsed) ? parsed : 0);
        setVenueCategoryName(venue.category_name || null);
        const fullAddress = [
          venue.address,
          venue.city,
          venue.state,
          venue.postal_code,
          venue.country,
        ]
          .filter(Boolean)
          .join(', ');
        setVenueAddress(fullAddress || null);
      })
      .catch(() => {
        if (!active) return;
        setVenueCheckinCount(null);
        setVenueCategoryName(null);
        setVenueAddress(null);
      });

    return () => {
      active = false;
    };
  }, [venueId, isEditMode]);

  const handleDelete = async () => {
    if (!editCheckinId) return;
    if (!window.confirm('Delete this check-in? This cannot be undone.')) return;
    setDeleting(true);
    setError(null);
    try {
      await checkins.delete(editCheckinId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
      setDeleting(false);
    }
  };

  const handleDeleteVenue = async () => {
    if (!venueId) return;
    if (!navigator.onLine) {
      setError('Deleting venues requires an internet connection.');
      return;
    }
    if (!window.confirm(`Delete venue "${venueName}" from the local database? This cannot be undone.`)) return;

    setDeletingVenue(true);
    setError(null);
    try {
      await venues.delete(venueId);
      setVenueId('');
      setVenueName('');
      setVenueCheckinCount(null);
      setVenueCategoryName(null);
      setVenueAddress(null);
      navigate('/check-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete venue.');
    } finally {
      setDeletingVenue(false);
    }
  };

  const submitCheckIn = async () => {
    if (!venueId && !isEditMode) {
      setError('Please select a venue.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isEditMode) {
        await checkins.update(editCheckinId!, {
          notes: notes.trim() || null,
          checked_in_at: new Date(checkedInAt).toISOString(),
        });
      } else {
        await checkins.create({
          user_id: HARDCODED_USER_ID,
          venue_id: venueId,
          notes: notes.trim() || null,
          checked_in_at: new Date(checkedInAt).toISOString(),
          also_checkin_parent: alsoCheckinParent && !!parentVenueId,
          client_ref_id: createClientRefId,
        });

        // Reset form
        if (!initialVenueId) {
          setVenueId('');
          setVenueName('');
        }
        setNotes('');
        setCheckedInAt(toLocalDatetimeString(new Date()));
        setCreateClientRefId(makeClientRefId('checkin'));
      }

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditMode ? 'Failed to update.' : 'Failed to check in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitCheckIn();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Venue selection (hidden in edit mode) */}
      {!isEditMode && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Venue
          </label>
          {venueId ? (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700 rounded-lg">
              <MapPin size={16} className="text-primary-600 shrink-0" />
              <span className="text-sm font-medium text-primary-800 dark:text-primary-300 flex-1">
                <span className="block">{venueName}</span>
                {(venueCategoryName || venueAddress) && (
                  <span className="block mt-0.5 text-xs font-normal text-primary-700/90 dark:text-primary-300/80">
                    {[venueCategoryName, venueAddress].filter(Boolean).join(' • ')}
                  </span>
                )}
              </span>
              {venueCheckinCount === null ? (
                <span className="text-xs text-primary-600/70 dark:text-primary-400/80 font-medium">
                  Loading...
                </span>
              ) : venueCheckinCount > 0 ? (
                <Link
                  to={`/venues/${encodeURIComponent(venueId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium"
                >
                  {venueCheckinCount} check-in{venueCheckinCount === 1 ? '' : 's'}
                </Link>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    New venue
                  </span>
                  <button
                    type="button"
                    onClick={handleDeleteVenue}
                    disabled={deletingVenue}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                  >
                    {deletingVenue ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 size={12} />
                        Delete venue
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <VenueSearch onSelect={handleVenueSelect} />
          )}
        </div>
      )}

      {/* Also check in at parent venue (hidden in edit mode) */}
      {!isEditMode && parentVenueName && parentVenueId && (
        <label
          htmlFor="also-checkin-parent"
          className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg cursor-pointer"
        >
          <input
            type="checkbox"
            id="also-checkin-parent"
            checked={alsoCheckinParent}
            onChange={(e) => setAlsoCheckinParent(e.target.checked)}
            className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-blue-800 dark:text-blue-300">
            Also check in at <strong>{parentVenueName}</strong>
          </span>
        </label>
      )}

      {/* Time */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label
            htmlFor="checkin-time"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Time
          </label>
          {timeZoneAbbreviation && (
            <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {timeZoneAbbreviation}
            </span>
          )}
        </div>
        <input
          type="datetime-local"
          id="checkin-time"
          value={checkedInAt}
          onChange={(e) => setCheckedInAt(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label
          htmlFor="checkin-notes"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Note.md
        </label>
        <textarea
          id="checkin-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              void submitCheckIn();
            }
          }}
          placeholder="What are you up to?"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || (!venueId && !isEditMode)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-700 rounded-2xl hover:from-primary-600 hover:to-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-primary-500/20"
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {isEditMode ? 'Updating...' : 'Checking in...'}
          </>
        ) : (
          <>
            <MapPin size={16} />
            {isEditMode ? 'Update Check In' : 'Check In'}
            <span className="rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
              Shift+Enter
            </span>
          </>
        )}
      </button>

      {/* Delete button (edit mode only) */}
      {isEditMode && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {deleting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <Trash2 size={16} />
              Delete Check-in
            </>
          )}
        </button>
      )}
    </form>
  );
}
