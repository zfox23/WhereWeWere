/**
 * Profile > Music > Lists, modelled on Profile > Places > Lists: an index of
 * the lists (rename, delete, create) that opens a ranked, sortable detail view
 * with drag-to-rank. Songs and albums mix in one list; the name opens the
 * album's details, where more can be added.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, List, Loader2 } from 'lucide-react';
import { ListsIndex } from '../../../client/src/components/lists/ListsShared';
import { RankedListView } from '../../../client/src/components/lists/RankedListView';
import type { RankedColumn, RankedSortOption } from '../../../client/src/components/lists/RankedListView';
import { music, albumArtUrl } from './api';
import { AlbumArt } from './AlbumArt';
import { AlbumLink } from './AlbumLink';
import { formatDay, formatDuration, joinArtists } from './format';
import { refreshMusicLists, useMusicLists } from './useMusicLists';
import type { ListItemWithStats, MusicList } from './types';

const getId = (i: ListItemWithStats) => i.id;
const getRank = (i: ListItemWithStats) => i.rank;
const compareByName = (a: ListItemWithStats, b: ListItemWithStats) => a.title.localeCompare(b.title);
const lastPlayed = (i: ListItemWithStats) => (i.last_played_at ? new Date(i.last_played_at).getTime() : -Infinity);

function compareBy(key: string, a: ListItemWithStats, b: ListItemWithStats): number {
  switch (key) {
    case 'rank': {
      if (a.rank == null && b.rank == null) return compareByName(a, b);
      if (a.rank == null) return 1; // unranked always sinks to the bottom
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    }
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

const dash = <span className="text-gray-300 dark:text-gray-600">—</span>;

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
  const [items, setItems] = useState<ListItemWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () =>
    music.listItems(list.id).then(setItems).catch(() => setItems([]));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .listItems(list.id)
      .then((data) => !cancelled && setItems(data))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [list.id]);

  const persistOrder = async (rankedIds: string[]) => {
    setSaving(true);
    try {
      await music.rankList(list.id, rankedIds);
      const rankById = new Map(rankedIds.map((id, idx) => [id, idx + 1]));
      setItems((prev) => prev.map((i) => ({ ...i, rank: rankById.get(i.id) ?? null })));
      void refreshMusicLists();
    } catch (err) {
      console.error('Failed to rank music list:', err);
      await load(); // re-sync so local state can't drift
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (item: ListItemWithStats) => {
    if (!window.confirm(`Remove "${item.title}" from "${list.name}"? The music itself is kept.`)) return;
    try {
      await music.removeFromList(list.id, item.id);
      await Promise.all([load(), refreshMusicLists()]); // the server closes any rank gap
    } catch (err) {
      console.error('Failed to remove from music list:', err);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
        >
          <ArrowLeft size={14} />
          Back to lists
        </button>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {list.name}
          {!loading && (
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        {saving && <Loader2 size={14} className="ml-auto animate-spin text-primary-500" />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">
          Nothing in this list yet. Open an album's details (click a cover or an album name) to add the album or its songs.
        </p>
      ) : (
        <RankedListView
          items={items}
          getId={getId}
          getRank={getRank}
          getLabel={(i) => i.title}
          columns={COLUMNS}
          renderCard={renderCard}
          sortOptions={SORT_OPTIONS}
          compareBy={compareBy}
          compareUnranked={compareByName}
          onReorder={persistOrder}
          onRemove={(item) => void handleRemove(item)}
        />
      )}
    </div>
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

const indexApi = {
  create: (name: string) => music.createList(name),
  rename: (id: string, name: string) => music.renameList(id, name),
  delete: (id: string) => music.deleteList(id),
};

export function MusicListsSection() {
  const { lists, loaded } = useMusicLists();
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const selectedList = useMemo(() => lists.find((l) => l.id === selectedListId) ?? null, [lists, selectedListId]);

  // A list that was deleted (here or elsewhere) can't stay open.
  useEffect(() => {
    if (loaded && selectedListId && !selectedList) setSelectedListId(null);
  }, [loaded, selectedListId, selectedList]);

  return (
    <section
      aria-label="Music lists"
      className="rounded-2xl border border-white/40 bg-white/60 p-4 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60"
    >
      {!loaded ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : selectedList ? (
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
        />
      )}
    </section>
  );
}
