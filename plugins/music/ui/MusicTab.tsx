/**
 * Profile > Music, in three subtabs like Profile > Places (`musicSection` in
 * the URL): Overview (listening totals and top songs/artists/albums for the
 * selected period), Library (every song, artist and album, all time) and Lists.
 * Only Overview has the period selector; its state lives in the URL
 * (`musicMonth` / `musicPeriod` / `musicWeek`).
 */

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Disc3, Library, List, ListPlus, Loader2, Mic2, Music, Timer, Users } from 'lucide-react';
import type { PluginProfileTabProps } from 'wwp-shared';
import { stats as statsApi } from '../../../client/src/api/client';
import { PeriodRangeSelector } from '../../../client/src/components/PeriodRangeSelector';
import { StatCard } from '../../../client/src/components/Stats';
import {
  PeriodMode,
  getCurrentMonthIso,
  getPeriodDateRange,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../../../client/src/utils/periodRange';
import { music } from './api';
import { formatDuration, joinArtists } from './format';
import { AlbumArt } from './AlbumArt';
import { AlbumLink } from './AlbumLink';
import { ListBadge, albumItemKey, songItemKey } from './ListBadge';
import { MusicLibrarySection } from './MusicLibrarySection';
import { MusicListsSection } from './MusicListsSection';
import { openMusicList, topListTitle } from './listTitle';
import { refreshMusicLists } from './useMusicLists';
import { ProfileLibraryLink } from './libraryLinks';
import type { ListTarget, MusicAggregate, MusicLibraryView, MusicStats } from './types';

function getMonthFromLocation(): string {
  const param = new URLSearchParams(window.location.search).get('musicMonth');
  return isValidMonthParam(param) ? param : getCurrentMonthIso();
}

function getPeriodFromLocation(): PeriodMode {
  return parsePeriodParam(new URLSearchParams(window.location.search).get('musicPeriod')) ?? 'single';
}

function getWeekFromLocation(): string {
  const param = new URLSearchParams(window.location.search).get('musicWeek');
  return isValidDateParam(param) ? param : getCurrentMonthIso().slice(0, 4) + '-01-01';
}

export type MusicSection = 'overview' | 'library' | 'lists';

const SECTIONS: { key: MusicSection; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'library', label: 'Library', icon: Library },
  { key: 'lists', label: 'Lists', icon: List },
];

function getSectionFromLocation(): MusicSection {
  const section = new URLSearchParams(window.location.search).get('musicSection');
  return section === 'library' || section === 'lists' ? section : 'overview';
}

/** Params that belong to the Library subtab. */
const LIBRARY_PARAMS = ['musicView', 'q', 'sort', 'dir'];
/** Params that belong to the Lists subtab. */
const LISTS_PARAMS = ['musicList'];

const TOP_COLLAPSED = 10;

