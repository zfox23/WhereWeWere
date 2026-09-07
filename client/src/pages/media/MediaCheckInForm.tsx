import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { media } from '../../api/client';
import type { MediaItem, MediaSubtype } from '../../types';
import ScorePicker from '../../components/ScorePicker';
import { MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS, detailPath } from '../../utils/media';
import { deviceTimezone, nowLocalDatetimeValue, localDatetimeToIso, slugify } from '../../utils/slugify';
import { usePageTitle } from '../../utils/pageTitle';

interface MediaCheckInFormProps {
  subtype: MediaSubtype;
  /** Optional fixed season/episode (tv). When absent, no episode fields are shown. */
  episodeMode?: {
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle?: string | null;
  };
}

export default function MediaCheckInForm({ subtype, episodeMode }: MediaCheckInFormProps) {
  const config = MEDIA_SUBTYPES[subtype];
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [score, setScore] = useState(0);
  const [dateTime, setDateTime] = useState(nowLocalDatetimeValue());
  const [checkinType, setCheckinType] = useState<'completed' | 'in_progress' | 'dropped'>('completed');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  usePageTitle(`${config.label} Check-In${item ? `: ${item.title}` : ''}`);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await media.getItem(id);
        if (!cancelled) {
          setItem(data);
          if (data.my_rating != null) setScore(data.my_rating);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load item');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleBack = () => {
    if (episodeMode) {
      navigate(`/media-check-in/tv/${id}/${slugify(item?.title || '')}`);
    } else {
      navigate(config.searchPath);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || submitting) return;
    setSubmitting(true);
    try {
      await media.createCheckin(id, {
        season_number: episodeMode?.seasonNumber ?? null,
        episode_number: episodeMode?.episodeNumber ?? null,
        episode_title: episodeMode?.episodeTitle ?? null,
        checkin_type: checkinType,
        rating: score,
        notes: notes.trim() || null,
        checked_in_at: localDatetimeToIso(dateTime),
        timezone: deviceTimezone(),
      });
      navigate(detailPath(subtype, id, slugify(item?.title || '')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create check-in');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="space-y-4">
        <button onClick={handleBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-red-600 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="space-y-6">
      <button onClick={handleBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <ArrowLeft size={15} /> Back
      </button>

      {/* Media header */}
      <div className="flex gap-4">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.title}
            className="w-20 h-28 object-cover rounded-xl shadow-md shrink-0"
          />
        ) : (
          <div className="w-20 h-28 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl shrink-0">
            {config.icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{item.title}</h1>
          {item.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{item.author}</p>}
          {item.release_year && <p className="text-sm text-gray-500 dark:text-gray-400">{item.release_year}</p>}
          {episodeMode && (
            <p className="text-sm text-primary-600 dark:text-primary-400 mt-1">
              Season {episodeMode.seasonNumber} · Episode {episodeMode.episodeNumber}
              {episodeMode.episodeTitle ? ` — ${episodeMode.episodeTitle}` : ''}
            </p>
          )}
          {item.external_url && (
            <a
              href={item.external_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-xs text-primary-600 hover:underline"
            >
              View on {config.apiName} →
            </a>
          )}
        </div>
      </div>

      {/* Check-in form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 space-y-5"
      >
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Score</label>
          <ScorePicker value={score} onChange={setScore} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Date & Time</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="input"
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">Time zone: {deviceTimezone()}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Check-in Type</label>
            <select
              value={checkinType}
              onChange={(e) => setCheckinType(e.target.value as 'completed' | 'in_progress' | 'dropped')}
              className="input"
            >
              <option value="completed">{CHECKIN_TYPE_LABELS.completed}</option>
              <option value="in_progress">{CHECKIN_TYPE_LABELS.in_progress}</option>
              <option value="dropped">{CHECKIN_TYPE_LABELS.dropped}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Notes.md
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Write your notes in Markdown…"
            className="input font-mono text-sm resize-y min-h-[120px]"
          />
        </div>

        {error && item && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary inline-flex items-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Submit Check-in
          </button>
        </div>
      </form>
    </div>
  );
}
