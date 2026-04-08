import { useEffect, useMemo, useState } from 'react';
import { House, Loader2, Moon, Star } from 'lucide-react';
import { stats } from '../api/client';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import {
  PeriodMode,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import type { SleepDailyPoint, SleepRatingBucket, SleepSummaryStats } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '0m';
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function DailySleepChart({ data }: { data: SleepDailyPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No sleep entries in this period.</p>;
  }

  const max = Math.max(...data.map((d) => Number(d.total_sleep_minutes || 0)), 1);

  return (
    <div className="space-y-2">
      {data.slice(-12).map((point) => {
        const total = Number(point.total_sleep_minutes || 0);
        return (
          <div key={point.date} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.open(`/?from=${point.date}&to=${point.date}`, '_blank', 'noopener,noreferrer')}
              className="text-xs text-left text-gray-600 dark:text-gray-300 hover:text-primary-600 min-w-[84px]"
            >
              {point.date}
            </button>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(total / max) * 100}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-14 text-right">{formatDuration(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RatingDistribution({ data }: { data: SleepRatingBucket[] }) {
  const rated = data.filter((d) => d.stars > 0);
  const max = Math.max(...rated.map((d) => d.count), 1);

  return (
    <div className="space-y-2">
      {[5, 4, 3, 2, 1].map((stars) => {
        const count = data.find((d) => d.stars === stars)?.count || 0;
        return (
          <div key={stars} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-300 w-12">{'★'.repeat(stars)}</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-8 text-right">{count}</span>
          </div>
        );
      })}
      <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
        Unrated: {data.find((d) => d.stars === 0)?.count || 0}
      </p>
    </div>
  );
}

export function SleepTab() {
  const getSleepMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('sleepMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };

  const getSleepPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('sleepPeriod')) ?? 'single';
  };

  const [periodMode, setPeriodMode] = useState<PeriodMode>(getSleepPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getSleepMonthFromLocation);
  const [year, setYear] = useState(() => parseInt(getSleepMonthFromLocation().slice(0, 4), 10));
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [summary, setSummary] = useState<SleepSummaryStats | null>(null);
  const [daily, setDaily] = useState<SleepDailyPoint[]>([]);
  const [ratings, setRatings] = useState<SleepRatingBucket[]>([]);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode),
    [selectedMonth, periodMode]
  );

  const rangeLabel = useMemo(
    () => getPeriodRangeLabel(selectedMonth, periodMode),
    [selectedMonth, periodMode]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      stats.sleepSummary(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
      stats.sleepDaily(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
      stats.sleepRatingDistribution(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
    ])
      .then(([summaryData, dailyData, ratingData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setDaily(dailyData);
        setRatings(ratingData);
      })
      .catch((err) => {
        console.error('Failed to load sleep stats:', err);
        if (cancelled) return;
        setSummary(null);
        setDaily([]);
        setRatings([]);
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
      const nextMonth = getSleepMonthFromLocation();
      setSelectedMonth(nextMonth);
      setYear(parseInt(nextMonth.slice(0, 4), 10));
      setPeriodMode(getSleepPeriodFromLocation());
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

    if (url.searchParams.get('tab') !== 'sleep') {
      url.searchParams.set('tab', 'sleep');
      changed = true;
    }
    if (url.searchParams.get('sleepMonth') !== selectedMonth) {
      url.searchParams.set('sleepMonth', selectedMonth);
      changed = true;
    }
    if (url.searchParams.get('sleepPeriod') !== periodMode) {
      url.searchParams.set('sleepPeriod', periodMode);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [periodMode, selectedMonth]);

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
        />
        <button
          type="button"
          onClick={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
          className="shrink-0 rounded-md p-1 text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-900/20 dark:hover:text-primary-300"
          title="Open selected period in Home"
          aria-label="Open selected period in Home"
        >
          <House size={14} />
        </button>
        {loading && <Loader2 className="animate-spin text-primary-600 shrink-0" size={16} />}
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">{rangeLabel}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Moon} label="Sleeps" value={summary?.total_sleeps ?? 0} />
        <StatCard icon={Moon} label="Avg Duration" value={formatDuration(summary?.avg_duration_minutes ?? 0)} />
        <StatCard icon={Moon} label="Total Sleep" value={formatDuration(summary?.total_sleep_minutes ?? 0)} />
        <StatCard icon={Star} label="Avg Rating" value={summary?.avg_rating ? summary.avg_rating.toFixed(2) : '—'} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Daily Sleep Totals</h3>
          <DailySleepChart data={daily} />
        </div>
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Rating Distribution</h3>
          <RatingDistribution data={ratings} />
        </div>
      </div>
    </div>
  );
}
