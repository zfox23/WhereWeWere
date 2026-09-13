import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, ArrowLeft, ExternalLink, PlusCircle, ListPlus, Trash2, X, Calendar,
  Pencil, Check,
} from 'lucide-react';
import { media } from '../../api/client';
import type { MediaCheckIn, MediaItem, MediaList, MediaSubtype } from '../../types';
import Stars from '../../components/Stars';
import ScorePicker from '../../components/ScorePicker';
import { MarkdownNote } from '../../components/checkin-card/MarkdownNote';
import {
  MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS, dateInTimezone, formatCheckinDate, formatTimePlayed,
  isoToDatetimeValue, datetimeValueToIso,
} from '../../utils/media';
import { TIMEZONE_IDS, isValidTimezoneId } from '../../utils/timezones';
import { findExactOption } from '../../components/filters/filterUtils';
import { slugify } from '../../utils/slugify';
import { usePageTitle } from '../../utils/pageTitle';

interface MediaDetailProps {
  subtype: MediaSubtype;
}

interface CheckinEditDraft {
  season_number: number;
  episode_number: number;
  episode_title: string;
  checkin_type: 'completed' | 'in_progress' | 'dropped';
  rating: number;
  notes: string;
  /** datetime-local input value (YYYY-MM-DDTHH:mm) in `timezone`. */
  datetime: string;
  /** Committed, valid IANA time zone ID (used on save). */
  timezone: string;
  /** Raw text currently in the time zone input (may not match yet). */
  timezoneInput: string;
  time_hours: string;
  time_minutes: string;
}

