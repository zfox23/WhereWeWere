import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Moon, Star, Trash2 } from 'lucide-react';
import { sleepEntries } from '../api/client';
import type { SleepEntry } from '../types';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDateToLocalDatetime(date: string, localDateTime: string): string {
  const [, time = '00:00'] = localDateTime.split('T');
  return `${date}T${time}`;
}

function toOffsetDateTime(localDateTime: string): string {
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = pad(offsetMinutes / 60);
  const offsetMins = pad(offsetMinutes % 60);

  return `${toLocalDatetimeString(date)}:00${sign}${offsetHours}:${offsetMins}`;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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

function renderStars(rating: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  return clamped === 0 ? 'Unrated' : `${'★'.repeat(clamped)} (${clamped})`;
}

export default function SleepCheckIn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editId = searchParams.get('edit');
  const dateParam = searchParams.get('date') || '';
  const hasDatePrefill = DATE_ONLY_PATTERN.test(dateParam);

  const defaultStartedAt = toLocalDatetimeString(new Date(Date.now() - 8 * 60 * 60 * 1000));
  const defaultEndedAt = toLocalDatetimeString(new Date());

  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState(
    hasDatePrefill ? applyDateToLocalDatetime(dateParam, defaultStartedAt) : defaultStartedAt
  );
  const [endedAt, setEndedAt] = useState(
    hasDatePrefill ? applyDateToLocalDatetime(dateParam, defaultEndedAt) : defaultEndedAt
  );
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const timeZoneAbbreviation = getLocalTimeZoneAbbreviation(endedAt);

  useEffect(() => {
    if (!editId) return;

    setLoading(true);
    sleepEntries.get(editId)
      .then((entry: SleepEntry) => {
        setStartedAt(toLocalDatetimeString(new Date(entry.started_at)));
        setEndedAt(toLocalDatetimeString(new Date(entry.ended_at)));
        setRating(Math.max(0, Math.min(5, Math.round(entry.rating || 0))));
        setComment(entry.comment || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sleep entry'))
      .finally(() => setLoading(false));
  }, [editId]);

  const duration = useMemo(() => {
    if (!startedAt || !endedAt) return null;
    if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) return null;
    return formatDuration(startedAt, endedAt);
  }, [startedAt, endedAt]);

  const handleSubmit = async () => {
    if (!startedAt || !endedAt) {
      setError('Start and end time are required.');
      return;
    }

    const startedDate = new Date(startedAt);
    const endedDate = new Date(endedAt);

    if (Number.isNaN(startedDate.getTime()) || Number.isNaN(endedDate.getTime())) {
      setError('Enter valid date and time values.');
      return;
    }

    if (endedDate.getTime() < startedDate.getTime()) {
      setError('End time must be after start time.');
      return;
    }

    if (rating < 0 || rating > 5) {
      setError('Rating must be between 0 and 5.');
      return;
    }

    const payload = {
      started_at: toOffsetDateTime(startedAt),
      ended_at: toOffsetDateTime(endedAt),
      sleep_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      rating,
      comment: comment.trim() || null,
    };

    setSaving(true);
    setError(null);
    try {
      if (editId) {
        await sleepEntries.update(editId, payload);
      } else {
        await sleepEntries.create(payload);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sleep entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editId) return;
    if (!window.confirm('Delete this sleep entry? This cannot be undone.')) return;

    setDeleting(true);
    setError(null);
    try {
      await sleepEntries.delete(editId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sleep entry');
    } finally {
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

  return (
    <div className="max-w-lg mx-auto space-y-3">
      <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{editId ? 'Edit Sleep' : 'How did you sleep?'}</h1>
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <Moon size={16} className="text-indigo-500" />
            Sleep Window
          </div>
          {duration && (
            <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
              {duration}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Sleep Start</label>
            <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="input w-full text-gray-900 dark:text-gray-100" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-start gap-2">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Wake Up</label>
              {timeZoneAbbreviation && (
                <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {timeZoneAbbreviation}
                </span>
              )}
            </div>
            <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} className="input w-full text-gray-900 dark:text-gray-100" />
          </div>
        </div>

        {!duration && (
          <p className="text-sm text-amber-700 dark:text-amber-300">End time must be after start time.</p>
        )}
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Star size={16} className="text-amber-500" />
          Sleep Rating
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors ${
                rating === value
                  ? 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'border-gray-200 bg-white/70 text-gray-600 hover:border-amber-300 hover:text-amber-700 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:border-amber-500 dark:hover:text-amber-300'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">{renderStars(rating)}</p>
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Comment.md</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="How was your sleep?"
          rows={4}
          className="input w-full resize-none"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={saving || !duration}
        className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? (
          <Loader2 className="animate-spin mx-auto" size={20} />
        ) : editId ? (
          <span className="inline-flex items-center gap-2">
            <span>Update Sleep</span>
            <span className="rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
              Shift+Enter
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span>Save Sleep</span>
            <span className="rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
              Shift+Enter
            </span>
          </span>
        )}
      </button>

      {editId && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn-danger w-full py-3 text-base font-semibold flex items-center justify-center gap-2"
        >
          {deleting ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <>
              <Trash2 size={16} />
              Delete
            </>
          )}
        </button>
      )}
    </div>
  );
}
