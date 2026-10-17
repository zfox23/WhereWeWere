/**
 * Profile > Places > Lists — "Venue Lists" section (below the checkin lists).
 *
 * Venue lists hold venues themselves (e.g. "Favorite roller coasters"), unlike
 * checkin lists, which hold individual check-ins. Same two views as checkin
 * lists — an index and a sortable detail table with drag-to-rank — but backed
 * by /venues/lists and kept in separate state.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, X } from 'lucide-react';
import { venueLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import { useRankDrag } from './useRankDrag';
import { ListsIndex, RankBadge, UnrankedDropZone } from './ListsShared';
import type { VenueList, VenueListItem } from '../../../client/src/types';

type SortKey = 'rank' | 'venue' | 'category' | 'location' | 'rating' | 'checkins' | 'last_checkin';
type SortDir = 'asc' | 'desc';

const getVenueId = (i: VenueListItem) => i.venue_id;
const getVenueRank = (i: VenueListItem) => i.rank;
const compareByName = (a: VenueListItem, b: VenueListItem) => a.venue_name.localeCompare(b.venue_name);

const locationLabel = (i: VenueListItem) => [i.city, i.state].filter(Boolean).join(', ');
const lastCheckinTime = (i: VenueListItem) => (i.last_checkin_at ? new Date(i.last_checkin_at).getTime() : -Infinity);

function compareBy(key: SortKey, a: VenueListItem, b: VenueListItem): number {
  switch (key) {
    case 'rank': {
      if (a.rank == null && b.rank == null) return compareByName(a, b);
      if (a.rank == null) return 1; // unranked always sinks to the bottom
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    }
    case 'venue':
      return compareByName(a, b);
    case 'category':
      return (a.category_name ?? '').localeCompare(b.category_name ?? '');
    case 'location':
      return locationLabel(a).localeCompare(locationLabel(b));
    case 'rating':
      return (a.rating ?? -Infinity) - (b.rating ?? -Infinity);
    case 'checkins':
      return (a.checkin_count ?? 0) - (b.checkin_count ?? 0);
    case 'last_checkin': {
      const at = lastCheckinTime(a);
      const bt = lastCheckinTime(b);
      return at === bt ? 0 : at < bt ? -1 : 1;
    }
  }
}

function VenueListDetail({ list, onBack }: { list: VenueList; onBack: () => void }) {
  const [items, setItems] = useState<VenueListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    venueLists
      .items(list.id)
      .then((data) => {
        if (!cancelled) setItems(data as VenueListItem[]);
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
    // "Rank" sorts keep unranked items at the bottom in both directions.
    if (sortBy !== 'rank') return sorted;
    return [...sorted.filter((i) => i.rank != null), ...sorted.filter((i) => i.rank == null)];
  }, [items, sortBy, sortDir]);

  const canDrag = sortBy === 'rank';

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'rating' || key === 'checkins' || key === 'last_checkin' ? 'desc' : 'asc');
    }
  };

  const persistOrder = async (rankedIds: string[]) => {
    setSaving(true);
    try {
      await venueLists.reRank(list.id, rankedIds);
      const rankById = new Map(rankedIds.map((id, idx) => [id, idx + 1]));
      setItems((prev) => prev.map((i) => ({ ...i, rank: rankById.get(i.venue_id) ?? null })));
    } catch (err) {
      console.error('Failed to re-rank venue list:', err);
      // Re-sync from the server so local state can't drift.
      const fresh = await venueLists.items(list.id).catch(() => null);
      if (fresh) setItems(fresh as VenueListItem[]);
    } finally {
      setSaving(false);
    }
  };

  const rankDrag = useRankDrag({
    items,
    getId: getVenueId,
    getRank: getVenueRank,
    compareUnranked: compareByName,
    canDrag,
    persistOrder,
  });

  const handleRemoveFromList = async (item: VenueListItem) => {
    if (!window.confirm(`Remove "${item.venue_name}" from "${list.name}"? The venue itself is kept.`)) return;
    try {
      await venueLists.removeVenue(list.id, item.venue_id);
      // Ranks stay gap-free: closing the hole is a re-rank of the survivors.
      const remaining = items.filter((i) => i.venue_id !== item.venue_id);
      setItems(remaining);
      if (item.rank != null) {
        await persistOrder(
          remaining
            .filter((i) => i.rank != null)
            .sort((a, b) => (a.rank as number) - (b.rank as number))
            .map((i) => i.venue_id)
        );
      }
    } catch (err) {
      console.error('Failed to remove venue from list:', err);
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
              {items.length} venue{items.length !== 1 ? 's' : ''}
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
          No venues in this list yet. Add venues to lists from a venue's page.
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
                  {headerCell('category', 'Category')}
                  {headerCell('location', 'Location')}
                  {headerCell('rating', 'Rating')}
                  {headerCell('checkins', 'Check-ins')}
                  {headerCell('last_checkin', 'Last check-in')}
                  <th scope="col" className="py-2 pl-3 w-8" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr
                    key={item.venue_id}
                    draggable={canDrag}
                    onDragStart={(e) => rankDrag.onRowDragStart(e, item.venue_id)}
                    onDragEnd={rankDrag.onDragEnd}
                    onDragOver={(e) => rankDrag.onRowDragOver(e, item.venue_id)}
                    onDrop={(e) => rankDrag.onRowDrop(e, item.venue_id)}
                    className={[
                      'border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                      canDrag ? 'cursor-grab active:cursor-grabbing' : '',
                      rankDrag.dragId === item.venue_id ? 'opacity-40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                      rankDrag.dropIndicator(item.venue_id),
                    ].join(' ')}
                  >
                    {canDrag && (
                      <td className="py-2.5 pr-2">
                        <span className="inline-flex text-gray-300 dark:text-gray-600" title="Drag to rank" aria-hidden>
                          ⠿
                        </span>
                      </td>
                    )}
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
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">
                      {item.category_name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 max-w-[12rem] text-gray-600 dark:text-gray-300">
                      <span className="line-clamp-2">
                        {locationLabel(item) || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {item.rating != null && item.rating >= 1 ? (
                        <Stars value={item.rating} size={12} />
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{item.checkin_count}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {item.last_checkin_at ? (
                        formatDate(item.last_checkin_at, item.last_checkin_timezone)
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

export function VenueListsSection() {
  const [lists, setLists] = useState<VenueList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  const refresh = () => {
    venueLists
      .list()
      .then((data) => setLists(data as VenueList[]))
      .catch(() => setLists([]))
      .finally(() => setListsLoading(false));
  };

  useEffect(refresh, []);

  const summaries = useMemo(() => lists.map((l) => ({ ...l, item_count: l.items.length })), [lists]);
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
        <VenueListDetail list={selectedList} onBack={() => setSelectedListId(null)} />
      ) : (
        <ListsIndex
          lists={summaries}
          api={venueLists}
          itemNoun="venue"
          emptyText="No venue lists yet. Create one to collect venues like your favorite roller coasters."
          createLabel="New venue list name"
          onOpenList={setSelectedListId}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
