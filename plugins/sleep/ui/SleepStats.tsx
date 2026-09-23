/**
 * Sleep profile tab (stats).
 *
 * Adapted from the former core component (client/src/components/SleepTab.tsx)
 * to the plugin `PluginProfileTabProps` contract. Uses the plugin's own stats
 * endpoints instead of the core `stats` client; the "all time" earliest date
 * now comes from the plugin's `/sleep-entries/stats/earliest` endpoint.
 *
 * Also exports `SleepYearInPixels`, used by the core ReflectTab's
 * "Sleep in Pixels" heatmap (same pattern as the mood plugin's
 * `MoodYearInPixels`).
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Moon, Star } from 'lucide-react';
import { sleepStats } from './api';
import type { SleepDailyPoint, SleepRatingBucket, SleepSummaryStats } from './types';
import { PeriodRangeSelector } from '../../../client/src/components/PeriodRangeSelector';
import { StatCard } from '../../../client/src/components/Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../../../client/src/utils/periodRange';
import type { PluginProfileTabProps } from 'wwp-shared';

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
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
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
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-8 text-right">{count}</span>
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

export function SleepTab(_props: PluginProfileTabProps) {
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
    sleepStats.earliest(USER_ID).then((d) => setEarliestSleepDate(d.date)).catch(console.error);
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
      sleepStats.summary(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
      sleepStats.daily(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
      sleepStats.ratingDistribution(USER_ID, visibleRange.from || undefined, visibleRange.to || undefined),
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

    // The tab param is owned by the Profile shell (plugin:sleep); only the
    // sleep-scoped params are managed here.
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
    setOrDelete('sleepMonth', selectedMonth, selectedMonth === getCurrentMonthIso());
    setOrDelete('sleepPeriod', periodMode, periodMode === 'single');
    setOrDelete('sleepWeek', selectedWeek, selectedWeek === getCurrentDateIso());

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


      <div className="grid grid-cols-3 gap-1.5 md:gap-3">
        <StatCard icon={Moon} label="Entries" value={summary?.total_sleeps ?? 0} />
        <StatCard icon={Moon} label="Avg Duration" value={formatDuration(summary?.avg_duration_minutes ?? 0)} />
        <StatCard icon={Moon} label="Total" value={formatDuration(summary?.total_sleep_minutes ?? 0)} />
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
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Rating Distribution</h3>
          <RatingDistribution data={ratings} avgRating={summary?.avg_rating ?? null} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year-in-pixels heatmap (used by the core ReflectTab, like MoodYearInPixels)
// ---------------------------------------------------------------------------

function formatMinutesToDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function SleepYearInPixels({
  data,
  year,
}: {
  data: SleepDailyPoint[];
  year: number;
}) {
  const dayMap = new Map(data.map((d) => [d.date, d.total_sleep_minutes]));
  const countMap = new Map(data.map((d) => [d.date, d.count]));
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  const allDays: { date: string; duration: number | null; count: number }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;
    allDays.push({
      date,
      duration: dayMap.get(date) ?? null,
      count: countMap.get(date) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const startDow = new Date(startDate).getDay();
  const padded = [...Array.from({ length: startDow }, () => null as null), ...allDays];
  const weeks: (typeof padded)[] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function durationColor(minutes: number): string {
    if (minutes < 240) return 'bg-rose-300';
    if (minutes < 360) return 'bg-orange-300';
    if (minutes < 420) return 'bg-cyan-300';
    if (minutes < 480) return 'bg-sky-400';
    return 'bg-indigo-500';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <Moon size={16} className="text-indigo-500" />
          Sleep in Pixels
        </h3>
      </div>

      <div className="overflow-x-auto">
        <div className="relative h-4 mb-1" style={{ minWidth: weeks.length * 15 }}>
          {monthLabels.map((month, i) => {
            const weekIndex = Math.floor((i * 52) / 12);
            return (
              <span
                key={month}
                className="absolute text-[10px] text-gray-400"
                style={{ left: weekIndex * 15 }}
              >
                {month}
              </span>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day, dayIndex) => {
                if (!day) {
                  return <div key={dayIndex} className="w-[12px] h-[12px]" />;
                }

                if (day.duration === null || day.count === 0) {
                  return (
                    <div
                      key={dayIndex}
                      className="w-[12px] h-[12px] rounded-sm bg-gray-100 dark:bg-gray-800"
                      title={`${day.date}: no sleep data`}
                    />
                  );
                }

                return (
                  <div
                    key={dayIndex}
                    className={`w-[12px] h-[12px] rounded-sm cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 dark:hover:ring-gray-500 ${durationColor(day.duration)}`}
                    title={`${day.date}: total ${formatMinutesToDuration(day.duration)} (${day.count} sleep entr${day.count === 1 ? 'y' : 'ies'})`}
                    onClick={() => window.open(`/?from=${day.date}&to=${day.date}`, '_blank', 'noopener,noreferrer')}
                  />
                );
              })}
              {week.length < 7 &&
                Array.from({ length: 7 - week.length }, (_, idx) => (
                  <div key={`pad-${idx}`} className="w-[12px] h-[12px]" />
                ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-2 justify-start">
          <span className="text-[10px] text-gray-400 mr-1">&le;4h</span>
          <div className="w-[12px] h-[12px] rounded-sm bg-rose-300" title="Under 4h" />
          <div className="w-[12px] h-[12px] rounded-sm bg-orange-300" title="4h-6h" />
          <div className="w-[12px] h-[12px] rounded-sm bg-cyan-300" title="6h-7h" />
          <div className="w-[12px] h-[12px] rounded-sm bg-sky-400" title="7h-8h" />
          <div className="w-[12px] h-[12px] rounded-sm bg-indigo-500" title="8h+" />
          <span className="text-[10px] text-gray-400 ml-1">&ge;8h</span>
        </div>
      </div>
    </div>
  );
}
