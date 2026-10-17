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
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, X } from 'lucide-react';
import { useRankDrag } from './useRankDrag';
import { ListsIndex, RankBadge, UnrankedDropZone } from './ListsShared';
import { checkinLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import type { CheckinList, CheckinListItem } from '../../../client/src/types';

type SortKey = 'rank' | 'venue' | 'date' | 'companions' | 'rating' | 'comments';
type SortDir = 'asc' | 'desc';

const COMMENTS_PREVIEW_LEN = 80;

function commentsPreview(notes: string | null): string {
  const flat = (notes ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > COMMENTS_PREVIEW_LEN ? `${flat.slice(0, COMMENTS_PREVIEW_LEN)}…` : flat;
}

const getCheckinId = (i: CheckinListItem) => i.checkin_id;
const getCheckinRank = (i: CheckinListItem) => i.rank;
const compareNewestFirst = (a: CheckinListItem, b: CheckinListItem) =>
  new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime();

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

  const rankDrag = useRankDrag({
    items,
    getId: getCheckinId,
    getRank: getCheckinRank,
    compareUnranked: compareNewestFirst,
    canDrag,
    persistOrder,
  });

  const handleRemoveFromList = async (item: CheckinListItem) => {
    if (!window.confirm(`Remove "${item.venue_name}" from "${list.name}"? The check-in itself is kept.`)) return;
    try {
      await checkinLists.removeCheckin(list.id, item.checkin_id);
      setItems((prev) => prev.filter((i) => i.checkin_id !== item.checkin_id));
    } catch (err) {
      console.error('Failed to remove check-in from list:', err);
    }
  };

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
                  {canDrag && <th scope="col" className="py-2 pr-2 w-8" aria-label="Drag handle" />}
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
                    onDragStart={(e) => rankDrag.onRowDragStart(e, item.checkin_id)}
                    onDragEnd={rankDrag.onDragEnd}
                    onDragOver={(e) => rankDrag.onRowDragOver(e, item.checkin_id)}
                    onDrop={(e) => rankDrag.onRowDrop(e, item.checkin_id)}
                    className={[
                      'border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                      canDrag ? 'cursor-grab active:cursor-grabbing' : '',
                      rankDrag.dragId === item.checkin_id ? 'opacity-40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                      rankDrag.dropIndicator(item.checkin_id),
                    ].join(' ')}
                  >
                    {canDrag &&
                      <td className="py-2.5 pr-2">
                        <span
                          className="inline-flex text-gray-300 dark:text-gray-600"
                          title={canDrag ? 'Drag to rank' : 'Sort by Rank to drag-reorder'}
                          aria-hidden
                        >
                          ⠿
                        </span>
                      </td>}
                    <td className="py-2.5 pr-3 tabular-nums w-12">
                      <RankBadge rank={item.rank} />
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
            <UnrankedDropZone
              active={rankDrag.unrankedZoneActive}
              count={rankDrag.unranked.length}
              onDragOver={rankDrag.onUnrankedDragOver}
              onDragLeave={rankDrag.onUnrankedDragLeave}
              onDrop={rankDrag.onUnrankedDrop}
            />
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
      {listsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : selectedList ? (
        <CheckinListDetail list={selectedList} onBack={() => setSelectedListId(null)} />
      ) : (
        <ListsIndex
          lists={lists}
          api={checkinLists}
          itemNoun="check-in"
          emptyText="No checkin lists yet. Create one to collect events like concerts or shows in one place."
          createLabel="New checkin list name"
          onOpenList={setSelectedListId}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
