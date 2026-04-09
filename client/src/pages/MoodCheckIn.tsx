import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Trash2, ArrowLeft, Check, ChevronDown, Settings as SettingsIcon } from 'lucide-react';
import { moodCheckins, moodActivities, settings as settingsApi } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS } from '../components/MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import type { MoodActivityGroup } from '../types';
import { usePageTitle } from '../utils/pageTitle';

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

const NOTE_PLACEHOLDERS = [
  'What is sitting with you right now?',
  'What happened today that shaped this mood?',
  'What feels most true in this moment?',
  'What are you carrying right now?',
  'What has your attention today?',
  'What is the emotional headline of this moment?',
  'What nudged your mood in this direction?',
  'What is feeling easy right now?',
  'What is feeling heavy right now?',
  'What surprised you about today?',
  'What are you reacting to?',
  'What is giving this mood its color?',
  'What do you need more of right now?',
  'What do you need less of right now?',
  'What part of today is sticking with you?',
  'What feels unresolved?',
  'What feels better than expected?',
  'What feels harder than expected?',
  'What are you grateful for in this moment?',
  'What has been draining your energy?',
  'What has been restoring your energy?',
  'What are you trying not to ignore?',
  'What conversation is echoing in your mind?',
  'What moment from today do you want to remember?',
  'What are you proud of today?',
  'What would make tonight feel complete?',
  'What are you learning about yourself lately?',
  'What are you hoping for next?',
  'What are you letting go of today?',
  'What tension are you noticing in yourself?',
  'What felt meaningful today?',
  'What felt off today?',
  'What gave you a lift today?',
  'What pulled you down today?',
  'What is taking up emotional space?',
  'What are you making peace with?',
  'What do you wish someone understood about today?',
  'What helped you cope?',
  'What are you avoiding saying out loud?',
  'What small win happened today?',
  'What felt comforting today?',
  'What felt lonely today?',
  'What are you still processing?',
  'What do you want future you to know about this moment?',
  'What pattern are you noticing?',
  'What felt most alive today?',
  'What was emotionally expensive today?',
  'What felt calm or steady?',
  'What do you want to remember about how this felt?',
  'What words best match your inner weather?',
] as const;