function TopList({
  title,
  icon: Icon,
  rows,
  detail,
  view,
  withArt = false,
  onMakeList,
}: {
  title: string;
  icon: React.ElementType;
  rows: MusicAggregate[];
  detail: (row: MusicAggregate) => string;
  /** Library view a row links to. */
  view: MusicLibraryView;
  /** Show each row's album cover (songs and albums, not artists). */
  withArt?: boolean;
  /** Make a list of the rows shown (songs and albums only); may throw with a message to show. */
  onMakeList?: (shown: MusicAggregate[]) => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [making, setMaking] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  const shown = showAll ? rows : rows.slice(0, TOP_COLLAPSED);
  const max = Math.max(...rows.map((r) => r.plays), 1);

  const makeList = async () => {
    if (!onMakeList || making) return;
    setMaking(true);
    setMakeError(null);
    try {
      await onMakeList(shown);
    } catch (err) {
      setMakeError(err instanceof Error ? err.message : 'Could not make the list.');
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Icon size={16} className="text-pink-500" />
          {title}
        </h3>
        {onMakeList && (
          <button
            type="button"
            onClick={() => void makeList()}
            disabled={making || shown.length === 0}
            aria-label={`Make a list from these ${shown.length} ${view}`}
            title={`Make a list from the ${shown.length} ${view} shown`}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-pink-50 hover:text-pink-600 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-pink-900/20"
          >
            {making ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />}
          </button>
        )}
      </div>
      {makeError && <p className="mb-2 text-xs text-red-500">{makeError}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">Nothing played in this period.</p>
      ) : (
        <ol className="space-y-2">
          {shown.map((row, i) => (
            <li key={`${row.name}|${detail(row)}|${i}`} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
                  <span className="text-gray-400 tabular-nums">{i + 1}.</span>
                  {withArt && <AlbumArt artId={row.art_id} albumRef={row.album_ref} size={28} />}
                  <span className="min-w-0 truncate">
                    {view === 'albums' ? (
                      <AlbumLink albumRef={row.album_ref}>{row.name}</AlbumLink>
                    ) : (
                      <ProfileLibraryLink view={view} q={row.name}>{row.name}</ProfileLibraryLink>
                    )}
                    {view !== 'artists' && (
                      <>
                        <ListBadge itemKey={view === 'songs' ? songItemKey(row.song_key) : albumItemKey(row.album_ref)} />
                      </>
                    )}
                    {detail(row) && <span className="text-xs text-gray-500 dark:text-gray-400"> · {detail(row)}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">{row.plays}</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-1 rounded-full bg-pink-400/80" style={{ width: `${(row.plays / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {rows.length > TOP_COLLAPSED && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-medium text-primary-600 hover:underline"
        >
          {showAll ? 'Show fewer' : `Show ${rows.length - TOP_COLLAPSED} more`}
        </button>
      )}
    </div>
  );
}

export function MusicTab(_props: PluginProfileTabProps) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>(getPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getMonthFromLocation().slice(0, 4), 10));
  const [section, setSection] = useState<MusicSection>(getSectionFromLocation);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [data, setData] = useState<MusicStats | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek],
  );

  useEffect(() => {
    statsApi
      .earliestDates('00000000-0000-0000-0000-000000000001')
      .then((dates) => setEarliestDate(dates.music ?? null))
      .catch(() => setEarliestDate(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .stats(visibleRange.from || undefined, visibleRange.to || undefined)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error('Failed to load music stats:', err);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visibleRange.from, visibleRange.to]);

  useEffect(() => {
    const sync = () => {
      setSelectedMonth(getMonthFromLocation());
      setSelectedWeek(getWeekFromLocation());
      setPeriodMode(getPeriodFromLocation());
      setSection(getSectionFromLocation());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.get('tab') !== 'plugin:music') {
      url.searchParams.set('tab', 'plugin:music');
      changed = true;
    }
    const monthDefault = getCurrentMonthIso();
    const weekDefault = monthDefault.slice(0, 4) + '-01-01';
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
    setOrDelete('musicMonth', selectedMonth, selectedMonth === monthDefault);
    setOrDelete('musicPeriod', periodMode, periodMode === 'single');
    setOrDelete('musicWeek', selectedWeek, selectedWeek === weekDefault);
    setOrDelete('musicSection', section, section === 'overview');
    // The library's filters aren't meaningful (or wanted in a shared link) on the other subtabs.
    const unwanted = [...(section !== 'library' ? LIBRARY_PARAMS : []), ...(section !== 'lists' ? LISTS_PARAMS : [])];
    for (const key of unwanted) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [periodMode, selectedMonth, selectedWeek, section]);

  const totals = data?.totals;

  // A new list of the rows shown (rank 1 = most played), named for the period; then open it.
  const makeList = (kind: 'songs' | 'albums') => async (shown: MusicAggregate[]) => {
    const items = shown.flatMap((row): ListTarget[] => {
      if (kind === 'albums') return row.album_ref != null ? [{ kind: 'album', album_ref: row.album_ref }] : [];
      return row.song_key ? [{ kind: 'song', song_key: row.song_key, album_ref: row.album_ref }] : [];
    });
    if (items.length === 0) throw new Error('Nothing here can be added to a list.');
    const created = await music.createListFromItems(topListTitle(visibleRange.from, visibleRange.to, kind), items);
    await refreshMusicLists();
    openMusicList(created.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-gray-800/60">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            aria-pressed={section === key}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              section === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {section === 'overview' && !initialLoaded && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      )}

      {section === 'overview' && initialLoaded && (
        <>
          <div className="flex items-center gap-2">
            <PeriodRangeSelector
              periodMode={periodMode}
              onPeriodModeChange={setPeriodMode}
              year={year}
              onYearChange={setYear}
              selectedMonth={selectedMonth}
              onSelectedMonthChange={setSelectedMonth}
              selectedWeek={selectedWeek}
              onSelectedWeekChange={setSelectedWeek}
              allTimeStartDate={earliestDate ?? undefined}
              onOpenHome={() => {
                if (visibleRange.from && visibleRange.to) {
                  window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
                } else {
                  window.open('/', '_blank', 'noopener,noreferrer');
                }
              }}
            />
          </div>

          <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 md:gap-3">
              <StatCard icon={Music} label="Scrobbles" value={totals?.scrobbles ?? 0} />
              <StatCard icon={Timer} label="Listening time" value={formatDuration(totals?.listened_seconds ?? 0)} />
              <StatCard icon={Users} label="Artists" value={totals?.unique_artists ?? 0} />
              <StatCard icon={Disc3} label="Tracks" value={totals?.unique_tracks ?? 0} />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <TopList title="Top songs" icon={Music} view="songs" rows={data?.top_songs ?? []} detail={(r) => joinArtists(r.artists)} withArt onMakeList={makeList('songs')} />
              <TopList title="Top artists" icon={Mic2} view="artists" rows={data?.top_artists ?? []} detail={() => ''} />
              <TopList title="Top albums" icon={Disc3} view="albums" rows={data?.top_albums ?? []} detail={(r) => joinArtists(r.artists)} withArt onMakeList={makeList('albums')} />
            </div>
          </div>

        </>
      )}

      {section === 'library' && <MusicLibrarySection from="" to="" />}

      {section === 'lists' && <MusicListsSection />}
    </div>
  );
}
