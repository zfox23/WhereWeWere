/**
 * Profile > Music: listening totals, top songs/artists/albums and a library
 * table for the selected period. The period selector state lives in the URL
 * (`musicMonth` / `musicPeriod` / `musicWeek`), as in the media tab.
 */

import { useEffect, useMemo, useState } from 'react';
import { Disc3, Loader2, Mic2, Music, Timer, Users } from 'lucide-react';
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
import { MusicLibrarySection } from './MusicLibrarySection';
import type { MusicAggregate, MusicStats } from './types';

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

const TOP_COLLAPSED = 10;

function TopList({
  title,
  icon: Icon,
  rows,
  detail,
}: {
  title: string;
  icon: React.ElementType;
  rows: MusicAggregate[];
  detail: (row: MusicAggregate) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, TOP_COLLAPSED);
  const max = Math.max(...rows.map((r) => r.plays), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        <Icon size={16} className="text-pink-500" />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">Nothing played in this period.</p>
      ) : (
        <ol className="space-y-2">
          {shown.map((row, i) => (
            <li key={`${row.name}|${detail(row)}|${i}`} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-gray-900 dark:text-gray-100">
                  <span className="text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>
                  {row.name}
                  {detail(row) && <span className="text-xs text-gray-500 dark:text-gray-400"> · {detail(row)}</span>}
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
    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [periodMode, selectedMonth, selectedWeek]);

  if (!initialLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="space-y-6">
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
          <TopList title="Top songs" icon={Music} rows={data?.top_songs ?? []} detail={(r) => joinArtists(r.artists)} />
          <TopList title="Top artists" icon={Mic2} rows={data?.top_artists ?? []} detail={() => ''} />
          <TopList title="Top albums" icon={Disc3} rows={data?.top_albums ?? []} detail={(r) => joinArtists(r.artists)} />
        </div>
      </div>

      <MusicLibrarySection from={visibleRange.from} to={visibleRange.to} />
    </div>
  );
}
