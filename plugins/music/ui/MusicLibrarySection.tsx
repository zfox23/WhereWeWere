/**
 * Music library: a sortable, searchable table of the songs, artists or albums
 * played. The server searches, sorts and pages (a library holds tens of
 * thousands of songs, so no client-side copy could be complete); the table
 * shows the first page and loads more on request.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Search, X } from 'lucide-react';
import { usePagedLibrary, useDebouncedValue } from '../../../client/src/hooks/usePagedLibrary';
import { PagingFooter } from '../../../client/src/components/lists/PagingFooter';
import { music } from './api';
import { AlbumArt } from './AlbumArt';
import { AlbumLink } from './AlbumLink';
import { ListBadge, albumItemKey, songItemKey } from './ListBadge';
import { formatDay, formatDuration, joinArtists } from './format';
import type { MusicAggregate, MusicLibraryView } from './types';

type SortDir = 'asc' | 'desc';

interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  /** Value used for sorting. */
  sort: (row: MusicAggregate) => string | number;
  render: (row: MusicAggregate) => string | number;
  /** Draw the album cover to the left of the value. */
  art?: boolean;
}

const text = (v: string | null | undefined) => (v ?? '').toLowerCase();

const PLAYS: Column = { key: 'plays', label: 'Plays', numeric: true, sort: (r) => r.plays, render: (r) => r.plays };
const TIME: Column = {
  key: 'time', label: 'Time', numeric: true,
  sort: (r) => r.listened_seconds,
  render: (r) => (r.listened_seconds ? formatDuration(r.listened_seconds) : '—'),
};
const LAST: Column = {
  key: 'last', label: 'Last played', numeric: true,
  sort: (r) => new Date(r.last_played_at).getTime(),
  render: (r) => formatDay(r.last_played_at),
};
const TRACKS: Column = {
  key: 'tracks', label: 'Tracks', numeric: true,
  sort: (r) => r.unique_tracks ?? 0, render: (r) => r.unique_tracks ?? 0,
};

const COLUMNS: Record<MusicLibraryView, Column[]> = {
  songs: [
    { key: 'name', label: 'Title', sort: (r) => text(r.name), render: (r) => r.name },
    { key: 'artists', label: 'Artist', sort: (r) => text(joinArtists(r.artists)), render: (r) => joinArtists(r.artists) },
    { key: 'album', label: 'Album', sort: (r) => text(r.album), render: (r) => r.album ?? '', art: true },
    PLAYS, TIME, LAST,
  ],
  artists: [
    { key: 'name', label: 'Artist', sort: (r) => text(r.name), render: (r) => r.name },
    TRACKS, PLAYS, TIME, LAST,
  ],
  albums: [
    { key: 'name', label: 'Album', sort: (r) => text(r.name), render: (r) => r.name, art: true },
    { key: 'artists', label: 'Artist', sort: (r) => text(joinArtists(r.artists)), render: (r) => joinArtists(r.artists) },
    TRACKS, PLAYS, TIME, LAST,
  ],
};

const VIEWS: { value: MusicLibraryView; label: string }[] = [
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
];

const DEFAULT_VIEW: MusicLibraryView = 'songs';
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_SORT = 'plays';
const DEFAULT_DIR: SortDir = 'desc';

interface LibraryUrlState {
  view: MusicLibraryView;
  sortBy: string;
  sortDir: SortDir;
  query: string;
}

function getStateFromLocation(): LibraryUrlState {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('musicView');
  const sort = params.get('sort');
  const dir = params.get('dir');
  const resolvedView = VIEWS.some((v) => v.value === view) ? (view as MusicLibraryView) : DEFAULT_VIEW;
  return {
    view: resolvedView,
    sortBy: COLUMNS[resolvedView].some((c) => c.key === sort) ? (sort as string) : DEFAULT_SORT,
    sortDir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_DIR,
    query: params.get('q') ?? '',
  };
}

interface MusicLibrarySectionProps {
  from: string;
  to: string;
}

