import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Loader2, Pencil, Search, Trash2, X } from 'lucide-react';
import { media } from './api';
import Stars from '../../../client/src/components/Stars';
import {
  MEDIA_SUBTYPES,
  MEDIA_SUBTYPE_LIST,
  CHECKIN_TYPE_LABELS,
  formatCheckinDate,
  formatTimePlayed,
} from '../utils/media';
import { slugify } from '../../../client/src/utils/slugify';
import type { MediaLibraryItem, MediaList } from './types';
import type { MediaSubtype } from '../../../client/src/types';

const BADGE_CLASSES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700/90 dark:bg-green-900/90 dark:text-green-300',
  in_progress: 'bg-amber-100 text-amber-700/90 dark:bg-amber-900/90 dark:text-amber-300',
  started: 'bg-amber-100 text-amber-700/90 dark:bg-amber-900/90 dark:text-amber-300',
  dropped: 'bg-red-100 text-red-700/90 dark:bg-red-900/90 dark:text-red-300',
};

function getSelectedTypesFromLocation(): MediaSubtype[] {
  const param = new URLSearchParams(window.location.search).get('mediaTypes');
  if (!param) return MEDIA_SUBTYPE_LIST;
  const parsed = param
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is MediaSubtype => (MEDIA_SUBTYPES as Record<string, unknown>)[t] !== undefined);
  return parsed.length > 0 ? parsed : MEDIA_SUBTYPE_LIST;
}

interface LibraryUrlState {
  selectedTypes: MediaSubtype[];
  sortBy: SortKey;
  sortDir: SortDir;
  filterQuery: string;
  selectedListId: string | null;
}

/** Read the library's filter state from the URL, falling back to defaults. */
function getLibraryStateFromLocation(): LibraryUrlState {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort');
  const dir = params.get('dir');
  return {
    selectedTypes: getSelectedTypesFromLocation(),
    sortBy: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortKey) : DEFAULT_SORT,
    sortDir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_DIR,
    filterQuery: params.get('q') ?? '',
    selectedListId: params.get('list'),
  };
}

interface MediaLibrarySectionProps {
  from: string;
  to: string;
}

type SortKey = 'rating' | 'checkin' | 'completed' | 'time_played' | 'list';
type SortDir = 'asc' | 'desc';

const DEFAULT_SORT: SortKey = 'checkin';
const DEFAULT_DIR: SortDir = 'desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'checkin', label: 'Last check-in' },
  { value: 'rating', label: 'Rating' },
  { value: 'completed', label: 'Completed count' },
  { value: 'time_played', label: 'Time played' },
  { value: 'list', label: 'Time added' },
];

function sortValue(item: MediaLibraryItem, key: SortKey, addedAtById?: Map<string, string>): number {
  switch (key) {
    case 'rating':
      return item.latest_rating ?? -Infinity;
    case 'checkin':
      return item.last_checkin_at ? new Date(item.last_checkin_at).getTime() : -Infinity;
    case 'completed':
      return item.completed_count ?? 0;
    case 'time_played':
      return item.time_played_minutes ?? 0;
    case 'list':
      return addedAtById?.get(item.id) ? new Date(addedAtById.get(item.id)!).getTime() : -Infinity;
  }
}

