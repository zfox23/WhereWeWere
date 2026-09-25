import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, ArrowLeft, ExternalLink, PlusCircle, ListPlus, Trash2, X, Calendar,
  Pencil, Check, RefreshCw,
} from 'lucide-react';
import { media } from '../api';
import type { MediaCheckIn, MediaItem, MediaList } from '../types';
import type { MediaSubtype } from '../../../../client/src/types';
import Stars from '../../../../client/src/components/Stars';
import ScorePicker from '../../../../client/src/components/ScorePicker';
import { MarkdownNote } from '../../../../client/src/components/checkin-card/MarkdownNote';
import {
  MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS, dateInTimezone, formatCheckinDate, formatTimePlayed,
  isoToDatetimeValue, datetimeValueToIso,
} from '../../utils/media';
import CompanionChipInput from '../../../../client/src/components/CompanionChipInput';
import { TIMEZONE_IDS, isValidTimezoneId } from '../../../../client/src/utils/timezones';
import { findExactOption } from '../../../../client/src/components/filters/filterUtils';
import { slugify } from '../../../../client/src/utils/slugify';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';

interface MediaDetailProps {
  subtype: MediaSubtype;
}

interface CheckinEditDraft {
  season_number: number;
  episode_number: number;
  episode_title: string;
  checkin_type: 'completed' | 'in_progress' | 'started' | 'dropped';
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
  companions: string[];
}

/** Draft state for editing the media item's own metadata (header edit mode). */
interface ItemEditDraft {
  title: string;
  author: string;
  release_year: string;
  image_url: string;
  external_url: string;
  platform: string;
  page_count: string;
  series_name: string;
  series_position: string;
  series_count: string;
  external_id: string;
  /** Item-level user metadata (all types). */
  rating: number;
  notes: string;
  /** Games only: cumulative time played. */
  time_hours: string;
  time_minutes: string;
  status: string;
  /** Games only: TGDB-sourced metadata (directly editable). */
  overview: string;
  content_rating: string;
  players: string;
  coop: string;
  genres: string;
  developers: string;
  publishers: string;
}

/** Fields a provider can refresh via sync (all keys of MediaItem). */
type SyncableField =
  | 'title' | 'author' | 'release_year' | 'image_url' | 'platform'
  | 'external_id' | 'external_url'
  | 'overview' | 'content_rating' | 'players' | 'coop'
  | 'genres' | 'developers' | 'publishers'
  | 'page_count' | 'series_name' | 'series_position' | 'series_count';

interface MetadataDiff {
  field: SyncableField;
  current: string | number | string[] | null;
  proposed: string | number | string[];
}

const METADATA_FIELD_LABELS: Record<SyncableField, string> = {
  title: 'Title',
  author: 'Author',
  release_year: 'Release year',
  image_url: 'Image URL',
  platform: 'Platform',
  external_id: 'External ID',
  external_url: 'External URL',
  overview: 'Overview',
  content_rating: 'Content rating',
  players: 'Players',
  coop: 'Co-op',
  genres: 'Genres',
  developers: 'Developers',
  publishers: 'Publishers',
  page_count: 'Page count',
  series_name: 'Series',
  series_position: 'Series position',
  series_count: 'Series count',
};

