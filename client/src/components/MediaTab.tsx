import { useEffect, useMemo, useState } from 'react';
import { Loader2, Film, Tv, Gamepad2, BookOpen, Dices } from 'lucide-react';
import { media } from '../api/client';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import { MediaLibrarySection } from './MediaLibrarySection';
import {
  PeriodMode,
  getCurrentMonthIso,
  getPeriodDateRange,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import type { MediaStats } from '../types';

function getMediaMonthFromLocation(): string {
  const monthParam = new URLSearchParams(window.location.search).get('mediaMonth');
  return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
}

function getMediaPeriodFromLocation(): PeriodMode {
  return parsePeriodParam(new URLSearchParams(window.location.search).get('mediaPeriod')) ?? 'single';
}

function getMediaWeekFromLocation(): string {
  const weekParam = new URLSearchParams(window.location.search).get('mediaWeek');
  return isValidDateParam(weekParam) ? weekParam : getCurrentMonthIso().slice(0, 4) + '-01-01';
}

export function MediaTab() {
  const [periodMode, setPeriodMode] = useState<PeriodMode>(getMediaPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getMediaMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getMediaWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getMediaMonthFromLocation().slice(0, 4), 10));
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [statsData, setStatsData] = useState<MediaStats | null>(null);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    media
      .stats(visibleRange.from || undefined, visibleRange.to || undefined)
      .then((data) => {
        if (cancelled) return;
        setStatsData(data);
      })
      .catch((err) => {
        console.error('Failed to load media stats:', err);
        if (cancelled) return;
        setStatsData(null);
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
    const syncStateFromLocation = () => {
      setSelectedMonth(getMediaMonthFromLocation());
      setSelectedWeek(getMediaWeekFromLocation());
      setPeriodMode(getMediaPeriodFromLocation());
    };

    syncStateFromLocation();
    window.addEventListener('popstate', syncStateFromLocation);
    window.addEventListener('hashchange', syncStateFromLocation);

    return () => {
      window.removeEventListener('popstate', syncStateFromLocation);
      window.removeEventListener('hashchange', syncStateFromLocation);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.get('tab') !== 'media') {
      url.searchParams.set('tab', 'media');
      changed = true;
    }
    if (url.searchParams.get('mediaMonth') !== selectedMonth) {
      url.searchParams.set('mediaMonth', selectedMonth);
      changed = true;
    }
    if (url.searchParams.get('mediaPeriod') !== periodMode) {
      url.searchParams.set('mediaPeriod', periodMode);
      changed = true;
    }
    if (url.searchParams.get('mediaWeek') !== selectedWeek) {
      url.searchParams.set('mediaWeek', selectedWeek);
      changed = true;
    }

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
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5 md:gap-3">
        <StatCard icon={Tv} label="TV Episodes" value={statsData?.tv_episodes_completed ?? 0} />
        <StatCard icon={Film} label="Movies" value={statsData?.movies_watched ?? 0} />
        <StatCard icon={BookOpen} label="Books" value={statsData?.books_completed ?? 0} />
        <StatCard icon={Gamepad2} label="Games" value={statsData?.games_completed ?? 0} />
        <StatCard icon={Dices} label="Board Games" value={statsData?.board_games_completed ?? 0} />
      </div>

      <MediaLibrarySection from={visibleRange.from} to={visibleRange.to} />
    </div>
  );
}