export function MusicLibrarySection({ from, to }: MusicLibrarySectionProps) {
  const initial = useMemo(getStateFromLocation, []);
  const [view, setView] = useState<MusicLibraryView>(initial.view);
  const [sortBy, setSortBy] = useState(initial.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [query, setQuery] = useState(initial.query);

  // The search text is sent a moment after typing stops.
  const searchText = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  // A new view, search, sort or range starts again from the first page.
  const { rows, total, loading, loadingMore, error, loadMore } = usePagedLibrary<MusicAggregate>(
    (offset) =>
      music.library(view, from || undefined, to || undefined, {
        q: searchText, sort: sortBy, dir: sortDir, limit: PAGE_SIZE, ...(offset ? { offset } : {}),
      }),
    [view, from, to, searchText, sortBy, sortDir],
  );

  // Re-sync with the URL on back/forward.
  useEffect(() => {
    const sync = () => {
      const s = getStateFromLocation();
      setView(s.view);
      setSortBy(s.sortBy);
      setSortDir(s.sortDir);
      setQuery(s.query);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  // Mirror non-default state to the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    const setOrDelete = (key: string, value: string, isDefault: boolean) => {
      if (isDefault) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      } else if (url.searchParams.get(key) !== value) {
        url.searchParams.set(key, value);
        changed = true;
      }
    };
    setOrDelete('musicView', view, view === DEFAULT_VIEW);
    setOrDelete('sort', sortBy, sortBy === DEFAULT_SORT);
    setOrDelete('dir', sortDir, sortDir === DEFAULT_DIR);
    setOrDelete('q', query, query === '');
    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [view, sortBy, sortDir, query]);

  const columns = COLUMNS[view];
  const activeColumn = columns.find((c) => c.key === sortBy) ?? columns.find((c) => c.key === DEFAULT_SORT)!;

  const visibleRows = rows;

  const changeView = (next: MusicLibraryView) => {
    setView(next);
    // A column that doesn't exist in the new view falls back to the default.
    if (!COLUMNS[next].some((c) => c.key === sortBy)) {
      setSortBy(DEFAULT_SORT);
      setSortDir(DEFAULT_DIR);
    }
  };

  const toggleSort = (column: Column) => {
    if (column.key === activeColumn.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column.key);
      setSortDir(column.numeric ? 'desc' : 'asc');
    }
  };

  return (
    <section id="music-library" className="space-y-3 scroll-mt-4" aria-label="Music library">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden" role="group">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => changeView(v.value)}
              aria-pressed={view === v.value}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-white/60 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter library"
            aria-label="Filter library"
            className="input pl-8 pr-8 py-1.5 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-primary-600" />}
      </div>

      <div
        className={`overflow-x-auto rounded-2xl border border-white/40 dark:border-gray-700/40 bg-white/60 dark:bg-gray-900/60 shadow-sm shadow-black/3 ${loading ? 'opacity-60' : ''}`}
        aria-busy={loading}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200/70 dark:border-gray-700/60 text-xs uppercase tracking-wide text-gray-500">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.key === activeColumn.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c)}
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    {c.label}
                    {c.key === activeColumn.key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={`${row.name}|${joinArtists(row.artists)}|${i}`} className="border-b last:border-0 border-gray-100 dark:border-gray-800">
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${c.numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left'} ${
                      ci === 0 ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {c.art ? (
                      <span className="flex items-center gap-2">
                        <AlbumArt artId={row.art_id} albumRef={row.album_ref} size={28} />
                        <span className="min-w-0">
                          <AlbumLink albumRef={row.album_ref}>{c.render(row) || undefined}</AlbumLink>
                          <ListBadge itemKey={albumItemKey(row.album_ref)} />
                        </span>
                      </span>
                    ) : view === 'songs' && c.key === 'name' ? (
                      <>
                        {c.render(row)}<ListBadge itemKey={songItemKey(row.song_key)} />
                      </>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-gray-500">
                  {error ? "Couldn't load the music library." : searchText ? 'Nothing matches your filter.' : 'No music played yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PagingFooter shown={rows.length} total={total} loadingMore={loadingMore} onMore={loadMore} />
    </section>
  );
}
