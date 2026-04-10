import { useEffect, useMemo, useState } from 'react';
import { Loader2, Moon, Star } from 'lucide-react';
import { stats } from '../api/client';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import type { SleepDailyPoint, SleepRatingBucket, SleepSummaryStats } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '0m';
  const rounded = Math.round(minutes);
  const MINUTES_PER_HOUR = 60;
  const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
  const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY;

  let remaining = rounded;
  const years = Math.floor(remaining / MINUTES_PER_YEAR);
  remaining -= years * MINUTES_PER_YEAR;

  const days = Math.floor(remaining / MINUTES_PER_DAY);
  remaining -= days * MINUTES_PER_DAY;

  const hours = Math.floor(remaining / MINUTES_PER_HOUR);
  const mins = remaining % MINUTES_PER_HOUR;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);

  return parts.join(' ') || '0m';
}

type SleepTotalDay = {
  date: string;
  totalMinutes: number;
};

function SleepRankedDaysCard({
  title,
  days,
  emptyText,
}: {
  title: string;
  days: SleepTotalDay[];
  emptyText: string;
}) {
  const max = Math.max(...days.map((day) => day.totalMinutes), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{title}</h3>
      {days.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {days.map((day, idx) => (
            <li key={`${title}-${day.date}`} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.open(`/?from=${day.date}&to=${day.date}`, '_blank', 'noopener,noreferrer')}
                className="text-xs text-left text-gray-500 dark:text-gray-400 hover:text-primary-600 w-24 shrink-0"
              >
                {day.date}
              </button>
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
                <div
                  className="h-full rounded-full transition-all bg-indigo-500"
                  style={{ width: `${(day.totalMinutes / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-12 text-right">
                {formatDuration(day.totalMinutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RatingDistribution({
  data,
  avgRating,
}: {
  data: SleepRatingBucket[];
  avgRating: number | null;
}) {
  const rated = data.filter((d) => d.stars > 0);
  const max = Math.max(...rated.map((d) => d.count), 1);

  return (
    <div className="space-y-2">
      {[5, 4, 3, 2, 1].map((stars) => {
        const count = data.find((d) => d.stars === stars)?.count || 0;
        return (
          <div key={stars} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-300 w-6 flex items-center gap-1"><span>{stars}</span><Star size={12} /></span>
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
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Average Rating: {avgRating ? avgRating.toFixed(2) : '—'}
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

  const getSleepWeekFromLocation = (): string => {
    const weekParam = new URLSearchParams(window.location.search).get('sleepWeek');
    return isValidDateParam(weekParam) ? weekParam : getCurrentDateIso();
  };

  const [periodMode, setPeriodMode] = useState<PeriodMode>(getSleepPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getSleepMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getSleepWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getSleepMonthFromLocation().slice(0, 4), 10));
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [summary, setSummary] = useState<SleepSummaryStats | null>(null);
  const [daily, setDaily] = useState<SleepDailyPoint[]>([]);
  const [ratings, setRatings] = useState<SleepRatingBucket[]>([]);
  const [earliestSleepDate, setEarliestSleepDate] = useState<string | null>(null);

  useEffect(() => {
    stats.earliestDates(USER_ID).then((d) => setEarliestSleepDate(d.sleep)).catch(console.error);
  }, []);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  const rangeLabel = useMemo(
    () => getPeriodRangeLabel(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  const rankedSleepDays = useMemo(() => {
    const totals = daily
      .map((point) => ({
        date: point.date,
        totalMinutes: Math.max(0, Number(point.total_sleep_minutes || 0)),
      }))
      .filter((point) => point.totalMinutes > 0);

    const longest = [...totals]
      .sort((a, b) => b.totalMinutes - a.totalMinutes || b.date.localeCompare(a.date))
      .slice(0, 10);

    const shortest = [...totals]
      .sort((a, b) => a.totalMinutes - b.totalMinutes || a.date.localeCompare(b.date))
      .slice(0, 10);

    return { longest, shortest };
  }, [daily]);

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
      setSelectedWeek(getSleepWeekFromLocation());
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
    if (url.searchParams.get('sleepWeek') !== selectedWeek) {
      url.searchParams.set('sleepWeek', selectedWeek);
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
          allTimeStartDate={earliestSleepDate ?? undefined}
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">{rangeLabel}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={Moon} label="Sleeps" value={summary?.total_sleeps ?? 0} />
        <StatCard icon={Moon} label="Avg Duration" value={formatDuration(summary?.avg_duration_minutes ?? 0)} />
        <StatCard icon={Moon} label="Total Sleep" value={formatDuration(summary?.total_sleep_minutes ?? 0)} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <SleepRankedDaysCard
          title="Longest Sleeps"
          days={rankedSleepDays.longest}
          emptyText="No sleep entries in this period."
        />
        <SleepRankedDaysCard
          title="Shortest Sleeps"
          days={rankedSleepDays.shortest}
          emptyText="No sleep entries in this period."
        />
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Rating Distribution</h3>
          <RatingDistribution data={ratings} avgRating={summary?.avg_rating ?? null} />
        </div>
      </div>
    </div>
  );
}
