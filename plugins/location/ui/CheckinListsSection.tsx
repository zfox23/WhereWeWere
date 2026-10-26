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
import { ListSectionShell, compareByRank, useRankedList } from '../../../client/src/components/lists/RankedListDetail';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { RankableListDetail } from '../../../client/src/components/lists/RankableListDetail';
import type { Contender } from '../../../client/src/components/lists/RankByComparing';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import { useLists } from '../../../client/src/components/lists/useLists';
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
const byRank = compareByRank(getCheckinRank, compareNewestFirst);
const withRank = (i: CheckinListItem, rank: number | null): CheckinListItem => ({ ...i, rank });

function compareBy(key: string, a: CheckinListItem, b: CheckinListItem): number {
  switch (key) {
    case 'rank':
      return byRank(a, b);
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

const renderCheckinContender = (item: CheckinListItem): Contender => ({
  body: (
    <>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.venue_name || 'Unknown Venue'}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {[formatDate(item.checked_in_at, item.venue_timezone), item.companions.join(', ')].filter(Boolean).join(' · ')}
      </p>
      {item.rating != null && item.rating >= 1 && (
        <div className="mt-1">
          <Stars value={item.rating} size={14} />
        </div>
      )}
      {item.notes && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{commentsPreview(item.notes)}</p>}
    </>
  ),
});

function CheckinListDetail({ list, onBack }: { list: CheckinList; onBack: () => void }) {
  const state = useRankedList<CheckinListItem>({ listId: list.id, api: checkinLists, getId: getCheckinId, withRank });
  return (
    <RankableListDetail
      list={list}
      onBack={onBack}
      state={state}
      itemNoun="check-in"
      emptyText="No check-ins in this list yet. Add check-ins to lists from the check-in form."
      getId={getCheckinId}
      getRank={getCheckinRank}
      getLabel={(i) => i.venue_name || 'Unknown Venue'}
      columns={CHECKIN_COLUMNS}
      renderCard={renderCheckinCard}
      sortOptions={CHECKIN_SORT_OPTIONS}
      compareBy={compareBy}
      compareUnranked={compareNewestFirst}
      removeMessage={(i) => `Remove "${i.venue_name}" from "${list.name}"? The check-in itself is kept.`}
      onRemove={(i) => checkinLists.removeCheckin(list.id, i.checkin_id)}
      rankApi={checkinLists}
      getSubtitle={(i) => formatDate(i.checked_in_at, i.venue_timezone)}
      renderContender={renderCheckinContender}
    />
  );
}

// ---------------------------------------------------------------------------
// Section (index + detail switch)
// ---------------------------------------------------------------------------

export function CheckinListsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lists, loading: listsLoading, refresh } = useLists<CheckinList>(checkinLists.list as () => Promise<CheckinList[]>);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

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
    <ListSectionShell loading={listsLoading}>
      {selectedList ? (
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
    </ListSectionShell>
  );
}
