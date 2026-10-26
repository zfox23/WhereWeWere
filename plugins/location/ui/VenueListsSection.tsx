/**
 * Profile > Places > Lists — "Venue Lists" section (below the checkin lists).
 *
 * Venue lists hold venues themselves (e.g. "Favorite roller coasters"), unlike
 * checkin lists, which hold individual check-ins. Same two views as checkin
 * lists — an index and a sortable detail table with drag-to-rank — but backed
 * by /venues/lists and kept in separate state.
 */

import { useEffect, useMemo, useState } from 'react';
import { venueLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import { ListSectionShell, compareByRank, dash, useRankedList } from '../../../client/src/components/lists/RankedListDetail';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { RankableListDetail } from '../../../client/src/components/lists/RankableListDetail';
import type { Contender } from '../../../client/src/components/lists/RankByComparing';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import { useLists } from '../../../client/src/components/lists/useLists';
import type { VenueList, VenueListItem } from '../../../client/src/types';

const getVenueId = (i: VenueListItem) => i.venue_id;
const getVenueRank = (i: VenueListItem) => i.rank;
const compareByName = (a: VenueListItem, b: VenueListItem) => a.venue_name.localeCompare(b.venue_name);
const byRank = compareByRank(getVenueRank, compareByName);
const withRank = (i: VenueListItem, rank: number | null): VenueListItem => ({ ...i, rank });

const locationLabel = (i: VenueListItem) => [i.city, i.state].filter(Boolean).join(', ');
const lastCheckinTime = (i: VenueListItem) => (i.last_checkin_at ? new Date(i.last_checkin_at).getTime() : -Infinity);

function compareBy(key: string, a: VenueListItem, b: VenueListItem): number {
  switch (key) {
    case 'rank':
      return byRank(a, b);
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

const renderVenueContender = (item: VenueListItem): Contender => ({
  body: (
    <>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.venue_name || 'Unknown Venue'}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {[item.category_name, locationLabel(item)].filter(Boolean).join(' · ') || '—'}
      </p>
      {item.rating != null && item.rating >= 1 && (
        <div className="mt-1">
          <Stars value={item.rating} size={14} />
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {item.checkin_count} check-in{item.checkin_count === 1 ? '' : 's'}
      </p>
    </>
  ),
});

function VenueListDetail({ list, onBack }: { list: VenueList; onBack: () => void }) {
  const state = useRankedList<VenueListItem>({ listId: list.id, api: venueLists, getId: getVenueId, withRank });
  return (
    <RankableListDetail
      list={list}
      onBack={onBack}
      state={state}
      itemNoun="venue"
      emptyText="No venues in this list yet. Add venues to lists from a venue's page."
      getId={getVenueId}
      getRank={getVenueRank}
      getLabel={(i) => i.venue_name || 'Unknown Venue'}
      columns={VENUE_COLUMNS}
      renderCard={renderVenueCard}
      sortOptions={VENUE_SORT_OPTIONS}
      compareBy={compareBy}
      compareUnranked={compareByName}
      removeMessage={(i) => `Remove "${i.venue_name}" from "${list.name}"? The venue itself is kept.`}
      onRemove={(i) => venueLists.removeVenue(list.id, i.venue_id)}
      rankApi={venueLists}
      getSubtitle={(i) => [i.category_name, locationLabel(i)].filter(Boolean).join(' · ')}
      renderContender={renderVenueContender}
    />
  );
}

export function VenueListsSection() {
  const { lists, loading: listsLoading, refresh } = useLists<VenueList>(venueLists.list as () => Promise<VenueList[]>);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  const summaries = useMemo(() => lists.map((l) => ({ ...l, item_count: l.items.length })), [lists]);
  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) ?? null,
    [lists, selectedListId]
  );

  return (
    <ListSectionShell loading={listsLoading}>
      {selectedList ? (
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
    </ListSectionShell>
  );
}
