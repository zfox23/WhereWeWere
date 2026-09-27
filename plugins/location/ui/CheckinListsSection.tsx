/**
 * Profile > Places — "Checkin Lists" section (above the "All Venues" library).
 *
 * Two views:
 *  1. Index — every checkin list the user created (name, item count, updated
 *     date) with rename / delete / create.
 *  2. Detail — a sortable table of the list's check-ins (venue name, date &
 *     time, companions, rating, comments preview, rank) with manual ranking:
 *     when sorted by Rank, rows can be dragged to reorder (ranked block) or
 *     dragged into the "Unranked" drop zone at the bottom to clear a rank.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  List,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { checkinLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import type { CheckinList, CheckinListItem } from '../../../client/src/types';

type SortKey = 'rank' | 'venue' | 'date' | 'companions' | 'rating' | 'comments';
type SortDir = 'asc' | 'desc';

type DropTarget =
  | { type: 'row'; id: string; pos: 'before' | 'after' }
  | { type: 'unranked' };

const COMMENTS_PREVIEW_LEN = 80;

function commentsPreview(notes: string | null): string {
  const flat = (notes ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > COMMENTS_PREVIEW_LEN ? `${flat.slice(0, COMMENTS_PREVIEW_LEN)}…` : flat;
}

function compareBy(key: SortKey, a: CheckinListItem, b: CheckinListItem): number {
  switch (key) {
    case 'rank': {
      const ar = a.rank;
      const br = b.rank;
      if (ar == null && br == null) {
        return new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime();
      }
      if (ar == null) return 1; // unranked always sinks to the bottom
      if (br == null) return -1;
      return ar - br;
    }
    case 'venue':
      return (a.venue_name ?? '').localeCompare(b.venue_name ?? '');
    case 'date':
      return new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime();
    case 'companions':
      return (a.companions.join(', ') || '').localeCompare(b.companions.join(', ') || '');
    case 'rating': {
      const ar = a.rating ?? -Infinity;
      const br = b.rating ?? -Infinity;
      return ar - br;
    }
    case 'comments':
      return (a.notes ?? '').localeCompare(b.notes ?? '');
  }
}

// ---------------------------------------------------------------------------
// Index view
// ---------------------------------------------------------------------------

function CheckinListsIndex({
  lists,
  onOpenList,
  onRefresh,
}: {
  lists: CheckinList[];
  onOpenList: (id: string) => void;
  onRefresh: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      await checkinLists.create(name);
      setNewName('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (list: CheckinList) => {
    const name = renameValue.trim();
    if (!name || name === list.name) {
      setRenamingId(null);
      return;
    }
    try {
      await checkinLists.rename(list.id, name);
      setRenamingId(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename list.');
    }
  };

  const handleDelete = async (list: CheckinList) => {
    if (!window.confirm(`Delete list "${list.name}"? Its check-ins are kept; only the list membership is removed.`)) return;
    try {
      await checkinLists.delete(list.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete list.');
    }
  };

  return (
    <div>
      {/* Create */}
      <div className="flex items-center gap-1.5 mb-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="New list name (e.g. Concerts, Broadway)…"
          aria-label="New checkin list name"
          className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 text-sm font-medium text-white transition-colors"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {lists.length === 0 ? (
        <p className="text-sm text-gray-400">
          No checkin lists yet. Create one to collect events like concerts or shows in one place.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2.5 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
            >
              <List size={16} className="text-primary-500 shrink-0" />
              {renamingId === list.id ? (
                <input
                  type="text"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void handleRename(list)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleRename(list);
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  aria-label={`Rename list ${list.name}`}
                  className="flex-1 min-w-0 text-sm bg-transparent border border-primary-300 dark:border-primary-600 rounded-md px-1.5 py-0.5 text-gray-800 dark:text-gray-100 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenList(list.id)}
                  className="flex-1 min-w-0 text-left group"
                  title={`Open ${list.name}`}
                >
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {list.name}
                  </span>
                  <span className="block text-xs text-gray-400">
                    {list.item_count ?? 0} check-in{(list.item_count ?? 0) !== 1 ? 's' : ''}
                    {list.updated_at
                      ? ` · updated ${formatDate(list.updated_at)}`
                      : ''}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRenamingId(list.id);
                  setRenameValue(list.name);
                }}
                className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Rename list"
                aria-label={`Rename ${list.name}`}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(list)}
                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Delete list"
                aria-label={`Delete ${list.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function CheckinListDetail({
  list,
  onBack,
}: {
  list: CheckinList;
  onBack: () => void;
}) {
  const [items, setItems] = useState<CheckinListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    checkinLists
      .items(list.id)
      .then((data) => {
        if (!cancelled) setItems(data as CheckinListItem[]);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [list.id]);

  const ranked = useMemo(
    () =>
      items
        .filter((i) => i.rank != null)
        .sort((a, b) => (a.rank as number) - (b.rank as number)),
    [items]
  );
  const unranked = useMemo(
    () =>
      items
        .filter((i) => i.rank == null)
        .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime()),
    [items]
  );

  const visibleItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const cmp = compareBy(sortBy, a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // "Rank" sorts keep unranked items at the bottom in both directions;
    // every other column sorts the whole table uniformly.
    if (sortBy !== 'rank') return sorted;
    return [...sorted.filter((i) => i.rank != null), ...sorted.filter((i) => i.rank == null)];
  }, [items, sortBy, sortDir]);

  const canDrag = sortBy === 'rank';

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'venue' || key === 'comments' || key === 'companions' || key === 'rank' ? 'asc' : 'desc');
    }
  };

  const headerCell = (key: SortKey, label: string, extraClass = '') => (
    <th
      scope="col"
      aria-sort={sortBy === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`py-2 pr-3 font-semibold ${extraClass}`}
    >
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        {label}
        {sortBy === key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  /**
   * Apply a drag drop: rebuild the ranked order, then persist via the
   * bulk re-rank endpoint (which clears every other rank in the list).
   */
  const applyDrop = async (target: DropTarget, draggedId: string) => {
    if (target.type === 'unranked') {
      // Drop into the unranked zone = clear the rank.
      const nextRanked = ranked.filter((i) => i.checkin_id !== draggedId);
      if (nextRanked.length === ranked.length) return; // already unranked
      await persistOrder(nextRanked.map((i) => i.checkin_id));
      return;
    }

    const targetRow = items.find((i) => i.checkin_id === target.id);
    if (!targetRow || targetRow.checkin_id === draggedId) return;

    // Base ordering: the current ranked block. Dropping onto an unranked row
    // means "append to the end of the ranked block".
    const base = ranked.filter((i) => i.checkin_id !== draggedId);
    let insertAt: number;
    if (targetRow.rank == null) {
      insertAt = base.length;
    } else {
      const idx = base.findIndex((i) => i.checkin_id === targetRow.checkin_id);
      insertAt = target.pos === 'before' ? idx : idx + 1;
    }
    const dragged = items.find((i) => i.checkin_id === draggedId);
    if (!dragged) return;

    const nextRankedIds = base.map((i) => i.checkin_id);
    nextRankedIds.splice(Math.max(0, Math.min(insertAt, nextRankedIds.length)), 0, draggedId);

    // No-op when the order didn't actually change.
    const currentRankedIds = ranked.map((i) => i.checkin_id);
    if (nextRankedIds.length === currentRankedIds.length &&
        nextRankedIds.every((v, i) => v === currentRankedIds[i])) {
      return;
    }
    await persistOrder(nextRankedIds);
  };

  const persistOrder = async (rankedIds: string[]) => {
    setSaving(true);
    try {
      await checkinLists.reRank(list.id, rankedIds);
      const rankById = new Map(rankedIds.map((id, idx) => [id, idx + 1]));
      setItems((prev) =>
        prev.map((i) => ({ ...i, rank: rankById.get(i.checkin_id) ?? null }))
      );
    } catch (err) {
      console.error('Failed to re-rank list:', err);
      // Re-sync from the server so local state can't drift.
      const fresh = await checkinLists.items(list.id).catch(() => null);
      if (fresh) setItems(fresh as CheckinListItem[]);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFromList = async (item: CheckinListItem) => {
    if (!window.confirm(`Remove "${item.venue_name}" from "${list.name}"? The check-in itself is kept.`)) return;
    try {
      await checkinLists.removeCheckin(list.id, item.checkin_id);
      setItems((prev) => prev.filter((i) => i.checkin_id !== item.checkin_id));
    } catch (err) {
      console.error('Failed to remove check-in from list:', err);
    }
  };

  const onRowDragOver = (e: React.DragEvent, item: CheckinListItem) => {
    if (!dragId || !canDrag || item.checkin_id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget((prev) =>
      prev && prev.type === 'row' && prev.id === item.checkin_id && prev.pos === pos ? prev : { type: 'row', id: item.checkin_id, pos }
    );
  };

  const onDrop = async (e: React.DragEvent, target: DropTarget) => {
    e.preventDefault();
    const id = dragId ?? (e.dataTransfer.getData('text/plain') || null);
    setDropTarget(null);
    setDragId(null);
    if (!id) return;
    await applyDrop(target, id);
  };

  const dropIndicator = (item: CheckinListItem) => {
    if (!dropTarget || dropTarget.type !== 'row' || dropTarget.id !== item.checkin_id || !dragId) return null;
    return dropTarget.pos === 'before' ? 'border-t-2 border-t-primary-500' : 'border-b-2 border-b-primary-500';
  };

  const unrankedZoneActive = dropTarget?.type === 'unranked' && !!dragId;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to lists
        </button>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {list.name}
          {!loading && (
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              {items.length} check-in{items.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        {saving && <Loader2 size={14} className="animate-spin text-primary-500 ml-auto" />}
      </div>

      {canDrag && !saving && (
        <p className="text-xs text-gray-400 mb-2">
          Drag rows to rank them; drop a row into the unranked zone below to clear its rank.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-gray-400">
          No check-ins in this list yet. Add check-ins to lists from the check-in form.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th scope="col" className="py-2 pr-2 w-8" aria-label="Drag handle" />
                  {headerCell('rank', 'Rank', 'pl-0')}
                  {headerCell('venue', 'Venue name')}
                  {headerCell('date', 'Check-in date & time')}
                  {headerCell('companions', 'Companions')}
                  {headerCell('rating', 'Rating')}
                  {headerCell('comments', 'Comments')}
                  <th scope="col" className="py-2 pl-3 w-8" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr
                    key={item.checkin_id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.checkin_id);
                      setDragId(item.checkin_id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => onRowDragOver(e, item)}
                    onDrop={(e) => {
                      const pos =
                        dropTarget && dropTarget.type === 'row' && dropTarget.id === item.checkin_id
                          ? dropTarget.pos
                          : 'after';
                      void onDrop(e, { type: 'row', id: item.checkin_id, pos });
                    }}
                    className={[
                      'border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                      canDrag ? 'cursor-grab active:cursor-grabbing' : '',
                      dragId === item.checkin_id ? 'opacity-40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                      dropIndicator(item),
                    ].join(' ')}
                  >
                    <td className="py-2.5 pr-2">
                      <span
                        className="inline-flex text-gray-300 dark:text-gray-600"
                        title={canDrag ? 'Drag to rank' : 'Sort by Rank to drag-reorder'}
                        aria-hidden
                      >
                        ⠿
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums w-12">
                      {item.rank != null ? (
                        <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded-md bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-bold">
                          {item.rank}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 max-w-[16rem]">
                      <a
                        href={`/venues/${item.venue_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
                      >
                        {item.venue_name || 'Unknown Venue'}
                      </a>
                      {item.parent_venue_name && (
                        <p className="text-xs text-gray-400 truncate">{item.parent_venue_name}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <a
                        href={`/location-checkins/${item.checkin_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      >
                        {formatDate(item.checked_in_at, item.venue_timezone)}
                      </a>
                    </td>
                    <td className="py-2.5 pr-3 max-w-[12rem] text-gray-600 dark:text-gray-300">
                      <span className="line-clamp-2">
                        {item.companions.length > 0 ? item.companions.join(', ') : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {item.rating != null && item.rating >= 1 ? (
                        <Stars value={item.rating} size={12} />
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 max-w-[18rem]">
                      {item.notes ? (
                        <span
                          className="block text-gray-500 dark:text-gray-400 line-clamp-2"
                          title={item.notes}
                        >
                          {commentsPreview(item.notes)}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRemoveFromList(item)}
                        className="p-1 rounded-md text-gray-300 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                        title="Remove from this list"
                        aria-label={`Remove ${item.venue_name} from ${list.name}`}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Unranked drop zone (visible only while ranking by Rank sort) */}
          {canDrag && (
            <div
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget({ type: 'unranked' });
              }}
              onDragLeave={() => setDropTarget((prev) => (prev?.type === 'unranked' ? null : prev))}
              onDrop={(e) => void onDrop(e, { type: 'unranked' })}
              className={[
                'mt-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm text-center transition-colors',
                unrankedZoneActive
                  ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400',
              ].join(' ')}
            >
              {unrankedZoneActive ? 'Drop here to remove the rank' : 'Unranked'}
              {unranked.length > 0 && !unrankedZoneActive && (
                <span className="ml-1 text-xs">({unranked.length})</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section (index + detail switch)
// ---------------------------------------------------------------------------

export function CheckinListsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lists, setLists] = useState<CheckinList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  const refresh = () => {
    checkinLists
      .list()
      .then((data) => setLists(data as CheckinList[]))
      .catch(() => setLists([]))
      .finally(() => setListsLoading(false));
  };

  useEffect(refresh, []);

  // Deep link: ?checkinList=<id> opens that list's detail (e.g. from a
  // check-in detail page). Consumed once the list is loaded, and cleared
  // from the URL when leaving the detail view.
  useEffect(() => {
    const listParam = searchParams.get('checkinList');
    if (!listParam || listsLoading) return;
    if (!lists.some((l) => l.id === listParam)) return;
    setSelectedListId(listParam);
    const next = new URLSearchParams(searchParams);
    next.delete('checkinList');
    setSearchParams(next, { replace: true });
  }, [lists, listsLoading, searchParams, setSearchParams]);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) ?? null,
    [lists, selectedListId]
  );

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Checkin Lists
      </h2>

      {listsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : selectedList ? (
        <CheckinListDetail list={selectedList} onBack={() => setSelectedListId(null)} />
      ) : (
        <CheckinListsIndex
          lists={lists}
          onOpenList={setSelectedListId}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
