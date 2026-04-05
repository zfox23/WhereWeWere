import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Trash2, ArrowLeft, Settings as SettingsIcon } from 'lucide-react';
import { moodCheckins, moodActivities, settings as settingsApi } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS } from '../components/MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import type { MoodActivityGroup } from '../types';

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

export default function MoodCheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [mood, setMood] = useState<number>(0);
  const [note, setNote] = useState('');
  const [checkedInAt, setCheckedInAt] = useState(toLocalDatetimeString(new Date()));
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [activityFilter, setActivityFilter] = useState('');
  const [groups, setGroups] = useState<MoodActivityGroup[]>([]);
  const [iconPack, setIconPack] = useState('emoji');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(!!editId);

  useEffect(() => {
    moodActivities.groups().then(setGroups).catch(console.error);
    settingsApi.get().then((s: any) => {
      if (s.mood_icon_pack) setIconPack(s.mood_icon_pack);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    moodCheckins.get(editId).then((mc: any) => {
      setMood(mc.mood);
      setNote(mc.note || '');
      setCheckedInAt(toLocalDatetimeString(new Date(mc.checked_in_at)));
      setSelectedActivities(new Set(mc.activities.map((a: any) => a.id)));
    }).catch(console.error).finally(() => setLoading(false));
  }, [editId]);

  const toggleActivity = (id: string) => {
    setSelectedActivities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const normalizedFilter = activityFilter.trim().toLowerCase();
  const filteredGroups = normalizedFilter
    ? (() => {
        const getRank = (activityName: string, groupName: string) => {
          const activity = activityName.toLowerCase();
          const group = groupName.toLowerCase();

          if (activity === normalizedFilter || group === normalizedFilter) return 0;
          if (activity.startsWith(normalizedFilter) || group.startsWith(normalizedFilter)) return 1;
          if (activity.includes(normalizedFilter) || group.includes(normalizedFilter)) return 2;
          return Number.POSITIVE_INFINITY;
        };

        const ranked = groups
          .flatMap((group, groupIndex) =>
            group.activities.map((activity, activityIndex) => ({
              group,
              activity,
              rank: getRank(activity.name, group.name),
              groupIndex,
              activityIndex,
            }))
          )
          .filter((entry) => Number.isFinite(entry.rank))
          .sort((a, b) => (
            a.rank - b.rank
            || a.groupIndex - b.groupIndex
            || a.activityIndex - b.activityIndex
          ));

        const grouped = new Map<string, MoodActivityGroup>();
        for (const entry of ranked) {
          const existing = grouped.get(entry.group.id);
          if (existing) {
            existing.activities.push(entry.activity);
          } else {
            grouped.set(entry.group.id, { ...entry.group, activities: [entry.activity] });
          }
        }

        return Array.from(grouped.values());
      })()
    : groups;

  const topFilteredActivity = filteredGroups[0]?.activities[0] ?? null;

  const toggleTopFilteredActivity = () => {
    if (!topFilteredActivity) return;
    setSelectedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(topFilteredActivity.id)) {
        next.delete(topFilteredActivity.id);
      } else {
        next.add(topFilteredActivity.id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (mood === 0) return;
    setSaving(true);
    try {
      const data = {
        mood,
        note: note.trim() || null,
        checked_in_at: toOffsetDateTime(checkedInAt),
        mood_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        activity_ids: Array.from(selectedActivities),
      };
      if (editId) {
        await moodCheckins.update(editId, data);
      } else {
        await moodCheckins.create(data);
      }
      navigate('/');
    } catch (err) {
      console.error('Failed to save mood checkin:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editId || !confirm('Delete this mood check-in?')) return;
    setDeleting(true);
    try {
      await moodCheckins.delete(editId);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete mood checkin:', err);
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

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{editId ? 'Edit Mood' : 'How are you feeling?'}</h1>
      </div>

      {/* Mood selector */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-around">
          {[5, 4, 3, 2, 1].map((m) => (
            <button
              key={m}
              onClick={() => setMood(m)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all ${
                mood === m
                  ? `scale-110 bg-gray-100 dark:bg-gray-800 ring-2 ring-offset-1 ${m === 1 ? 'ring-red-400' : m === 2 ? 'ring-orange-400' : m === 3 ? 'ring-yellow-400' : m === 4 ? 'ring-lime-400' : 'ring-green-400'}`
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <MoodIcon mood={m} pack={iconPack} size={32} />
              <span className={`text-xs font-medium ${MOOD_COLORS[m]}`}>
                {MOOD_LABELS[m]}
              </span>
            </button>
          ))}
        </div>

        {/* Time */}
        <input
          type="datetime-local"
          value={checkedInAt}
          onChange={(e) => setCheckedInAt(e.target.value)}
          className="input w-full text-gray-900 dark:text-gray-100"
        />
      </div>

      {/* Note */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Note</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's on your mind?"
          rows={4}
          className="input w-full resize-none"
        />
      </div>

      {/* Activities */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Activities</h2>
          <Link
            to="/settings#mood-activities"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            <SettingsIcon size={14} />
          </Link>
        </div>

        <input
          type="text"
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              toggleTopFilteredActivity();
            }
          }}
          placeholder="Filter by activity or group"
          className="input w-full"
        />

        {filteredGroups.map((group) => (
          <div key={group.id}>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {group.name}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.activities.map((act) => (
                <button
                  key={act.id}
                  onClick={() => toggleActivity(act.id)}
                  className={`px-1.5 py-1 text-sm rounded-xl border transition-all ${
                    selectedActivities.has(act.id)
                      ? 'bg-primary-500 text-white border-primary-500 shadow-sm shadow-primary-900/20'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-500'
                  }`}
                >
                  <span className="flex flex-row items-center justify-start gap-1">
                    {act.icon ? (() => {
                      const IconComponent = resolveActivityIcon(act.icon);
                      return IconComponent ? <IconComponent size={18} className="shrink-0 text-current" /> : null;
                    })() : null}
                    {act.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {normalizedFilter && filteredGroups.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No matching activities.</p>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={mood === 0 || saving}
        className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? (
          <Loader2 className="animate-spin mx-auto" size={20} />
        ) : editId ? (
          'Update Mood'
        ) : (
          'Check In'
        )}
      </button>

      {/* Delete (edit mode) */}
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
