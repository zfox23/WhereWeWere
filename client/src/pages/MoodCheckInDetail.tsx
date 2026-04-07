import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Clock, Pencil, Trash2, Loader2, AlertCircle, ArrowLeft, CalendarDays } from 'lucide-react';
import { moodCheckins, settings as settingsApi } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS, MOOD_BG_COLORS } from '../components/MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import { normalizeTimezoneForDisplay } from '../utils/checkin';

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

export default function MoodCheckInDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [checkin, setCheckin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [iconPack, setIconPack] = useState('emoji');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      moodCheckins.get(id),
      settingsApi.get(),
    ]).then(([mc, s]) => {
      setCheckin(mc);
      if (s.mood_icon_pack) setIconPack(s.mood_icon_pack);
    }).catch((err) => {
      setError(err.message || 'Failed to load mood check-in');
    }).finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!id || !confirm('Delete this mood check-in?')) return;
    setDeleting(true);
    try {
      await moodCheckins.delete(id);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  if (error || !checkin) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <AlertCircle className="mx-auto text-red-400 mb-3" size={32} />
        <p className="text-gray-600 dark:text-gray-400">{error || 'Not found'}</p>
        <Link to="/" className="text-primary-600 mt-2 inline-block">Back to timeline</Link>
      </div>
    );
  }

  const mood = checkin.mood;
  const dayKey = getLocalDateKey(checkin.checked_in_at, checkin.mood_timezone);
  const dayTimelinePath = `/?from=${dayKey}&to=${dayKey}`;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white mb-4">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-6 space-y-4">
        {/* Mood */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${MOOD_BG_COLORS[mood]}`}>
            <MoodIcon mood={mood} pack={iconPack} size={28} />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${MOOD_COLORS[mood]}`}>{MOOD_LABELS[mood]}</h1>
          </div>
        </div>

        {/* Activities */}
        {checkin.activities && checkin.activities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checkin.activities.map((act: any) => (
              <span
                key={act.id}
                className="px-2.5 py-1 text-sm font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center gap-1.5"
              >
                {act.icon ? (() => {
                  const IconComponent = resolveActivityIcon(act.icon);
                  return IconComponent ? <IconComponent size={14} className="shrink-0 text-current" /> : null;
                })() : null}
                {act.name}
              </span>
            ))}
          </div>
        )}

        {/* Note */}
        {checkin.note && (
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
            {checkin.note}
          </p>
        )}

        {/* Timestamp */}
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Clock size={14} />
          <time dateTime={checkin.checked_in_at}>
            {formatDate(checkin.checked_in_at, checkin.mood_timezone)}
          </time>
          <Link
            to={dayTimelinePath}
            aria-label="View this day on Home"
            title="View this day on Home"
            className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <CalendarDays size={14} />
          </Link>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Link
            to={`/mood-check-in?edit=${checkin.id}`}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Pencil size={14} /> Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            {deleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