export default function MoodCheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  usePageTitle(editId ? 'Edit Mood Check-In' : 'New Mood Check-In');

  const dateParam = searchParams.get('date') || '';
  const hasDatePrefill = DATE_ONLY_PATTERN.test(dateParam);

  const defaultCheckedInAt = toLocalDatetimeString(new Date());

  const [mood, setMood] = useState<number>(0);
  const [note, setNote] = useState('');
  const [checkedInAt, setCheckedInAt] = useState(
    hasDatePrefill ? applyDateToLocalDatetime(dateParam, defaultCheckedInAt) : defaultCheckedInAt
  );
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [activityFilter, setActivityFilter] = useState('');
  const [groups, setGroups] = useState<MoodActivityGroup[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [iconPack, setIconPack] = useState('emoji');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [notePlaceholder] = useState(
    () => NOTE_PLACEHOLDERS[Math.floor(Math.random() * NOTE_PLACEHOLDERS.length)]
  );
  const timeZoneAbbreviation = getLocalTimeZoneAbbreviation(checkedInAt);

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

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
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

  useEffect(() => {
    if (!normalizedFilter) {
      return;
    }

    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      for (const group of filteredGroups) {
        next.delete(group.id);
      }
      return next;
    });
  }, [filteredGroups, normalizedFilter]);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        if (
          target.isContentEditable
          || tagName === 'INPUT'
          || tagName === 'TEXTAREA'
          || tagName === 'SELECT'
        ) {
          return;
        }
      }

      if (event.key >= '1' && event.key <= '5') {
        setMood(Number(event.key));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    <div className="max-w-lg mx-auto space-y-3">
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
          {[1, 2, 3, 4, 5].map((m) => (
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
              <span className="rounded-md border border-gray-200/80 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300">
                {m}
              </span>
            </button>
          ))}
        </div>

        {/* Time */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-start gap-2">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
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
            value={checkedInAt}
            onChange={(e) => setCheckedInAt(e.target.value)}
            className="input w-full text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Note */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Note.md</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={notePlaceholder}
          rows={4}
          className="input w-full resize-none"
        />
      </div>

      {/* Activities */}
      <div className="space-y-0">
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl rounded-b-xl border border-white/40 dark:border-gray-700/40 p-4 space-y-4">
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
            placeholder="Filter by activity or group..."
            className="input w-full"
          />
        </div>

        <div className="relative z-10 mx-auto -mt-1 flex h-7 w-28 items-center justify-center">
          <div className="flex items-center gap-2">
            <span className="h-px w-6 bg-gradient-to-r from-transparent to-gray-300/80 dark:to-gray-700/80" />
            <span className="h-3 w-3 rounded-full border border-white/60 bg-white/80 shadow-sm shadow-black/[0.04] backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-800/85" />
            <span className="h-px w-6 bg-gradient-to-l from-transparent to-gray-300/80 dark:to-gray-700/80" />
          </div>
        </div>

        {filteredGroups.length > 0 ? (
          <div className="-mt-1 space-y-0">
            {filteredGroups.map((group, index) => (
              <div key={group.id} className="contents">
                <div
                  className="relative left-1/2 w-full max-w-full -translate-x-1/2 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl rounded-b-xl border border-white/40 dark:border-gray-700/40 p-4 md:w-[calc(100vw-3rem)] md:max-w-3xl lg:max-w-5xl"
                >
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(group.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                    aria-expanded={!collapsedGroups.has(group.id)}
                  >
                    <span className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                      {group.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {group.activities.length}
                      </span>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white/80 text-gray-500 transition-colors hover:border-primary-300 hover:text-primary-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:border-primary-500 dark:hover:text-primary-300">
                        <ChevronDown
                          size={16}
                          className={`transition-transform ${collapsedGroups.has(group.id) ? '-rotate-90' : 'rotate-0'}`}
                        />
                      </span>
                    </span>
                  </button>
                  {!collapsedGroups.has(group.id) && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.activities.map((act) => (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => toggleActivity(act.id)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all ${
                            selectedActivities.has(act.id)
                              ? 'border-primary-500 bg-primary-500 text-white shadow-md shadow-primary-900/20'
                              : 'border-gray-200 bg-white/80 text-gray-700 shadow-sm shadow-black/[0.02] hover:-translate-y-[1px] hover:border-primary-300 hover:bg-primary-50/70 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-primary-500 dark:hover:bg-gray-800'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                selectedActivities.has(act.id)
                                  ? 'bg-white/15 text-white'
                                  : 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300'
                              }`}>
                                {act.icon ? (() => {
                                  const IconComponent = resolveActivityIcon(act.icon);
                                  return IconComponent ? <IconComponent size={18} className="shrink-0" /> : null;
                                })() : <Check size={16} className="opacity-60" />}
                              </span>
                              <span className="min-w-0 truncate text-sm font-medium">
                                {act.name}
                              </span>
                            </span>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              selectedActivities.has(act.id)
                                ? 'border-white/40 bg-white/15 text-white'
                                : 'border-gray-300 text-transparent dark:border-gray-600'
                            }`}>
                              <Check size={12} />
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {index < filteredGroups.length - 1 && (
                  <div className="pointer-events-none relative z-10 mx-auto flex h-8 items-center justify-center">
                    <div className="flex items-center gap-2">
                      <span className="h-px w-10 bg-gradient-to-r from-transparent to-gray-300/70 dark:to-gray-700/70" />
                      <span className="h-2.5 w-2.5 rounded-full border border-white/60 bg-white/75 shadow-sm shadow-black/[0.04] dark:border-gray-700/60 dark:bg-gray-800/80" />
                      <span className="h-px w-10 bg-gradient-to-l from-transparent to-gray-300/70 dark:to-gray-700/70" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : normalizedFilter ? (
          <div className="-mt-1 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No matching activities.</p>
          </div>
        ) : null}
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
          <span className="inline-flex items-center gap-2">
            <span>Update Mood</span>
            <span className="rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
              Shift+Enter
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span>Check In</span>
            <span className="rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
              Shift+Enter
            </span>
          </span>
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
