import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Moon, Save, Trash2 } from 'lucide-react';
import { sleepEntries } from '../api/client';
import type { SleepEntry } from '../types';

function toLocalDateTimeInputValue(value: string): string {
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default function SleepCheckIn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editId = searchParams.get('edit') || '';
  const isEditing = Boolean(editId);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [sleepTimezone, setSleepTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [rating, setRating] = useState('0');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isEditing) {
      const now = new Date();
      const earlier = new Date(now.getTime() - 8 * 60 * 60 * 1000);
      setStartedAt(toLocalDateTimeInputValue(earlier.toISOString()));
      setEndedAt(toLocalDateTimeInputValue(now.toISOString()));
      return;
    }

    sleepEntries.get(editId)
      .then((entry: SleepEntry) => {
        setStartedAt(toLocalDateTimeInputValue(entry.started_at));
        setEndedAt(toLocalDateTimeInputValue(entry.ended_at));
        setSleepTimezone(entry.sleep_timezone || 'UTC');
        setRating(String(entry.rating || 0));
        setComment(entry.comment || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sleep entry'))
      .finally(() => setLoading(false));
  }, [editId, isEditing]);

  const duration = useMemo(() => {
    if (!startedAt || !endedAt) return null;
    const startIso = new Date(startedAt).toISOString();
    const endIso = new Date(endedAt).toISOString();
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) return null;
    return formatDuration(startIso, endIso);
  }, [startedAt, endedAt]);

  const save = async () => {
    if (!startedAt || !endedAt) {
      setError('Start and end time are required.');
      return;
    }

    const startedIso = new Date(startedAt).toISOString();
    const endedIso = new Date(endedAt).toISOString();

    if (new Date(endedIso).getTime() < new Date(startedIso).getTime()) {
      setError('End time must be after start time.');
      return;
    }

    const payload = {
      started_at: startedIso,
      ended_at: endedIso,
      sleep_timezone: sleepTimezone || 'UTC',
      rating: Number(rating || '0'),
      comment,
    };

    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
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

  const remove = async () => {
    if (!isEditing) return;
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
    <div className="max-w-xl mx-auto space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Moon size={20} className="text-indigo-500" />
          {isEditing ? 'Edit Sleep Entry' : 'New Sleep Entry'}
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sleep Start</label>
            <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sleep End</label>
            <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} className="input" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label>
            <input type="text" value={sleepTimezone} onChange={(e) => setSleepTimezone(e.target.value)} className="input" placeholder="America/New_York" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rating (0 to 5)</label>
            <input type="number" min={0} max={5} step={0.1} value={rating} onChange={(e) => setRating(e.target.value)} className="input" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comment</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} className="input min-h-[90px]" placeholder="Optional notes" />
        </div>

        {duration && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Duration: {duration}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || deleting} className="btn-primary">
            {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
            Save
          </button>
          {isEditing && (
            <button onClick={remove} disabled={saving || deleting} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800/60 dark:hover:bg-red-900/20">
              {deleting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Trash2 size={16} className="mr-2" />}
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
