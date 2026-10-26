/**
 * Profile > Places > Lists — "Venue Lists" section (below the checkin lists).
 *
 * Venue lists hold venues themselves (e.g. "Favorite roller coasters"), unlike
 * checkin lists, which hold individual check-ins. Same two views as checkin
 * lists — an index and a sortable detail table with drag-to-rank — but backed
 * by /venues/lists and kept in separate state.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { venueLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import { RankedListView } from '../../../client/src/components/lists/RankedListView';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import type { VenueList, VenueListItem } from '../../../client/src/types';

const getVenueId = (i: VenueListItem) => i.venue_id;
const getVenueRank = (i: VenueListItem) => i.rank;
const compareByName = (a: VenueListItem, b: VenueListItem) => a.venue_name.localeCompare(b.venue_name);

const locationLabel = (i: VenueListItem) => [i.city, i.state].filter(Boolean).join(', ');
const lastCheckinTime = (i: VenueListItem) => (i.last_checkin_at ? new Date(i.last_checkin_at).getTime() : -Infinity);

function compareBy(key: string, a: VenueListItem, b: VenueListItem): number {
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
    default:
      return 0;
  }
}

const VENUE_SORT_OPTIONS: RankedSortOption[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'venue', label: 'Venue name', defaultDir: 'asc' },
  { key: 'category', label: 'Category', defaultDir: 'asc' },
  { key: 'location', label: 'Location', defaultDir: 'asc' },
  { key: 'rating', label: 'Rating', defaultDir: 'desc' },
  { key: 'checkins', label: 'Check-ins', defaultDir: 'desc' },
  { key: 'last_checkin', label: 'Last check-in', defaultDir: 'desc' },
];

const dash = <span className="text-gray-300 dark:text-gray-600">—</span>;

const VENUE_COLUMNS: RankedColumn<VenueListItem>[] = [
  {
    key: 'venue',
    label: 'Venue name',
    className: 'max-w-[16rem]',
    render: (item) => (
      <a
        href={`/venues/${item.venue_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
      >
        {item.venue_name || 'Unknown Venue'}
      </a>
    ),
  },
  {
    key: 'category',
    label: 'Category',
    className: 'text-gray-600 dark:text-gray-300',
    render: (item) => item.category_name ?? dash,
  },
  {
    key: 'location',
    label: 'Location',
    className: 'max-w-[12rem] text-gray-600 dark:text-gray-300',
    render: (item) => <span className="line-clamp-2">{locationLabel(item) || dash}</span>,
  },
  {
    key: 'rating',
    label: 'Rating',
    render: (item) => (item.rating != null && item.rating >= 1 ? <Stars value={item.rating} size={12} /> : dash),
  },
  {
    key: 'checkins',
    label: 'Check-ins',
    className: 'tabular-nums text-gray-600 dark:text-gray-300',
    render: (item) => item.checkin_count,
  },
  {
    key: 'last_checkin',
    label: 'Last check-in',
    className: 'whitespace-nowrap text-gray-600 dark:text-gray-300',
    render: (item) =>
      item.last_checkin_at ? formatDate(item.last_checkin_at, item.last_checkin_timezone) : dash,
  },
];

const renderVenueCard = (item: VenueListItem) => (
  <>
    <a
      href={`/venues/${item.venue_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
    >
      {item.venue_name || 'Unknown Venue'}
    </a>
    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
      {[item.category_name, locationLabel(item)].filter(Boolean).join(' · ') || '—'}
    </p>
    {item.rating != null && item.rating >= 1 && (
      <div className="mt-0.5">
        <Stars value={item.rating} size={12} />
      </div>
    )}
  </>
);

function VenueListDetail({ list, onBack }: { list: VenueList; onBack: () => void }) {
  const [items, setItems] = useState<VenueListItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">
          No venues in this list yet. Add venues to lists from a venue's page.
        </p>
      ) : (
        <RankedListView
          items={items}
          getId={getVenueId}
          getRank={getVenueRank}
          getLabel={(i) => i.venue_name || 'Unknown Venue'}
          columns={VENUE_COLUMNS}
          renderCard={renderVenueCard}
          sortOptions={VENUE_SORT_OPTIONS}
          compareBy={compareBy}
          compareUnranked={compareByName}
          onReorder={persistOrder}
          onRemove={(item) => void handleRemoveFromList(item)}
        />
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
