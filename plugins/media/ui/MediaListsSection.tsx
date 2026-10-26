/**
 * Profile > Media > Lists: an index of the lists (rename, delete, create) that
 * opens a ranked, sortable detail view with drag-to-rank, like the Places and
 * Music lists. The library's list filter (`?list=`) is separate and unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import {
  ListSectionShell, compareByRank, dash, useRankedList,
} from '../../../client/src/components/lists/RankedListDetail';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { RankableListDetail } from '../../../client/src/components/lists/RankableListDetail';
import type { Contender } from '../../../client/src/components/lists/RankByComparing';
import { useLists } from '../../../client/src/components/lists/useLists';
import Stars from '../../../client/src/components/Stars';
import { slugify } from '../../../client/src/utils/slugify';
import { MEDIA_SUBTYPES, detailPath, formatCheckinDate } from '../utils/media';
import { media } from './api';
import type { MediaList, MediaListItem } from './types';

const getId = (i: MediaListItem) => i.id;
const getRank = (i: MediaListItem) => i.rank;
const compareByTitle = (a: MediaListItem, b: MediaListItem) => a.title.localeCompare(b.title);
const byRank = compareByRank(getRank, compareByTitle);
const withRank = (i: MediaListItem, rank: number | null): MediaListItem => ({ ...i, rank });
const lastCheckin = (i: MediaListItem) => (i.last_checkin_at ? new Date(i.last_checkin_at).getTime() : -Infinity);
const href = (i: MediaListItem) => detailPath(i.media_type, i.id, slugify(i.title));

function compareBy(key: string, a: MediaListItem, b: MediaListItem): number {
  switch (key) {
    case 'rank':
      return byRank(a, b);
    case 'title':
      return compareByTitle(a, b);
    case 'type':
      return a.media_type.localeCompare(b.media_type);
    case 'creator':
      return (a.author ?? '').localeCompare(b.author ?? '');
    case 'year':
      return (a.release_year ?? -Infinity) - (b.release_year ?? -Infinity);
    case 'rating':
      return (a.rating ?? -Infinity) - (b.rating ?? -Infinity);
    case 'checkins':
      return a.checkin_count - b.checkin_count;
    case 'last': {
      const x = lastCheckin(a);
      const y = lastCheckin(b);
      return x === y ? 0 : x < y ? -1 : 1;
    }
    default:
      return 0;
  }
}

const SORT_OPTIONS: RankedSortOption[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'title', label: 'Title', defaultDir: 'asc' },
  { key: 'type', label: 'Type', defaultDir: 'asc' },
  { key: 'creator', label: 'Author', defaultDir: 'asc' },
  { key: 'year', label: 'Year', defaultDir: 'desc' },
  { key: 'rating', label: 'Rating', defaultDir: 'desc' },
  { key: 'checkins', label: 'Check-ins', defaultDir: 'desc' },
  { key: 'last', label: 'Last check-in', defaultDir: 'desc' },
];

const COLUMNS: RankedColumn<MediaListItem>[] = [
  {
    key: 'title',
    label: 'Title',
    className: 'max-w-[18rem]',
    render: (i) => (
      <Link to={href(i)} className="font-medium text-gray-800 transition-colors hover:text-primary-600 dark:text-gray-200 dark:hover:text-primary-400 line-clamp-2">
        {i.title}
      </Link>
    ),
  },
  { key: 'type', label: 'Type', render: (i) => MEDIA_SUBTYPES[i.media_type]?.label ?? i.media_type },
  { key: 'creator', label: 'Author', className: 'max-w-[12rem] text-gray-600 dark:text-gray-300', render: (i) => <span className="line-clamp-2">{i.author || dash}</span> },
  { key: 'year', label: 'Year', className: 'tabular-nums text-gray-600 dark:text-gray-300', render: (i) => i.release_year ?? dash },
  { key: 'rating', label: 'Rating', render: (i) => (i.rating != null && i.rating > 0 ? <Stars value={i.rating} size={12} /> : dash) },
  { key: 'checkins', label: 'Check-ins', className: 'tabular-nums text-gray-600 dark:text-gray-300', render: (i) => i.checkin_count },
  {
    key: 'last',
    label: 'Last check-in',
    className: 'whitespace-nowrap text-gray-600 dark:text-gray-300',
    render: (i) => (i.last_checkin_at ? formatCheckinDate(i.last_checkin_at, i.last_checkin_timezone) : dash),
  },
];

const renderCard = (i: MediaListItem) => (
  <>
    <Link to={href(i)} className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
      {i.title}
    </Link>
    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
      {[MEDIA_SUBTYPES[i.media_type]?.label, i.author, i.release_year].filter(Boolean).join(' · ')}
    </p>
    {i.rating != null && i.rating > 0 && (
      <div className="mt-0.5">
        <Stars value={i.rating} size={12} />
      </div>
    )}
  </>
);

const renderContender = (item: MediaListItem): Contender => ({
  media: item.image_url ? <img src={item.image_url} alt="" className="aspect-[2/3] max-h-72 w-full object-cover" /> : undefined,
  badge: (
    <span className="rounded-full bg-pink-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600 dark:bg-pink-900/30 dark:text-pink-300">
      {MEDIA_SUBTYPES[item.media_type]?.label ?? item.media_type}
    </span>
  ),
  body: (
    <>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">{[item.author, item.release_year].filter(Boolean).join(' · ')}</p>
      {item.rating != null && item.rating > 0 && (
        <div className="mt-1">
          <Stars value={item.rating} size={14} />
        </div>
      )}
    </>
  ),
});

function MediaListDetail({ list, onBack, onChanged }: { list: MediaList; onBack: () => void; onChanged: () => void }) {
  const state = useRankedList<MediaListItem>({
    listId: list.id,
    api: { items: media.listItems, reRank: media.rankList },
    getId,
    withRank,
    onChanged,
  });
  return (
    <RankableListDetail
      list={list}
      onBack={onBack}
      state={state}
      itemNoun="item"
      emptyText="Nothing in this list yet. Add items to lists from an item's page."
      getId={getId}
      getRank={getRank}
      getLabel={(i) => i.title}
      columns={COLUMNS}
      renderCard={renderCard}
      sortOptions={SORT_OPTIONS}
      compareBy={compareBy}
      compareUnranked={compareByTitle}
      removeMessage={(i) => `Remove "${i.title}" from "${list.name}"? The item itself is kept.`}
      onRemove={(i) => media.removeItemFromList(list.id, i.id)}
      rankApi={media}
      getSubtitle={(i) => [i.author, i.release_year].filter(Boolean).join(' · ')}
      renderContender={renderContender}
    />
  );
}

const listFromLocation = (): string | null => new URLSearchParams(window.location.search).get('mediaList');

const indexApi = {
  create: (name: string) => media.createList(name),
  rename: (id: string, name: string) => media.renameList(id, name),
  delete: (id: string) => media.deleteList(id),
};

export function MediaListsSection() {
  const { lists, loading, refresh } = useLists<MediaList>(media.lists);
  const [selectedListId, setSelectedListId] = useState<string | null>(listFromLocation);
  const selectedList = useMemo(() => lists.find((l) => l.id === selectedListId) ?? null, [lists, selectedListId]);
  const summaries = useMemo(() => lists.map((l) => ({ ...l, item_count: l.items.length })), [lists]);

  // The open list lives in the URL (`mediaList`), so a link or the back button can open one.
  useEffect(() => {
    const sync = () => setSelectedListId(listFromLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get('mediaList') ?? null) === selectedListId) return;
    if (selectedListId) url.searchParams.set('mediaList', selectedListId);
    else url.searchParams.delete('mediaList');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedListId]);

  // A list that was deleted (here or elsewhere) can't stay open.
  useEffect(() => {
    if (!loading && selectedListId && !selectedList) setSelectedListId(null);
  }, [loading, selectedListId, selectedList]);

  return (
    <ListSectionShell label="Media lists" loading={loading}>
      {selectedList ? (
        <MediaListDetail list={selectedList} onBack={() => setSelectedListId(null)} onChanged={refresh} />
      ) : (
        <ListsIndex
          lists={summaries}
          api={indexApi}
          itemNoun="item"
          emptyText="No lists yet. Create one here, or add items to a list from an item's page."
          createLabel="New list name"
          onOpenList={setSelectedListId}
          onRefresh={refresh}
        />
      )}
    </ListSectionShell>
  );
}
