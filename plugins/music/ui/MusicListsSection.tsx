/**
 * Profile > Music > Lists, modelled on Profile > Places > Lists: an index of
 * the lists (rename, delete, create) that opens a ranked, sortable detail view
 * with drag-to-rank. Songs and albums mix in one list; the name opens the
 * album's details, where more can be added.
 */

import { useEffect, useMemo, useState } from 'react';
import { List, Swords } from 'lucide-react';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import { ListSectionShell, RankedListDetail, compareByRank, dash, useRankedList } from '../../../client/src/components/lists/RankedListDetail';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { music, albumArtUrl } from './api';
import { AlbumArt } from './AlbumArt';
import { AlbumLink } from './AlbumLink';
import { RankByComparing } from './RankByComparing';
import { formatDay, formatDuration, joinArtists } from './format';
import { refreshMusicLists, useMusicLists } from './useMusicLists';
import type { ListItemWithStats, MusicList } from './types';

const getId = (i: ListItemWithStats) => i.id;
const getRank = (i: ListItemWithStats) => i.rank;
const compareByName = (a: ListItemWithStats, b: ListItemWithStats) => a.title.localeCompare(b.title);
const byRank = compareByRank(getRank, compareByName);
const lastPlayed = (i: ListItemWithStats) => (i.last_played_at ? new Date(i.last_played_at).getTime() : -Infinity);

function compareBy(key: string, a: ListItemWithStats, b: ListItemWithStats): number {
  switch (key) {
    case 'rank':
      return byRank(a, b);
    case 'name':
      return compareByName(a, b);
    case 'artist':
      return joinArtists(a.artists).localeCompare(joinArtists(b.artists));
    case 'type':
      return a.kind.localeCompare(b.kind);
    case 'plays':
      return a.plays - b.plays;
    case 'time':
      return a.listened_seconds - b.listened_seconds;
    case 'last': {
      const x = lastPlayed(a);
      const y = lastPlayed(b);
      return x === y ? 0 : x < y ? -1 : 1;
    }
    default:
      return 0;
  }
}

const SORT_OPTIONS: RankedSortOption[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'name', label: 'Name', defaultDir: 'asc' },
  { key: 'artist', label: 'Artist', defaultDir: 'asc' },
  { key: 'type', label: 'Type', defaultDir: 'asc' },
  { key: 'plays', label: 'Plays', defaultDir: 'desc' },
  { key: 'time', label: 'Listening time', defaultDir: 'desc' },
  { key: 'last', label: 'Last played', defaultDir: 'desc' },
];

const TypeBadge = ({ kind }: { kind: 'song' | 'album' }) => (
  <span className="rounded-full bg-pink-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600 dark:bg-pink-900/30 dark:text-pink-300">
    {kind}
  </span>
);

const COLUMNS: RankedColumn<ListItemWithStats>[] = [
  {
    key: 'name',
    label: 'Name',
    className: 'max-w-[18rem]',
    render: (item) => (
      <span className="flex items-center gap-2">
        <AlbumArt artId={item.art_id} albumRef={item.album_ref} size={32} />
        <span className="min-w-0 font-medium text-gray-800 dark:text-gray-200 line-clamp-2">
          <AlbumLink albumRef={item.album_ref}>{item.title}</AlbumLink>
        </span>
      </span>
    ),
  },
  { key: 'artist', label: 'Artist', className: 'max-w-[12rem] text-gray-600 dark:text-gray-300', render: (i) => <span className="line-clamp-2">{joinArtists(i.artists) || dash}</span> },
  { key: 'album', label: 'Album', className: 'max-w-[12rem] text-gray-600 dark:text-gray-300', render: (i) => (i.kind === 'song' ? i.album ?? dash : dash) },
  { key: 'type', label: 'Type', render: (i) => <TypeBadge kind={i.kind} /> },
  { key: 'plays', label: 'Plays', className: 'tabular-nums text-gray-600 dark:text-gray-300', render: (i) => i.plays },
  { key: 'time', label: 'Time', className: 'whitespace-nowrap tabular-nums text-gray-600 dark:text-gray-300', render: (i) => (i.listened_seconds ? formatDuration(i.listened_seconds) : dash) },
  { key: 'last', label: 'Last played', className: 'whitespace-nowrap text-gray-600 dark:text-gray-300', render: (i) => (i.last_played_at ? formatDay(i.last_played_at) : dash) },
];