/** Render a diff value (scalar or name array) as display text. */
function diffValueText(value: string | number | string[] | null): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  return String(value);
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

  // The back button restores the page the user came from. Library cards pass
  // the library's current filter URL as `mediaFrom` in navigation state, so
  // returning there deep-links back to the previously-set filters. Without
  // it (e.g. arriving from the check-in form, a timeline link, or a shared
  // URL), fall back to the media check-in search screen.
  const handleBack = () => {
    const from = (location.state as { mediaFrom?: string } | null)?.mediaFrom;
    if (from && from.startsWith('/')) {
      navigate(from);
    } else {
      navigate(config.searchPath);
    }
  };

  const [showListModal, setShowListModal] = useState(false);
  const [lists, setLists] = useState<MediaList[]>([]);
  const [newListName, setNewListName] = useState('');
  const [listMsg, setListMsg] = useState<string | null>(null);

  // Inline edit state: at most one check-in row in edit mode at a time.
  const [editingCheckinId, setEditingCheckinId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CheckinEditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Header metadata edit mode.
  const [editingItem, setEditingItem] = useState(false);
  const [itemDraft, setItemDraft] = useState<ItemEditDraft | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [itemEditError, setItemEditError] = useState<string | null>(null);

  // Provider sync (only meaningful in edit mode, for items with an external_id).
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncDiff, setSyncDiff] = useState<MetadataDiff[] | null>(null);
  const [acceptingField, setAcceptingField] = useState<SyncableField | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

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
      companions: c.companions ?? [],
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
        companions: draft.companions,
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

  // --- Header metadata editing -------------------------------------------------

  const startItemEdit = () => {
    if (!item) return;
    setItemEditError(null);
    setSyncError(null);
    setSyncDiff(null);
    setItemDraft({
      title: item.title || '',
      author: item.author || '',
      release_year: item.release_year != null ? String(item.release_year) : '',
      image_url: item.image_url || '',
      external_url: item.external_url || '',
      platform: item.platform || '',
      page_count: item.page_count != null ? String(item.page_count) : '',
      series_name: item.series_name || '',
      series_position: item.series_position != null ? String(item.series_position) : '',
      series_count: item.series_count != null ? String(item.series_count) : '',
      external_id: item.external_id || '',
      rating: item.rating ?? 0,
      notes: item.notes || '',
      time_hours: item.time_played_minutes != null ? String(Math.floor(item.time_played_minutes / 60)) : '',
      time_minutes: item.time_played_minutes != null ? String(item.time_played_minutes % 60) : '',
      status: item.status || '',
      overview: item.overview || '',
      content_rating: item.content_rating || '',
      players: item.players != null ? String(item.players) : '',
      coop: item.coop || '',
      genres: (item.genres || []).join(', '),
      developers: (item.developers || []).join(', '),
      publishers: (item.publishers || []).join(', '),
    });
    setEditingItem(true);
  };

  const cancelItemEdit = () => {
    setEditingItem(false);
    setItemDraft(null);
    setItemEditError(null);
    setSyncError(null);
    setSyncDiff(null);
  };

  const patchItemDraft = (patch: Partial<ItemEditDraft>) =>
    setItemDraft((d) => (d ? { ...d, ...patch } : d));

  /** Persist a subset of the current item draft (or explicit fields). */
  const saveItemFields = async (explicit?: Partial<ItemEditDraft>): Promise<boolean> => {
    if (!item || !itemDraft) return false;
    const d = explicit ? { ...itemDraft, ...explicit } : itemDraft;
    const payload: Record<string, unknown> = {};
    const put = (key: string, value: string, numeric = false) => {
      payload[key] = numeric ? (value.trim() === '' ? null : parseInt(value, 10) || null)
        : (value.trim() === '' ? null : value.trim());
    };
    payload.title = d.title.trim();
    put('author', d.author);
    put('release_year', d.release_year, true);
    put('image_url', d.image_url);
    put('external_url', d.external_url);
    if (subtype === 'game') put('platform', d.platform);
    if (subtype === 'book') {
      put('page_count', d.page_count, true);
      put('series_name', d.series_name);
      put('series_position', d.series_position, true);
      put('series_count', d.series_count, true);
    }
    // Only send external_id when it differs from the saved value (setting it
    // derives external_source on the server; clearing is not supported here).
    if (subtype !== 'board_game' && d.external_id.trim() !== (item.external_id || '')) {
      payload.external_id = d.external_id.trim() || null;
    }
    // Item-level user metadata (independent of check-ins).
    payload.rating = d.rating;
    payload.notes = d.notes.trim() || null;
    if (subtype === 'game') {
      const h = parseInt(d.time_hours, 10);
      const m = parseInt(d.time_minutes, 10);
      const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
      payload.time_played_minutes = total > 0 ? total : null;
      payload.status = d.status || null;
      // TGDB-sourced metadata (comma-separated lists → string arrays; empty → null).
      payload.overview = d.overview.trim() || null;
      payload.content_rating = d.content_rating.trim() || null;
      const players = d.players.trim() === '' ? null : parseInt(d.players, 10);
      payload.players = players != null && Number.isInteger(players) && players > 0 ? players : null;
      payload.coop = d.coop.trim() || null;
      const toArr = (s: string) =>
        s.split(',').map((v) => v.trim()).filter((v) => v !== '');
      const nameArr = (s: string) => {
        const a = toArr(s);
        return a.length > 0 ? a : null;
      };
      payload.genres = nameArr(d.genres);
      payload.developers = nameArr(d.developers);
      payload.publishers = nameArr(d.publishers);
    }
    try {
      setSavingItem(true);
      // PUT returns the full item with aggregates (same shape as GET).
      const updated = await media.updateItem(item.id, payload);
      setItem(updated);
      setItemDraft({ ...d, external_id: updated.external_id || '' });
      return true;
    } catch (err) {
      setItemEditError(err instanceof Error ? err.message : 'Failed to save changes');
      return false;
    } finally {
      setSavingItem(false);
    }
  };

  const saveItemEdit = async () => {
    if (!itemDraft) return;
    if (!itemDraft.title.trim()) {
      setItemEditError('Title is required.');
      return;
    }
    const ok = await saveItemFields();
    if (ok) cancelItemEdit();
  };

  // --- Provider sync -----------------------------------------------------------

  const buildSyncDiff = (
    base: { author?: string | null; release_year?: number | null; image_url?: string | null; platform?: string | null;
      external_id?: string | null; external_url?: string | null;
      overview?: string | null; content_rating?: string | null; players?: number | null; coop?: string | null;
      genres?: string[] | null; developers?: string[] | null; publishers?: string[] | null;
      page_count?: number | null; series_name?: string | null; series_position?: number | null; series_count?: number | null },
    metadata: Record<string, string | number | string[] | null>
  ): MetadataDiff[] => {
    const diffs: MetadataDiff[] = [];
    const push = (field: SyncableField, current: string | number | string[] | null | undefined, proposed: string | number | string[] | null | undefined) => {
      if (proposed == null || proposed === '' || (Array.isArray(proposed) && proposed.length === 0)) return;
      const cur = current == null || current === '' || (Array.isArray(current) && current.length === 0) ? null : current;
      if (String(cur ?? '') === String(proposed)) return;
      if (Array.isArray(cur) && Array.isArray(proposed) && cur.join(',') === proposed.join(',')) return;
      diffs.push({ field, current: cur, proposed: proposed as string | number | string[] });
    };
    // Title diff is computed against the (possibly already-edited) draft.
    if (itemDraft && metadata.title != null && String(metadata.title) !== itemDraft.title.trim()) {
      diffs.push({ field: 'title', current: itemDraft.title.trim(), proposed: String(metadata.title) });
    }
    push('author', base.author, metadata.author);
    push('release_year', base.release_year, metadata.release_year);
    push('image_url', base.image_url, metadata.image_url);
    push('platform', base.platform, metadata.platform);
    push('external_id', base.external_id, metadata.external_id);
    push('external_url', base.external_url, metadata.external_url);
    push('overview', base.overview, metadata.overview);
    push('content_rating', base.content_rating, metadata.content_rating);
    push('players', base.players, metadata.players);
    push('coop', base.coop, metadata.coop);
    push('genres', base.genres, metadata.genres);
    push('developers', base.developers, metadata.developers);
    push('publishers', base.publishers, metadata.publishers);
    push('page_count', base.page_count, metadata.page_count);
    push('series_name', base.series_name, metadata.series_name);
    push('series_position', base.series_position, metadata.series_position);
    push('series_count', base.series_count, metadata.series_count);
    return diffs;
  };

  const handleSyncMetadata = async () => {
    if (!item || !itemDraft || !config.apiName) return;
    // If the external_id only exists in the unsaved draft, persist it first so
    // the server can resolve the provider lookup against the saved item.
    // Games are exempt: a local-only game is re-keyed by the server via title
    // search, so syncing is allowed without an external id.
    if (!item.external_id && subtype !== 'game') {
      if (!itemDraft.external_id.trim()) {
        setSyncError('Enter the external ID above, then sync.');
        return;
      }
      const ok = await saveItemFields();
      if (!ok) return; // itemEditError is set
    }
    setSyncing(true);
    setSyncError(null);
    setSyncDiff(null);
    try {
      // Re-read the item (it may have just been updated with the external_id)
      // so the diff compares provider values against fresh server state.
      const [freshItem, res] = await Promise.all([
        media.getItem(item.id),
        media.syncItem(item.id),
      ]);
      setItem(freshItem);
      const diffs = buildSyncDiff(freshItem, res.metadata);
      if (diffs.length === 0) {
        setSyncError(`Metadata from ${res.provider} is already up to date.`);
      } else {
        setSyncDiff(diffs);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const acceptDiffField = async (field: SyncableField) => {
    if (!item || !syncDiff) return;
    const row = syncDiff.find((d) => d.field === field);
    if (!row) return;
    setAcceptingField(field);
    setSyncError(null);
    try {
      const payload: Record<string, unknown> = { [field]: row.proposed };
      const updated = await media.updateItem(item.id, payload);
      setItem(updated);
      // Mirror into the edit draft for fields the draft actually holds so the
      // open edit form doesn't go stale. Arrays (genres/developers/publishers)
      // are stored comma-separated in the draft.
      if (itemDraft && field in itemDraft) {
        const draftKey = field as keyof ItemEditDraft;
        const proposed = row.proposed;
        const value = proposed == null
          ? ''
          : Array.isArray(proposed) ? proposed.join(', ') : String(proposed);
        setItemDraft((d) => (d ? { ...d, [draftKey]: value } : d));
      }
      const remaining = syncDiff.filter((d) => d.field !== field);
      setSyncDiff(remaining.length > 0 ? remaining : null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to apply change');
    } finally {
      setAcceptingField(null);
    }
  };

  const rejectDiffField = (field: SyncableField) => {
    setSyncDiff((prev) => {
      if (!prev) return prev;
      const remaining = prev.filter((d) => d.field !== field);
      return remaining.length > 0 ? remaining : null;
    });
  };

  const acceptAllDiff = async () => {
    if (!item || !syncDiff || syncDiff.length === 0) return;
    setAcceptingAll(true);
    setSyncError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const row of syncDiff) payload[row.field] = row.proposed;
      const updated = await media.updateItem(item.id, payload);
      setItem(updated);
      setSyncDiff(null);
      cancelItemEdit();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setAcceptingAll(false);
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
          onClick={handleBack}
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
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ArrowLeft size={15} /> {config.plural}
      </button>

      {/* Header */}
      <div className="relative bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 flex gap-5">
        {!editingItem && (
          <button
            onClick={startItemEdit}
            className="absolute top-3.5 right-3.5 p-2 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:text-gray-500 dark:hover:text-primary-400 dark:hover:bg-primary-900/20"
            title="Edit metadata"
          >
            <Pencil size={15} />
          </button>
        )}
        {editingItem && itemDraft ? (
          <>
            {itemDraft.image_url.trim() ? (
              <img src={itemDraft.image_url.trim()} alt={itemDraft.title} className="w-24 h-32 object-cover rounded-xl shadow-md shrink-0" />
            ) : (
              <div className="w-24 h-32 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-4xl shrink-0">
                {config.icon}
              </div>
            )}
            <div className="min-w-0 flex flex-col gap-2.5 pr-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Title</span>
                  <input
                    type="text"
                    value={itemDraft.title}
                    onChange={(e) => patchItemDraft({ title: e.target.value })}
                    className="input text-sm mt-0.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Author</span>
                  <input
                    type="text"
                    value={itemDraft.author}
                    onChange={(e) => patchItemDraft({ author: e.target.value })}
                    placeholder="—"
                    className="input text-sm mt-0.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Release year</span>
                  <input
                    type="number"
                    min={0}
                    value={itemDraft.release_year}
                    onChange={(e) => patchItemDraft({ release_year: e.target.value })}
                    placeholder="e.g. 2019"
                    inputMode="numeric"
                    className="input text-sm mt-0.5"
                  />
                </label>
                {subtype === 'game' && (
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Platform</span>
                    <input
                      type="text"
                      value={itemDraft.platform}
                      onChange={(e) => patchItemDraft({ platform: e.target.value })}
                      placeholder="e.g. PlayStation 5"
                      className="input text-sm mt-0.5"
                    />
                  </label>
                )}
                {subtype === 'book' && (
                  <>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Page count</span>
                      <input
                        type="number"
                        min={0}
                        value={itemDraft.page_count}
                        onChange={(e) => patchItemDraft({ page_count: e.target.value })}
                        placeholder="—"
                        inputMode="numeric"
                        className="input text-sm mt-0.5"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Series</span>
                      <input
                        type="text"
                        value={itemDraft.series_name}
                        onChange={(e) => patchItemDraft({ series_name: e.target.value })}
                        placeholder="—"
                        className="input text-sm mt-0.5"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Series position</span>
                      <input
                        type="number"
                        min={0}
                        value={itemDraft.series_position}
                        onChange={(e) => patchItemDraft({ series_position: e.target.value })}
                        placeholder="—"
                        inputMode="numeric"
                        className="input text-sm mt-0.5"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Books in series</span>
                      <input
                        type="number"
                        min={0}
                        value={itemDraft.series_count}
                        onChange={(e) => patchItemDraft({ series_count: e.target.value })}
                        placeholder="—"
                        inputMode="numeric"
                        className="input text-sm mt-0.5"
                      />
                    </label>
                  </>
                )}
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Image URL</span>
                  <input
                    type="text"
                    value={itemDraft.image_url}
                    onChange={(e) => patchItemDraft({ image_url: e.target.value })}
                    placeholder="https://…"
                    className="input text-sm mt-0.5 font-mono text-xs"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">External URL</span>
                  <input
                    type="text"
                    value={itemDraft.external_url}
                    onChange={(e) => patchItemDraft({ external_url: e.target.value })}
                    placeholder="https://…"
                    className="input text-sm mt-0.5 font-mono text-xs"
                  />
                </label>
                {subtype === 'game' && (
                  <div className="sm:col-span-2 border-t border-gray-200 dark:border-gray-700 pt-2.5 mt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                      About the game <span className="normal-case font-normal">(from {config.apiName}, editable)</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Overview</span>
                        <textarea
                          value={itemDraft.overview}
                          onChange={(e) => patchItemDraft({ overview: e.target.value })}
                          rows={3}
                          placeholder="Synopsis…"
                          className="input text-sm mt-0.5 resize-y"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Content rating</span>
                        <input
                          type="text"
                          value={itemDraft.content_rating}
                          onChange={(e) => patchItemDraft({ content_rating: e.target.value })}
                          placeholder="e.g. E10+ - Everyone 10+"
                          className="input text-sm mt-0.5"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="block">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Players</span>
                          <input
                            type="number"
                            min={1}
                            value={itemDraft.players}
                            onChange={(e) => patchItemDraft({ players: e.target.value })}
                            placeholder="—"
                            inputMode="numeric"
                            className="input text-sm mt-0.5"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Co-op</span>
                          <select
                            value={itemDraft.coop}
                            onChange={(e) => patchItemDraft({ coop: e.target.value })}
                            className="input text-sm mt-0.5"
                          >
                            <option value="">—</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        </label>
                      </div>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Genres <span className="font-normal">(comma-separated)</span></span>
                        <input
                          type="text"
                          value={itemDraft.genres}
                          onChange={(e) => patchItemDraft({ genres: e.target.value })}
                          placeholder="e.g. Action, Platform"
                          className="input text-sm mt-0.5"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Developers <span className="font-normal">(comma-separated)</span></span>
                        <input
                          type="text"
                          value={itemDraft.developers}
                          onChange={(e) => patchItemDraft({ developers: e.target.value })}
                          placeholder="e.g. Sega"
                          className="input text-sm mt-0.5"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Publishers <span className="font-normal">(comma-separated)</span></span>
                        <input
                          type="text"
                          value={itemDraft.publishers}
                          onChange={(e) => patchItemDraft({ publishers: e.target.value })}
                          placeholder="e.g. Sega"
                          className="input text-sm mt-0.5"
                        />
                      </label>
                    </div>
                  </div>
                )}
                <div className="sm:col-span-2 border-t border-gray-200 dark:border-gray-700 pt-2.5 mt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Your details {subtype === 'game' ? '(the game itself, not a check-in)' : '(independent of check-ins)'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">My rating</span>
                      <ScorePicker value={itemDraft.rating} onChange={(v: number) => patchItemDraft({ rating: v })} />
                    </label>
                    {subtype === 'game' && (
                      <>
                        <label className="block">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Status</span>
                          <select
                            value={itemDraft.status}
                            onChange={(e) => patchItemDraft({ status: e.target.value })}
                            className="input text-sm mt-0.5"
                          >
                            <option value="">—</option>
                            <option value="completed">Completed</option>
                            <option value="in_progress">In progress</option>
                            <option value="started">Started</option>
                            <option value="dropped">Dropped</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total time played</span>
                          <div className="flex items-center gap-2 w-fit mt-0.5">
                            <input
                              type="number"
                              min="0"
                              max="10000"
                              value={itemDraft.time_hours}
                              onChange={(e) => patchItemDraft({ time_hours: e.target.value })}
                              placeholder="0"
                              inputMode="numeric"
                              className="input text-sm w-20"
                            />
                            <span className="text-xs text-gray-500">h</span>
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={itemDraft.time_minutes}
                              onChange={(e) => patchItemDraft({ time_minutes: e.target.value })}
                              placeholder="0"
                              inputMode="numeric"
                              className="input text-sm w-20"
                            />
                            <span className="text-xs text-gray-500">m</span>
                          </div>
                        </label>
                      </>
                    )}
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">My notes (Markdown)</span>
                      <textarea
                        value={itemDraft.notes}
                        onChange={(e) => patchItemDraft({ notes: e.target.value })}
                        rows={3}
                        placeholder="Your notes about this item…"
                        className="input text-sm mt-0.5 resize-y"
                      />
                    </label>
                  </div>
                </div>
                {subtype !== 'board_game' && (
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {config.apiName} ID
                      <span className="font-normal text-gray-400">
                        {' — '}
                        {subtype === 'game'
                          ? 'optional — sync finds the game by title when this is empty'
                          : `set this to enable syncing metadata from ${config.apiName}`}
                      </span>
                    </span>
                    <input
                      type="text"
                      value={itemDraft.external_id}
                      onChange={(e) => patchItemDraft({ external_id: e.target.value })}
                      placeholder={item.external_id ? item.external_id : `e.g. ${config.apiName} ID`}
                      className="input text-sm mt-0.5 font-mono text-xs"
                    />
                  </label>
                )}
              </div>
              {itemEditError && <p className="text-xs text-red-500 dark:text-red-400">{itemEditError}</p>}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  onClick={saveItemEdit}
                  disabled={savingItem}
                  className="btn-primary text-sm"
                >
                  {savingItem ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Check size={15} className="mr-1.5" />}
                  Save
                </button>
                <button onClick={cancelItemEdit} className="btn-secondary text-sm">
                  <X size={15} className="mr-1.5" />
                  Cancel
                </button>
                {config.apiName && (
                  <button
                    onClick={handleSyncMetadata}
                    disabled={syncing || savingItem}
                    className="btn-secondary text-sm"
                    title="Fetch the latest metadata from the provider and review the changes"
                  >
                    {syncing ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
                    Sync metadata from {config.apiName}
                  </button>
                )}
              </div>
              {syncError && <p className="text-xs text-amber-600 dark:text-amber-400">{syncError}</p>}
            </div>
          </>
        ) : (
          <>
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
                {subtype === 'game' && item.time_played_minutes != null && (
                  <span className="text-sm text-gray-500">
                    {formatTimePlayed(item.time_played_minutes)} played
                  </span>
                )}
                {subtype === 'game' && item.status != null && (
                  <span className="text-sm text-gray-500 capitalize">{item.status.replace('_', ' ')}</span>
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
              {/* Game metadata from TGDB (display-only; edited via provider sync) */}
              {subtype === 'game' && (item.overview || item.content_rating || item.players != null || item.coop || item.genres?.length || item.developers?.length || item.publishers?.length) && (
                <div className="mt-3 space-y-2">
                  {item.genres && item.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.genres.map((g) => (
                        <span key={g} className="px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 text-xs font-medium">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap text-sm text-gray-500 dark:text-gray-400">
                    {item.content_rating && (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                        {item.content_rating}
                      </span>
                    )}
                    {item.players != null && (
                      <span>{item.players} player{item.players > 1 ? 's' : ''}</span>
                    )}
                    {item.coop && item.coop.toLowerCase() !== 'no' && (
                      <span>Co-op</span>
                    )}
                    {item.platform && <span>{item.platform}</span>}
                  </div>
                  {(item.developers?.length || item.publishers?.length) && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                      {item.developers && item.developers.length > 0 && (
                        <p>Developed by {item.developers.join(', ')}</p>
                      )}
                      {item.publishers && item.publishers.length > 0 && (
                        <p>Published by {item.publishers.join(', ')}</p>
                      )}
                    </div>
                  )}
                  {item.overview && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{item.overview}</p>
                  )}
                </div>
              )}
              {item.notes && (
                <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                  <MarkdownNote note={item.notes} />
                </div>
              )}
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
          </>
        )}
      </div>

      {/* Metadata sync diff (shown in edit mode after a provider sync) */}
      {editingItem && syncDiff && syncDiff.length > 0 && (
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-primary-200 dark:border-primary-800/40 shadow-sm shadow-black/3 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Proposed changes from {config.apiName}
            </h2>
            <button
              onClick={acceptAllDiff}
              disabled={acceptingAll}
              className="btn-primary text-xs whitespace-nowrap"
            >
              {acceptingAll ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Check size={13} className="mr-1.5" />}
              Accept all
            </button>
          </div>
          <ul className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {syncDiff.map((row) => (
              <li key={row.field} className="px-4 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{METADATA_FIELD_LABELS[row.field]}</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 break-words">
                    <span className="text-gray-400 line-through">{diffValueText(row.current)}</span>
                    <span className="mx-1.5 text-gray-300 dark:text-gray-600">→</span>
                    <span className="font-medium">{diffValueText(row.proposed)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => rejectDiffField(row.field)}
                    disabled={acceptingAll || acceptingField !== null}
                    className="p-1.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40"
                    title="Reject this change"
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={() => acceptDiffField(row.field)}
                    disabled={acceptingAll || acceptingField !== null}
                    className="p-1.5 text-gray-300 hover:text-green-500 dark:text-gray-600 dark:hover:text-green-400 disabled:opacity-40"
                    title="Accept this change"
                  >
                    {acceptingField === row.field
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Check size={14} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          <div className="overflow-x-auto">
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
                          <div className="mt-1.5">
                            <CompanionChipInput
                              value={draft.companions}
                              onChange={(names) => patchDraft({ companions: names })}
                            />
                          </div>
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
                            onChange={(e) => patchDraft({ checkin_type: e.target.value as 'completed' | 'in_progress' | 'started' | 'dropped' })}
                            className="input text-xs"
                          >
                            <option value="completed">{CHECKIN_TYPE_LABELS.completed}</option>
                            <option value="in_progress">{CHECKIN_TYPE_LABELS.in_progress}</option>
                            <option value="started">{CHECKIN_TYPE_LABELS.started}</option>
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
                          {c.companions && c.companions.length > 0 && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                              with {c.companions.join(', ')}
                            </p>
                          )}
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
          </div>
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
