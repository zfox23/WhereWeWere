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
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RankedListView } from './RankedListView';
import type { RankedColumn, RankedSortOption } from './RankedListView';
import { ListsIndex } from './ListsShared';
import { checkinLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import type { CheckinList, CheckinListItem } from '../../../client/src/types';

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

function compareBy(key: string, a: CheckinListItem, b: CheckinListItem): number {
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
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Index view
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

const CHECKIN_SORT_OPTIONS: RankedSortOption[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'venue', label: 'Venue name', defaultDir: 'asc' },
  { key: 'date', label: 'Check-in date & time', defaultDir: 'desc' },
  { key: 'companions', label: 'Companions', defaultDir: 'asc' },
  { key: 'rating', label: 'Rating', defaultDir: 'desc' },
  { key: 'comments', label: 'Comments', defaultDir: 'asc' },
];

const RatingOrDash = ({ rating }: { rating: number | null }) =>
  rating != null && rating >= 1 ? (
    <Stars value={rating} size={12} />
  ) : (
    <span className="text-gray-300 dark:text-gray-600">—</span>
  );

const CHECKIN_COLUMNS: RankedColumn<CheckinListItem>[] = [
  {
    key: 'venue',
    label: 'Venue name',
    className: 'max-w-[16rem]',
    render: (item) => (
      <>
        <a
          href={`/venues/${item.venue_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
        >
          {item.venue_name || 'Unknown Venue'}
        </a>
        {item.parent_venue_name && <p className="text-xs text-gray-400 truncate">{item.parent_venue_name}</p>}
      </>
    ),
  },
  {
    key: 'date',
    label: 'Check-in date & time',
    className: 'whitespace-nowrap',
    render: (item) => (
      <a
        href={`/location-checkins/${item.checkin_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        {formatDate(item.checked_in_at, item.venue_timezone)}
      </a>
    ),
  },
  {
    key: 'companions',
    label: 'Companions',
    className: 'max-w-[12rem] text-gray-600 dark:text-gray-300',
    render: (item) => (
      <span className="line-clamp-2">{item.companions.length > 0 ? item.companions.join(', ') : '—'}</span>
    ),
  },
  { key: 'rating', label: 'Rating', render: (item) => <RatingOrDash rating={item.rating} /> },
  {
    key: 'comments',
    label: 'Comments',
    className: 'max-w-[18rem]',
    render: (item) =>
      item.notes ? (
        <span className="block text-gray-500 dark:text-gray-400 line-clamp-2" title={item.notes}>
          {commentsPreview(item.notes)}
        </span>
      ) : (
        <span className="text-gray-300 dark:text-gray-600">—</span>
      ),
  },
];

const renderCheckinCard = (item: CheckinListItem) => (
  <>
    <a
      href={`/venues/${item.venue_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
    >
      {item.venue_name || 'Unknown Venue'}
    </a>
    <a
      href={`/location-checkins/${item.checkin_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-xs text-gray-500 dark:text-gray-400 truncate"
    >
      {[formatDate(item.checked_in_at, item.venue_timezone), item.companions.join(', ')].filter(Boolean).join(' · ')}
    </a>
    {item.rating != null && item.rating >= 1 && (
      <div className="mt-0.5">
        <Stars value={item.rating} size={12} />
      </div>
    )}
  </>
);

function CheckinListDetail({
  list,
  onBack,
}: {
  list: CheckinList;
  onBack: () => void;
}) {
  const [items, setItems] = useState<CheckinListItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">
          No check-ins in this list yet. Add check-ins to lists from the check-in form.
        </p>
      ) : (
        <RankedListView
          items={items}
          getId={getCheckinId}
          getRank={getCheckinRank}
          getLabel={(i) => i.venue_name || 'Unknown Venue'}
          columns={CHECKIN_COLUMNS}
          renderCard={renderCheckinCard}
          sortOptions={CHECKIN_SORT_OPTIONS}
          compareBy={compareBy}
          compareUnranked={compareNewestFirst}
          onReorder={persistOrder}
          onRemove={(item) => void handleRemoveFromList(item)}
        />
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