export default function MediaDetail({ subtype }: MediaDetailProps) {
  const config = MEDIA_SUBTYPES[subtype];
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<MediaItem | null>(null);
  const [checkins, setCheckins] = useState<MediaCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCheckinId, setHighlightedCheckinId] = useState<string | null>(null);
  const location = useLocation();

  const [showListModal, setShowListModal] = useState(false);
  const [lists, setLists] = useState<MediaList[]>([]);
  const [newListName, setNewListName] = useState('');
  const [listMsg, setListMsg] = useState<string | null>(null);

  // Inline edit state: at most one check-in row in edit mode at a time.
  const [editingCheckinId, setEditingCheckinId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CheckinEditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  usePageTitle(`${config.label}: ${item?.title || ''}`);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [itemData, checkinData] = await Promise.all([
          media.getItem(id),
          media.listCheckins(id),
        ]);
        if (cancelled) return;
        setItem(itemData);
        setCheckins(checkinData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Deep-link support: #checkin-<id> in the URL scrolls to and highlights the
  // matching check-in row (used by the MediaCard timestamp links on the timeline).
  useEffect(() => {
    const match = window.location.hash.match(/^#checkin-(.+)$/);
    if (!match || loading || checkins.length === 0) return;
    const checkinId = match[1];
    if (!checkins.some((c) => c.id === checkinId)) return;
    const el = document.getElementById(`checkin-${checkinId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightedCheckinId(checkinId);
    const timer = setTimeout(() => setHighlightedCheckinId(null), 4000);
    return () => clearTimeout(timer);
  }, [checkins, loading, location.hash]);

  const openListModal = async () => {
    try {
      setLists(await media.lists());
    } catch {
      setLists([]);
    }
    setListMsg(null);
    setShowListModal(true);
  };

  const handleAddToList = async (listId: string | null) => {
    if (!id || !listId) return;
    try {
      await media.addItemToList(listId, id);
      setLists(await media.lists());
      setListMsg('Added to list.');
    } catch (err) {
      setListMsg(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!id || !newListName.trim()) return;
    try {
      const list = await media.createList(newListName.trim());
      await media.addItemToList(list.id, id);
      setLists(await media.lists());
      setNewListName('');
      setListMsg('Created and added to list.');
    } catch (err) {
      setListMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRemoveFromList = async (listId: string) => {
    if (!id) return;
    try {
      await media.removeItemFromList(listId, id);
      setLists(await media.lists());
    } catch {
      // ignore
    }
  };

  const startEdit = (c: MediaCheckIn) => {
    setEditingCheckinId(c.id);
    setEditError(null);
    const tz = c.checkin_timezone || 'UTC';
    setDraft({
      season_number: c.season_number ?? 0,
      episode_number: c.episode_number ?? 0,
      episode_title: c.episode_title || '',
      checkin_type: c.checkin_type,
      rating: c.rating ?? 0,
      notes: c.notes || '',
      datetime: isoToDatetimeValue(c.checked_in_at, c.checkin_timezone),
      timezone: tz,
      timezoneInput: tz,
      time_hours: c.time_played_minutes != null ? String(Math.floor(c.time_played_minutes / 60)) : '',
      time_minutes: c.time_played_minutes != null ? String(c.time_played_minutes % 60) : '',
    });
    // Keep the row visible while editing.
    window.setTimeout(() => {
      document.getElementById(`checkin-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  const cancelEdit = () => {
    setEditingCheckinId(null);
    setDraft(null);
    setEditError(null);
  };

  const saveEdit = async (checkinId: string) => {
    if (!draft || saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const tz = draft.timezone;
      if (!isValidTimezoneId(tz)) {
        setEditError('Enter a valid time zone (e.g. America/New_York).');
        setSaving(false);
        return;
      }
      const checkedInAt = datetimeValueToIso(draft.datetime, tz);
      if (!checkedInAt) {
        setEditError('Invalid date & time.');
        setSaving(false);
        return;
      }
      const h = parseInt(draft.time_hours, 10);
      const m = parseInt(draft.time_minutes, 10);
      const totalMin = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
      const timePlayed = subtype === 'game' && totalMin > 0 ? totalMin : null;

      const updated = await media.updateCheckin(checkinId, {
        season_number: subtype === 'tv_show' && draft.season_number > 0 ? draft.season_number : null,
        episode_number: subtype === 'tv_show' && draft.episode_number > 0 ? draft.episode_number : null,
        episode_title: subtype === 'tv_show' ? draft.episode_title.trim() || null : null,
        checkin_type: draft.checkin_type,
        rating: draft.rating > 0 ? draft.rating : null,
        notes: draft.notes.trim() || null,
        checked_in_at: checkedInAt,
        timezone: tz,
        time_played_minutes: timePlayed,
      });

      // Refresh the check-in row and the item header aggregates.
      setCheckins((prev) => prev.map((c) => (c.id === checkinId ? { ...c, ...updated } : c)));
      if (item) {
        setItem(await media.getItem(item.id));
      }
      setEditingCheckinId(null);
      setDraft(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const deleteEdit = async (checkinId: string) => {
    if (!window.confirm('Delete this check-in? This cannot be undone.')) return;
    cancelEdit();
    try {
      await media.deleteCheckin(checkinId);
      setCheckins((prev) => prev.filter((c) => c.id !== checkinId));
      if (item) {
        setItem(await media.getItem(item.id));
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteCheckin = async (checkinId: string) => {
    try {
      await media.deleteCheckin(checkinId);
      setCheckins((prev) => prev.filter((c) => c.id !== checkinId));
    } catch {
      // ignore
    }
  };

  const handleAddToTimeline = () => {
    if (!item) return;
    if (subtype === 'tv_show') {
      navigate(`/media-check-in/tv/${item.id}/${slugify(item.title)}`);
    } else {
      navigate(`${config.searchPath}/${item.id}/${slugify(item.title)}`);
    }
  };

  /** Home URL with a single-day filter applied (opens in a new tab). */
  const homeDateUrl = (checkin: MediaCheckIn): string => {
    const date = dateInTimezone(checkin.checked_in_at, checkin.checkin_timezone);
    const url = new URL('/', window.location.origin);
    url.searchParams.set('from', date);
    url.searchParams.set('to', date);
    return `${url.pathname}${url.search}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate(config.searchPath)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-red-600 dark:text-red-400">{error || 'Failed to load media item'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(config.searchPath)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ArrowLeft size={15} /> {config.plural}
      </button>

      {/* Header */}
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 flex gap-5">
        {item.image_url ? (
          <img src={item.image_url} alt={item.title} className="w-24 h-32 object-cover rounded-xl shadow-md shrink-0" />
        ) : (
          <div className="w-24 h-32 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-4xl shrink-0">
            {config.icon}
          </div>
        )}
        <div className="min-w-0 flex flex-col">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{item.title}</h1>
          {item.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{item.author}</p>}
          {subtype === 'book' && item.series_name && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {item.series_position != null && <span>#{item.series_position}{item.series_count != null ? ` of ${item.series_count}` : ''} in </span>}
              <span className="italic">{item.series_name}</span>
            </p>
          )}
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            {item.release_year && <span className="text-sm text-gray-500">{item.release_year}</span>}
            {subtype === 'book' && item.page_count != null && (
              <span className="text-sm text-gray-500">{item.page_count} pages</span>
            )}
            {subtype === 'game' && item.total_time_played_minutes != null && (
              <span className="text-sm text-gray-500">
                {formatTimePlayed(item.total_time_played_minutes)} played
              </span>
            )}
            {item.my_rating != null && item.my_rating > 0 && (
              <span className="flex items-center gap-1.5">
                <Stars value={item.my_rating} />
              </span>
            )}
            {item.last_checkin_at && (
              <span className="text-xs text-gray-400">
                Last check-in: {new Date(item.last_checkin_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          {item.external_url && (
            <a
              href={item.external_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline mt-2"
            >
              View on {config.apiName || 'web'} <ExternalLink size={11} />
            </a>
          )}
          <div className="flex items-center gap-3 mt-auto pt-4">
            <button onClick={handleAddToTimeline} className="btn-primary text-sm">
              <PlusCircle size={15} className="mr-1.5" />
              Add to Timeline
            </button>
            <button onClick={openListModal} className="btn-secondary text-sm">
              <ListPlus size={15} className="mr-1.5" />
              Add to List
            </button>
          </div>
        </div>
      </div>

      {/* Check-ins table */}
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Check-ins ({checkins.length})
          </h2>
        </div>
        {checkins.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No check-ins yet. Use “Add to Timeline” to record one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-2 font-medium">Date</th>
                {subtype === 'tv_show' && <th className="px-4 py-2 font-medium hidden sm:table-cell">Episode</th>}
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Score</th>
                {subtype === 'game' && <th className="px-4 py-2 font-medium">Time Played</th>}
                <th className="px-4 py-2 font-medium hidden md:table-cell">Notes</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {checkins.map((c) => {
                const isEditing = editingCheckinId === c.id && draft != null;
                const patchDraft = (patch: Partial<CheckinEditDraft>) =>
                  setDraft((d) => (d ? { ...d, ...patch } : d));
                const tzNeedle = isEditing && draft ? draft.timezoneInput.trim().toLowerCase() : '';
                const filteredTimezoneOptions = isEditing && draft
                  ? (tzNeedle
                      ? TIMEZONE_IDS.filter((tz) => tz.toLowerCase().includes(tzNeedle))
                      : TIMEZONE_IDS
                    ).slice(0, 30)
                  : [];
                return (
                  <tr
                    key={c.id}
                    id={`checkin-${c.id}`}
                    className={`border-b border-gray-50 dark:border-gray-800/50 last:border-0 transition-colors ${highlightedCheckinId === c.id
                      ? 'bg-primary-50 dark:bg-primary-900/30'
                      : isEditing
                        ? 'bg-primary-50/50 dark:bg-primary-900/20'
                        : ''
                      }`}
                  >
                    {isEditing ? (
                      <>
                        <td className="px-4 py-2.5">
                          <input
                            type="datetime-local"
                            value={draft.datetime}
                            onChange={(e) => patchDraft({ datetime: e.target.value })}
                            className="input text-xs w-[190px]"
                          />
                          <input
                            type="text"
                            list="checkin-timezone-options"
                            value={draft.timezoneInput}
                            onChange={(e) => {
                              const next = e.target.value;
                              patchDraft({ timezoneInput: next });
                              const match = findExactOption(next, TIMEZONE_IDS);
                              // Commit a recognized IANA id (or clear the
                              // committed value when the text no longer matches).
                              if (match && match !== draft.timezone) patchDraft({ timezone: match });
                              else if (!match && draft.timezone) patchDraft({ timezone: '' });
                            }}
                            onBlur={() => {
                              const match = findExactOption(draft.timezoneInput, TIMEZONE_IDS);
                              if (match) {
                                if (match !== draft.timezone) patchDraft({ timezoneInput: match, timezone: match });
                              } else {
                                // Revert to the last committed (or original) valid zone.
                                const fallback = draft.timezone || 'UTC';
                                patchDraft({ timezoneInput: fallback, timezone: fallback });
                              }
                            }}
                            placeholder="Time zone (e.g. America/New_York)"
                            className={`input text-[11px] mt-1 w-[190px] ${draft.timezoneInput.trim() && !findExactOption(draft.timezoneInput, TIMEZONE_IDS)
                              ? 'border-red-400 focus:ring-red-300'
                              : ''
                            }`}
                          />
                          <datalist id="checkin-timezone-options">
                            {filteredTimezoneOptions.map((tz) => (
                              <option key={tz} value={tz} />
                            ))}
                          </datalist>
                          {editError && (
                            <p className="text-[11px] text-red-500 dark:text-red-400 mt-1">{editError}</p>
                          )}
                        </td>
                        {subtype === 'tv_show' && (
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                value={draft.season_number > 0 ? draft.season_number : ''}
                                onChange={(e) => patchDraft({ season_number: parseInt(e.target.value, 10) || 0 })}
                                placeholder="S"
                                className="input text-xs w-12"
                              />
                              <input
                                type="number"
                                min={1}
                                value={draft.episode_number > 0 ? draft.episode_number : ''}
                                onChange={(e) => patchDraft({ episode_number: parseInt(e.target.value, 10) || 0 })}
                                placeholder="E"
                                className="input text-xs w-12"
                              />
                            </div>
                            <input
                              type="text"
                              value={draft.episode_title}
                              onChange={(e) => patchDraft({ episode_title: e.target.value })}
                              placeholder="Episode title"
                              className="input text-xs mt-1"
                            />
                          </td>
                        )}
                        <td className="px-4 py-2.5">
                          <select
                            value={draft.checkin_type}
                            onChange={(e) => patchDraft({ checkin_type: e.target.value as 'completed' | 'in_progress' | 'dropped' })}
                            className="input text-xs"
                          >
                            <option value="completed">{CHECKIN_TYPE_LABELS.completed}</option>
                            <option value="in_progress">{CHECKIN_TYPE_LABELS.in_progress}</option>
                            <option value="dropped">{CHECKIN_TYPE_LABELS.dropped}</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <ScorePicker value={draft.rating} onChange={(v) => patchDraft({ rating: v })} size={18} />
                        </td>
                        {subtype === 'game' && (
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={draft.time_hours}
                                onChange={(e) => patchDraft({ time_hours: e.target.value })}
                                placeholder="0"
                                inputMode="numeric"
                                className="input text-xs w-14"
                              />
                              <span className="text-xs text-gray-400">h</span>
                              <input
                                type="number"
                                min={0}
                                max={59}
                                value={draft.time_minutes}
                                onChange={(e) => patchDraft({ time_minutes: e.target.value })}
                                placeholder="0"
                                inputMode="numeric"
                                className="input text-xs w-14"
                              />
                              <span className="text-xs text-gray-400">m</span>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-2.5 hidden md:table-cell max-w-[320px]">
                          <textarea
                            value={draft.notes}
                            onChange={(e) => patchDraft({ notes: e.target.value })}
                            rows={2}
                            placeholder="Notes (Markdown)…"
                            className="input font-mono text-xs resize-y min-h-[52px]"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-0.5 justify-end">
                            <button
                              onClick={() => deleteEdit(c.id)}
                              className="p-1.5 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                              title="Delete check-in"
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-300"
                              title="Discard changes"
                            >
                              <X size={14} />
                            </button>
                            <button
                              onClick={() => saveEdit(c.id)}
                              disabled={saving}
                              className="p-1.5 text-gray-300 hover:text-green-500 dark:text-gray-600 dark:hover:text-green-400 disabled:opacity-50"
                              title="Accept changes"
                            >
                              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5">
                          <a
                            href={`#checkin-${c.id}`}
                            className="text-primary-600 hover:underline whitespace-nowrap">
                            {formatCheckinDate(c.checked_in_at, c.checkin_timezone)}
                          </a>
                        </td>
                        {subtype === 'tv_show' && (
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hidden sm:table-cell whitespace-nowrap">
                            {c.season_number != null ? `S${c.season_number} E${c.episode_number}` : '—'}
                            {c.episode_title && <span className="hidden lg:inline text-gray-400"> · {c.episode_title}</span>}
                          </td>
                        )}
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.checkin_type === 'completed'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : c.checkin_type === 'dropped'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              }`}
                          >
                            {CHECKIN_TYPE_LABELS[c.checkin_type] || c.checkin_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {c.rating != null && c.rating > 0 ? <Stars value={c.rating} /> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        {subtype === 'game' && (
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {formatTimePlayed(c.time_played_minutes) ?? '—'}
                          </td>
                        )}
                        <td className="px-4 py-2.5 hidden md:table-cell max-w-[320px]">
                          {c.notes ? (
                            <div className="text-xs">
                              <MarkdownNote note={c.notes} />
                            </div>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-0.5 justify-end">
                            <a
                              href={homeDateUrl(c)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open Home filtered to this date"
                              className="p-1.5 text-gray-300 hover:text-primary-500 dark:text-gray-600 dark:hover:text-primary-400"
                            >
                              <Calendar size={14} />
                            </a>
                            <button
                              onClick={() => startEdit(c)}
                              className="p-1.5 text-gray-300 hover:text-primary-500 dark:text-gray-600 dark:hover:text-primary-400"
                              title="Edit check-in"
                            >
                              <Pencil size={14} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add to List modal */}
      {showListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowListModal(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add to List</h3>
              <button onClick={() => setShowListModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {lists.length === 0 && (
                <p className="text-sm text-gray-400 py-2">No lists yet — create one below.</p>
              )}
              {lists.map((list) => {
                const inList = list.items.some((i) => i.id === item.id);
                return (
                  <div key={list.id} className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleAddToList(list.id)}
                      disabled={inList}
                      className={`flex-1 text-left px-3 py-2 rounded-lg text-sm border transition-colors ${inList
                        ? 'border-gray-100 dark:border-gray-800 text-gray-400 cursor-default'
                        : 'border-gray-200 dark:border-gray-700 hover:border-primary-400 text-gray-700 dark:text-gray-300'
                        }`}
                    >
                      {list.name}
                      {inList && <span className="ml-2 text-xs text-green-600">✓ added</span>}
                    </button>
                    {inList && (
                      <button
                        onClick={() => handleRemoveFromList(list.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500"
                        title="Remove from list"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(); }}
                placeholder="New list name…"
                className="input text-sm"
              />
              <button
                onClick={handleCreateAndAdd}
                disabled={!newListName.trim()}
                className="btn-primary text-sm whitespace-nowrap"
              >
                Create & Add
              </button>
            </div>

            {listMsg && <p className="text-xs text-gray-500">{listMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