export function MediaLibrarySection({ from, to }: MediaLibrarySectionProps) {
  const [initialState] = useState<LibraryUrlState>(getLibraryStateFromLocation);
  const [selectedTypes, setSelectedTypes] = useState<MediaSubtype[]>(initialState.selectedTypes);
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>(initialState.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initialState.sortDir);
  const [filterQuery, setFilterQuery] = useState(initialState.filterQuery);
  const [lists, setLists] = useState<MediaList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(initialState.selectedListId);

  // Batch edit mode: select multiple cards (shift-click for a range) and delete them.
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ items: number; checkins: number } | null>(null);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) ?? null,
    [lists, selectedListId]
  );

  const selectedListIds = useMemo(
    () => (selectedList ? new Set(selectedList.items.map((i) => i.id)) : null),
    [selectedList]
  );

  const selectedListAddedAt = useMemo(
    () => (selectedList ? new Map(selectedList.items.map((i) => [i.id, i.added_at])) : undefined),
    [selectedList]
  );

  // "Time added to this list" only makes sense with a list selected; fall back
  // to the default sort if the list is cleared while that option is active.
  useEffect(() => {
    if (sortBy === 'list' && !selectedListId) setSortBy('checkin');
  }, [sortBy, selectedListId]);

  // "Time played" only applies to games. Selecting it forces the type filter
  // to games (in the sort dropdown below); if games are filtered out again via
  // the type chips, fall back to the default sort.
  useEffect(() => {
    if (sortBy === 'time_played' && !selectedTypes.includes('game')) setSortBy('checkin');
  }, [sortBy, selectedTypes]);

  const activeTypes = useMemo(
    () => MEDIA_SUBTYPE_LIST.filter((t) => selectedTypes.includes(t)),
    [selectedTypes]
  );

  const toggleType = (type: MediaSubtype) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Keep state in sync when the URL changes (back/forward navigation).
  useEffect(() => {
    const syncFromLocation = () => {
      const next = getLibraryStateFromLocation();
      setSelectedTypes(next.selectedTypes);
      setSortBy(next.sortBy);
      setSortDir(next.sortDir);
      setFilterQuery(next.filterQuery);
      setSelectedListId(next.selectedListId);
    };
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  // Persist the library's filter state to the URL (matching the tab's
  // replaceState pattern) so the view deep-links and the back button restores
  // it. Only non-default values are written to keep the URL short.
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    const setOrDelete = (key: string, value: string, isDefault: boolean) => {
      if (isDefault) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      } else if (url.searchParams.get(key) !== value) {
        url.searchParams.set(key, value);
        changed = true;
      }
    };
    setOrDelete(
      'mediaTypes',
      selectedTypes.join(','),
      selectedTypes.length === MEDIA_SUBTYPE_LIST.length,
    );
    setOrDelete('list', selectedListId ?? '', selectedListId === null);
    setOrDelete('q', filterQuery, filterQuery === '');
    setOrDelete('sort', sortBy, sortBy === DEFAULT_SORT);
    setOrDelete('dir', sortDir, sortDir === DEFAULT_DIR);

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [selectedTypes, selectedListId, filterQuery, sortBy, sortDir]);

  // A deep link may reference a list that has since been deleted.
  useEffect(() => {
    if (selectedListId && lists.length > 0 && !lists.some((l) => l.id === selectedListId)) {
      setSelectedListId(null);
    }
  }, [lists, selectedListId]);

  useEffect(() => {
    media
      .lists()
      .then(setLists)
      .catch((err) => {
        console.error('Failed to load media lists:', err);
        setLists([]);
      });
  }, []);

  const handleRemoveFromList = async (item: MediaLibraryItem) => {
    if (!selectedList) return;
    if (!window.confirm(`Remove "${item.title}" from "${selectedList.name}"?`)) return;
    try {
      await media.removeItemFromList(selectedList.id, item.id);
      setLists((prev) =>
        prev.map((l) =>
          l.id === selectedList.id
            ? { ...l, items: l.items.filter((i) => i.id !== item.id) }
            : l
        )
      );
    } catch (err) {
      console.error('Failed to remove item from list:', err);
    }
  };

  const handleDeleteList = async () => {
    if (!selectedList) return;
    if (!window.confirm(`Delete list "${selectedList.name}"? Items in your library are kept.`)) return;
    try {
      await media.deleteList(selectedList.id);
      setLists((prev) => prev.filter((l) => l.id !== selectedList.id));
      setSelectedListId(null);
    } catch (err) {
      console.error('Failed to delete list:', err);
    }
  };

  const visibleItems = useMemo(() => {
    let filtered = selectedListIds
      ? items.filter((item) => selectedListIds.has(item.id))
      : items;
    const query = filterQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((item) => {
        const haystack = [
          item.title,
          item.author,
          MEDIA_SUBTYPES[item.media_type]?.label,
          MEDIA_SUBTYPES[item.media_type]?.plural,
          item.last_checkin_type ? CHECKIN_TYPE_LABELS[item.last_checkin_type] : 'no check-ins',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const va = sortValue(a, sortBy, selectedListAddedAt);
      const vb = sortValue(b, sortBy, selectedListAddedAt);
      // Both null ratings compare equal (avoid Infinity - Infinity = NaN).
      if (va === vb) {
        const ta = a.last_checkin_at ? new Date(a.last_checkin_at).getTime() : 0;
        const tb = b.last_checkin_at ? new Date(b.last_checkin_at).getTime() : 0;
        if (tb - ta !== 0) return tb - ta;
        return a.title.localeCompare(b.title);
      }
      const diff = va - vb;
      return sortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [items, filterQuery, sortBy, sortDir, selectedListIds, selectedListAddedAt]);

  const toggleDirection = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  // --- Batch edit mode ---------------------------------------------------------

  const toggleEditMode = () => {
    const next = !editMode;
    setEditMode(next);
    if (!next) {
      setSelectedIds(new Set());
      setAnchorIndex(null);
      setDeleteError(null);
      setConfirmState(null);
    }
  };

  /** Normal click toggles one card; shift-click selects the range from the anchor. */
  const handleSelect = (index: number, shiftKey: boolean) => {
    const current = visibleItems[index];
    if (!current) return;
    if (shiftKey) {
      const base = anchorIndex ?? 0;
      const [lo, hi] = base < index ? [base, index] : [index, base];
      setSelectedIds(new Set(visibleItems.slice(lo, hi + 1).map((i) => i.id)));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(current.id)) next.delete(current.id);
      else next.add(current.id);
      return next;
    });
    setAnchorIndex(index);
  };

  // Drop selections for cards that are no longer visible (filter/sort/list change, deletion).
  useEffect(() => {
    if (!editMode) return;
    setSelectedIds((prev) => {
      const visible = new Set(visibleItems.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [editMode, visibleItems]);

  /** Ask the server how much would be deleted, then show the confirmation dialog. */
  const requestDelete = async () => {
    if (selectedIds.size === 0 || previewing) return;
    setPreviewing(true);
    setDeleteError(null);
    try {
      const preview = await media.bulkDeleteItems([...selectedIds], true);
      setConfirmState({ items: preview.deleted_items, checkins: preview.deleted_checkins });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to load deletion preview');
    } finally {
      setPreviewing(false);
    }
  };

  const cancelDelete = () => {
    if (deleting) return;
    setConfirmState(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const ids = [...selectedIds];
      await media.bulkDeleteItems(ids, false);
      const deleted = new Set(ids);
      setItems((prev) => prev.filter((i) => !deleted.has(i.id)));
      // Refresh lists so memberships reflect the deletion.
      media.lists().then(setLists).catch(() => { /* keep stale list data */ });
      setSelectedIds(new Set());
      setAnchorIndex(null);
      setConfirmState(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete items');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (activeTypes.length === 0) {
      setItems([]);
      setLoading(false);
      setInitialLoaded(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    media
      .library(from || undefined, to || undefined, activeTypes)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
      })
      .catch((err) => {
        console.error('Failed to load media library:', err);
        if (cancelled) return;
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, activeTypes]);

  if (!initialLoaded) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="animate-spin text-primary-600" size={24} />
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1">
          {editMode && (
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" aria-live="polite">
              {selectedIds.size} selected
            </span>
          )}
          <select
            value={selectedListId ?? ''}
            onChange={(e) => setSelectedListId(e.target.value || null)}
            aria-label="Filter by list"
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Media Library</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
          {selectedList && (
            <button
              type="button"
              onClick={handleDeleteList}
              aria-label={`Delete list ${selectedList.name}`}
              title={`Delete list "${selectedList.name}"`}
              className="p-1.5 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {editMode ? (
            <>
              {deleteError && !confirmState && (
                <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-[140px]" title={deleteError}>
                  {deleteError}
                </span>
              )}
              <button
                type="button"
                onClick={requestDelete}
                disabled={selectedIds.size === 0 || previewing || deleting}
                aria-label={`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? '' : 's'}`}
                title={`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? '' : 's'}`}
                className="p-1.5 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {deleting || previewing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
              <button
                type="button"
                onClick={toggleEditMode}
                aria-label="Done editing"
                title="Done"
                className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={toggleEditMode}
              aria-label="Edit mode: select items for batch operations"
              title="Select items for batch operations"
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:text-gray-400 dark:hover:text-primary-400 dark:hover:bg-primary-900/20 transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter media library"
              className="w-24 sm:w-36 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-6 pr-2 py-1 text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => {
              const next = e.target.value as SortKey;
              setSortBy(next);
              // Time played is a games-only metric: narrow the library to games.
              if (next === 'time_played') setSelectedTypes(['game']);
            }}
            aria-label="Sort library by"
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {SORT_OPTIONS.map((opt) => {
              return (
                <option key={opt.value} value={opt.value} disabled={opt.value === "list" && !selectedListId}>
                  {opt.label}
                </option>
              )
            })}
          </select>
          <button
            type="button"
            onClick={toggleDirection}
            aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
            title={sortDir === 'asc' ? 'Currently ascending — click for descending' : 'Currently descending — click for ascending'}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>
      </div>

      {/* Media type filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MEDIA_SUBTYPE_LIST.map((type) => {
          const config = MEDIA_SUBTYPES[type];
          const active = selectedTypes.includes(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${active
                ? 'bg-primary-500 border-primary-500 text-white'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
            >
              {config.plural}
            </button>
          );
        })}
      </div>

      {activeTypes.length === 0 ? (
        <p className="text-sm text-gray-400">Select at least one media type to view.</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-gray-400">
          {items.length > 0 && filterQuery.trim()
            ? `No media matching "${filterQuery.trim()}".`
            : selectedList
              ? `No media from "${selectedList.name}" checked in during this period.`
              : from || to
                ? 'No media checked in during this period.'
                : 'No media in your library.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {visibleItems.map((item, index) => {
            const config = MEDIA_SUBTYPES[item.media_type] || MEDIA_SUBTYPES.movie;
            const href = `${config.detailBase}/${item.id}/${item.title ? slugify(item.title) : ''}`;
            // Carry the library's current filter URL in navigation state so
            // the detail page's back button can deep-link straight back to
            // this view. The URL-sync effect above keeps it current.
            const origin = new URL(window.location.href);
            const fromState = { mediaFrom: `${origin.pathname}${origin.search}` };
            const isSelected = selectedIds.has(item.id);
            const timePlayed = item.media_type === 'game' && item.time_played_minutes != null ? formatTimePlayed(item.time_played_minutes) : null;
            const cardClasses = `group bg-white/70 dark:bg-gray-900/70 rounded-lg border shadow-sm shadow-black/3 transition-shadow ${editMode
              ? isSelected
                ? 'border-transparent ring-2 ring-primary-500'
                : 'border-white/40 dark:border-gray-700/40 hover:ring-2 hover:ring-primary-300'
              : 'border-white/40 dark:border-gray-700/40 hover:ring-2 hover:ring-primary-400'
            }`;
            const cardBody = (
              <>
                <div className="relative">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt=""
                      className="w-full aspect-[2/3] object-cover rounded-t-lg shadow-sm"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl">
                      {config.icon}
                    </div>
                  )}
                  <span
                    className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${item.last_checkin_type
                      ? BADGE_CLASSES[item.last_checkin_type] || BADGE_CLASSES.completed
                      : 'bg-gray-100 text-gray-500/90 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                  >
                    {item.last_checkin_type === 'completed' && item.completed_count > 1
                      ? `${CHECKIN_TYPE_LABELS.completed} ${item.completed_count}x`
                      : item.last_checkin_type
                        ? CHECKIN_TYPE_LABELS[item.last_checkin_type] || item.last_checkin_type
                        : 'No check-ins'}
                  </span>
                  {editMode ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => { /* selection handled in onClick */ }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelect(index, e.shiftKey);
                      }}
                      aria-label={`Select ${item.title}`}
                      title="Click to toggle, shift-click to select a range"
                      className="absolute top-2 left-2 z-10 h-5 w-5 cursor-pointer rounded accent-primary-600 bg-white/90 dark:bg-gray-900/80"
                    />
                  ) : selectedList ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleRemoveFromList(item);
                      }}
                      aria-label={`Remove from ${selectedList.name}`}
                      title={`Remove from "${selectedList.name}"`}
                      className="absolute top-2 left-2 p-1 rounded-full bg-black/50 text-white hover:bg-red-600/90 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <div className="p-2.5 flex grow flex-col items-between">
                  <p className={`text-xs font-semibold leading-tight line-clamp-2 ${editMode
                    ? isSelected
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-800 dark:text-gray-200'
                    : 'text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400'
                    }`}
                  >
                    {item.title}
                  </p>
                  {item.author && (
                    <p className="text-[11px] text-gray-400 truncate">{item.author}</p>
                  )}
                  {timePlayed && (
                    <p className="text-[11px] text-gray-400 truncate">{timePlayed} played</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-1">
                    {item.latest_rating != null && item.latest_rating > 0 ? (
                      <Stars value={item.latest_rating} size={11} />
                    ) : (
                      <span />
                    )}
                  </div>
                  {item.last_checkin_at && (
                    <p className="mt-1 text-[11px] text-gray-400 truncate" title={formatCheckinDate(item.last_checkin_at, item.last_checkin_timezone)}>
                      {formatCheckinDate(item.last_checkin_at, item.last_checkin_timezone)}
                    </p>
                  )}
                </div>
              </>
            );
            return editMode ? (
              <div
                key={item.id}
                role="button"
                aria-label={item.title}
                aria-pressed={isSelected}
                tabIndex={0}
                onClick={(e) => handleSelect(index, e.shiftKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(index, e.shiftKey);
                  }
                }}
                className={`${cardClasses} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
              >
                {cardBody}
              </div>
            ) : (
              <Link
                key={item.id}
                to={href}
                state={fromState}
                className={cardClasses}
              >
                {cardBody}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bulk delete confirmation */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={cancelDelete} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-sm p-5 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Delete {confirmState.items} {confirmState.items === 1 ? 'media item' : 'media items'}?
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This will permanently delete {confirmState.items}{' '}
              {confirmState.items === 1 ? 'media item' : 'media items'} and{' '}
              {confirmState.checkins} {confirmState.checkins === 1 ? 'check-in' : 'check-ins'}.
              The selected items will also be removed from any lists they belong to.
              This cannot be undone.
            </p>
            {deleteError && <p className="text-xs text-red-500 dark:text-red-400">{deleteError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={cancelDelete} disabled={deleting} className="btn-secondary text-sm">
                <X size={15} className="mr-1.5" />
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting} className="btn-danger text-sm">
                {deleting
                  ? <Loader2 size={15} className="mr-1.5 animate-spin" />
                  : <Trash2 size={15} className="mr-1.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
