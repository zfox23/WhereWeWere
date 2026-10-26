/**
 * Profile > Music > Lists: the user's lists of songs and albums. Songs and
 * albums open the album modal, where more can be added to a list.
 */

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ListMusic, Pencil, Plus, Trash2, X } from 'lucide-react';
import { music } from './api';
import { AlbumArt } from './AlbumArt';
import { AlbumLink } from './AlbumLink';
import { joinArtists } from './format';
import { refreshMusicLists, useMusicLists } from './useMusicLists';
import type { ListItem, MusicList } from './types';

const CARD =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4';

function ItemRow({
  item,
  first,
  last,
  onMove,
  onRemove,
}: {
  item: ListItem;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5" data-kind={item.kind}>
      <AlbumArt artId={item.art_id} albumRef={item.album_ref} size={32} />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
            <AlbumLink albumRef={item.album_ref}>{item.title}</AlbumLink>
          </span>
          <span className="shrink-0 rounded-full bg-pink-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600 dark:bg-pink-900/30 dark:text-pink-300">
            {item.kind}
          </span>
        </div>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {joinArtists(item.artists)}
          {item.kind === 'song' && item.album ? ` · ${item.album}` : ''}
        </p>
      </div>
      <button type="button" aria-label={`Move ${item.title} up`} disabled={first} onClick={() => onMove(-1)} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">
        <ArrowUp size={14} />
      </button>
      <button type="button" aria-label={`Move ${item.title} down`} disabled={last} onClick={() => onMove(1)} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">
        <ArrowDown size={14} />
      </button>
      <button type="button" aria-label={`Remove ${item.title} from the list`} onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500">
        <X size={14} />
      </button>
    </li>
  );
}

export function MusicListsSection() {
  const { lists, loaded } = useMusicLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected: MusicList | undefined = lists.find((l) => l.id === selectedId) ?? lists[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const attempt = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await refreshMusicLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    void attempt(async () => {
      const list = await music.createList(newName.trim());
      setSelectedId(list.id);
      setNewName('');
    });
  };

  const move = (list: MusicList, index: number, dir: -1 | 1) => {
    const ids = list.items.map((i) => i.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    void attempt(() => music.reorderList(list.id, ids));
  };

  return (
    <section className={CARD} aria-label="Music lists">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        <ListMusic size={16} className="text-pink-500" />
        Lists
      </h3>

      <div className="flex flex-wrap items-center gap-1.5">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setSelectedId(l.id)}
            aria-pressed={selected?.id === l.id}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selected?.id === l.id
                ? 'bg-pink-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {l.name} <span className="opacity-70">{l.items.length}</span>
          </button>
        ))}
        <form onSubmit={create} className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            placeholder="New list"
            aria-label="New list name"
            className="input !w-32 !py-1 text-xs"
          />
          <button type="submit" disabled={!newName.trim()} aria-label="Create list" className="btn-secondary !px-2 !py-1">
            <Plus size={13} />
          </button>
        </form>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {loaded && lists.length === 0 && (
        <p className="mt-3 text-xs text-gray-500">
          Make a list above, then add songs and albums from an album's details (click a cover or an album name).
        </p>
      )}

      {selected && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            {renaming === selected.id ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (e.currentTarget.elements.namedItem('rename') as HTMLInputElement).value;
                  void attempt(async () => {
                    await music.renameList(selected.id, name);
                    setRenaming(null);
                  });
                }}
              >
                <input name="rename" defaultValue={selected.name} maxLength={100} aria-label="List name" autoFocus className="input !py-1 text-sm" />
                <button type="submit" aria-label="Save name" className="p-1 text-green-600"><Check size={14} /></button>
                <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)} className="p-1 text-gray-400"><X size={14} /></button>
              </form>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selected.name}</h4>
                <button type="button" aria-label="Rename list" onClick={() => setRenaming(selected.id)} className="p-1 text-gray-400 hover:text-gray-700">
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Delete list"
                  onClick={() => {
                    if (window.confirm(`Delete “${selected.name}” and its ${selected.items.length} item${selected.items.length === 1 ? '' : 's'}? The music itself stays in your library.`)) {
                      void attempt(() => music.deleteList(selected.id));
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
          {selected.items.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">Nothing here yet.</p>
          ) : (
            <ol className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
              {selected.items.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  first={i === 0}
                  last={i === selected.items.length - 1}
                  onMove={(dir) => move(selected, i, dir)}
                  onRemove={() => void attempt(() => music.removeFromList(selected.id, item.id))}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
