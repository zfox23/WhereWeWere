import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, Clock, Loader2, Moon, Pencil, Star, Trash2 } from 'lucide-react';
import { sleepEntries } from '../api/client';
import type { SleepEntry } from '../types';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import { usePageTitle } from '../utils/pageTitle';

function formatDuration(startedAt: string, endedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const diffMs = Math.max(0, endMs - startMs);
  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDate(dateStr: string, timeZone?: string | null): string {
  const date = new Date(dateStr);
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(date);
}

function getLocalDateKey(dateStr: string, timeZone?: string | null): string {
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Date(dateStr).toLocaleDateString('en-CA', {
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  });
}

function getTimezoneAbbreviation(dateTime: string, timezone: string): string {
  const displayTimezone = normalizeTimezoneForDisplay(timezone) || timezone;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimezone,
      timeZoneName: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(dateTime));
    return parts.find((part) => part.type === 'timeZoneName')?.value || timezone;
  } catch {
    return timezone;
  }
}

function renderStars(rating: number): string {
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5;
  return `${'★'.repeat(full)}${half ? '½' : ''}`;
}

export default function SleepDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<SleepEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  usePageTitle(entry ? `Sleep Entry: ${formatDuration(entry.started_at, entry.ended_at)}` : 'Sleep Entry');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    sleepEntries.get(id)
      .then((data: SleepEntry) => setEntry(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sleep entry'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this sleep entry? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await sleepEntries.delete(id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sleep entry');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="text-center py-20">
        <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-red-600 mb-4">{error || 'Sleep entry not found'}</p>
        <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">
          Back to Home
        </Link>
      </div>
    );
  }

  const timezoneLabel = getTimezoneAbbreviation(entry.started_at, entry.sleep_timezone);
  const duration = formatDuration(entry.started_at, entry.ended_at);
  const dayKey = getLocalDateKey(entry.ended_at, entry.sleep_timezone);
  const dayTimelinePath = `/?from=${dayKey}&to=${dayKey}`;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
        <ArrowLeft size={14} />
        Back
      </Link>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Moon size={20} className="text-indigo-500 shrink-0" />
          <h1 className="text-xl font-bold text-indigo-700 dark:text-indigo-300">Slept for {duration}</h1>
          <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            {timezoneLabel}
          </span>
        </div>

        {entry.rating > 0 && (
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Star size={12} className="fill-current" />
            {renderStars(entry.rating)}
            <span className="text-[11px] text-amber-600/80 dark:text-amber-300/80">({entry.rating.toFixed(1)})</span>
          </div>
        )}

        {entry.comment && (
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed italic">{entry.comment}</p>
        )}

        <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <Clock size={14} />
            <span>Start: <time dateTime={entry.started_at}>{formatDate(entry.started_at, entry.sleep_timezone)}</time></span>
          </div>
          { entry.ended_at ? 
          <div className="flex items-center gap-2">
            <Clock size={14} />
            <span>End: <time dateTime={entry.ended_at}>{formatDate(entry.ended_at, entry.sleep_timezone)}</time></span>
            <Link
              to={dayTimelinePath}
              aria-label="View this day on Home"
              title="View this day on Home"
              className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <CalendarDays size={14} />
            </Link>
          </div> : null}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Link to={`/sleep-check-in?edit=${entry.id}`} className="btn-secondary flex items-center gap-2 text-sm">
            <Pencil size={14} /> Edit
          </Link>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger flex items-center gap-2 text-sm">
            {deleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