const renderCard = (item: ListItemWithStats) => (
  <div className="flex items-center gap-2">
    <AlbumArt artId={item.art_id} albumRef={item.album_ref} size={36} />
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          <AlbumLink albumRef={item.album_ref}>{item.title}</AlbumLink>
        </span>
        <TypeBadge kind={item.kind} />
      </div>
      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
        {[joinArtists(item.artists), item.kind === 'song' ? item.album : null, `${item.plays} play${item.plays === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
      </p>
    </div>
  </div>
);

function ListDetail({ list, onBack }: { list: MusicList; onBack: () => void }) {
  const state = useRankedList<ListItemWithStats>({
    listId: list.id,
    api: { items: music.listItems, reRank: music.rankList },
    getId,
    withRank: (i, rank) => ({ ...i, rank }),
    onChanged: () => void refreshMusicLists(),
  });
  const [ranking, setRanking] = useState(false);
  const [paused, setPaused] = useState(false);

  // Is there a paused "rank by comparing" session to resume?
  const checkPaused = () => music.rankSession(list.id).then((s) => setPaused(s.state.answers.length > 0)).catch(() => setPaused(false));
  useEffect(() => {
    void checkPaused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  if (ranking) {
    return (
      <RankByComparing
        list={list}
        items={state.items}
        onDone={(applied) => {
          setRanking(false);
          void checkPaused();
          if (applied) void Promise.all([state.reload(), refreshMusicLists()]);
        }}
      />
    );
  }

  return (
    <RankedListDetail
      list={list}
      onBack={onBack}
      state={state}
      itemNoun="item"
      emptyText="Nothing in this list yet. Open an album's details (click a cover or an album name) to add the album or its songs."
      getId={getId}
      getRank={getRank}
      getLabel={(i) => i.title}
      columns={COLUMNS}
      renderCard={renderCard}
      sortOptions={SORT_OPTIONS}
      compareBy={compareBy}
      compareUnranked={compareByName}
      removeMessage={(i) => `Remove "${i.title}" from "${list.name}"? The music itself is kept.`}
      onRemove={(i) => music.removeFromList(list.id, i.id)}
      headerActions={
        <button
          type="button"
          onClick={() => setRanking(true)}
          disabled={state.loading || state.items.length < 2}
          title={state.items.length < 2 ? 'Add at least two items to rank them' : 'Pick between two at a time to rank the whole list'}
          className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs disabled:opacity-40"
        >
          <Swords size={13} />
          {paused ? 'Resume ranking' : 'Rank by comparing'}
        </button>
      }
    />
  );
}

/** Up to four covers in a 2x2 mosaic, or the plain list icon when there are none. */
function Mosaic({ covers }: { covers: string[] }) {
  if (covers.length === 0) return <List size={16} className="shrink-0 text-primary-500" />;
  return (
    <span className="grid h-9 w-9 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-md bg-gray-200 dark:bg-gray-700" aria-hidden="true">
      {covers.slice(0, 4).map((id) => (
        <img key={id} src={albumArtUrl(id)} alt="" loading="lazy" className="h-full w-full object-cover" />
      ))}
    </span>
  );
}

const listFromLocation = (): string | null => new URLSearchParams(window.location.search).get('musicList');

const indexApi = {
  create: (name: string) => music.createList(name),
  rename: (id: string, name: string) => music.renameList(id, name),
  delete: (id: string) => music.deleteList(id),
};

export function MusicListsSection() {
  const { lists, loaded } = useMusicLists();
  const [selectedListId, setSelectedListId] = useState<string | null>(listFromLocation);
  const selectedList = useMemo(() => lists.find((l) => l.id === selectedListId) ?? null, [lists, selectedListId]);

  // The open list lives in the URL (`musicList`), so a link or the back button can open one.
  useEffect(() => {
    const sync = () => setSelectedListId(listFromLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get('musicList') ?? null) === selectedListId) return;
    if (selectedListId) url.searchParams.set('musicList', selectedListId);
    else url.searchParams.delete('musicList');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedListId]);

  // A list that was deleted (here or elsewhere) can't stay open.
  useEffect(() => {
    if (loaded && selectedListId && !selectedList) setSelectedListId(null);
  }, [loaded, selectedListId, selectedList]);

  return (
    <ListSectionShell label="Music lists" loading={!loaded}>
      {selectedList ? (
        <ListDetail list={selectedList} onBack={() => setSelectedListId(null)} />
      ) : (
        <ListsIndex
          lists={lists}
          api={indexApi}
          itemNoun="item"
          emptyText="No lists yet. Create one here, or add songs and albums from an album's details (click a cover or an album name)."
          createLabel="New list name"
          onOpenList={setSelectedListId}
          onRefresh={() => void refreshMusicLists()}
          renderLeading={(l) => <Mosaic covers={(l as MusicList).covers ?? []} />}
          showCreated
        />
      )}
    </ListSectionShell>
  );
}
