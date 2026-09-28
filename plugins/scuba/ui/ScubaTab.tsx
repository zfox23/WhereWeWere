/**
 * SCUBA profile tab (dive stats) — Profile > Dives.
 *
 * Headline stats for the selected period plus all-time breakdowns
 * (per year, water type, dive type, top sites). Uses the plugin's own
 * `/scuba/stats/*` endpoints; the "all time" earliest date comes from
 * `/scuba/stats/earliest`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Anchor, BarChart3, Loader2, MapPin, Timer, Waves } from 'lucide-react';
import { scubaStats } from './api';
import type {
  ScubaGroupCount,
  ScubaSummaryStats,
  ScubaTopSite,
  ScubaYearPoint,
} from './api';
import { PeriodRangeSelector } from '../../../client/src/components/PeriodRangeSelector';
import { StatCard } from '../../../client/src/components/Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../../../client/src/utils/periodRange';
import type { PluginProfileTabProps } from 'wwp-shared';

const USER_ID = '00000000-0000-0000-0000-000000000001';

const WATER_LABELS: Record<string, string> = {
  salt: 'Saltwater',
  fresh: 'Freshwater',
  brackish: 'Brackish',
  pool: 'Pool',
};

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '0m';
  const rounded = Math.round(minutes);
  const MINUTES_PER_DAY = 24 * 60;
  let remaining = rounded;
  const days = Math.floor(remaining / MINUTES_PER_DAY);
  remaining -= days * MINUTES_PER_DAY;
  const hours = Math.floor(remaining / 60);
  const mins = remaining % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ') || '0m';
}

function CountBar({
  label,
  count,
  max,
  extra,
}: {
  label: string;
  count: number;
  max: number;
  extra?: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 dark:text-gray-300 w-28 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
        <div
          className="h-full bg-cyan-500 rounded-full transition-all"
          style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-8 text-right">{count}</span>
      {extra && <span className="text-xs text-gray-400 w-16 text-right">{extra}</span>}
    </div>
  );
}

export function ScubaTab(_props: PluginProfileTabProps) {
  const getScubaMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('scubaMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };
  const getScubaPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('scubaPeriod')) ?? 'single';
  };
  const getScubaWeekFromLocation = (): string => {
    const weekParam = new URLSearchParams(window.location.search).get('scubaWeek');
    return isValidDateParam(weekParam) ? weekParam : getCurrentDateIso();
  };

  const [periodMode, setPeriodMode] = useState<PeriodMode>(getScubaPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getScubaMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getScubaWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getScubaMonthFromLocation().slice(0, 4), 10));
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [summary, setSummary] = useState<ScubaSummaryStats | null>(null);
  const [byYear, setByYear] = useState<ScubaYearPoint[]>([]);
  const [byWater, setByWater] = useState<ScubaGroupCount[]>([]);
  const [byType, setByType] = useState<ScubaGroupCount[]>([]);
  const [topSites, setTopSites] = useState<ScubaTopSite[]>([]);
  const [earliestDiveDate, setEarliestDiveDate] = useState<string | null>(null);

  useEffect(() => {
    scubaStats.earliest(USER_ID).then((d) => setEarliestDiveDate(d.date)).catch(console.error);
    scubaStats.byYear(USER_ID).then(setByYear).catch(console.error);
  }, []);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const from = visibleRange.from || undefined;
    const to = visibleRange.to || undefined;

    Promise.all([
      scubaStats.summary(USER_ID, from, to),
      scubaStats.byWater(USER_ID, from, to),
      scubaStats.byType(USER_ID, from, to),
      scubaStats.topSites(USER_ID, from, to),
    ])
      .then(([summaryData, waterData, typeData, sitesData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setByWater(waterData);
        setByType(typeData);
        setTopSites(sitesData);
      })
      .catch((err) => {
        console.error('Failed to load scuba stats:', err);
        if (cancelled) return;
        setSummary(null);
        setByWater([]);
        setByType([]);
        setTopSites([]);
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
      const nextMonth = getScubaMonthFromLocation();
      setSelectedMonth(nextMonth);
      setSelectedWeek(getScubaWeekFromLocation());
      setYear(parseInt(nextMonth.slice(0, 4), 10));
      setPeriodMode(getScubaPeriodFromLocation());
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

    // The tab param is owned by the Profile shell (plugin:scuba); only the
    // scuba-scoped params are managed here.
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
    setOrDelete('scubaMonth', selectedMonth, selectedMonth === getCurrentMonthIso());
    setOrDelete('scubaPeriod', periodMode, periodMode === 'single');
    setOrDelete('scubaWeek', selectedWeek, selectedWeek === getCurrentDateIso());

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

  const maxYearDives = Math.max(...byYear.map((y) => y.dives), 1);
  const maxWater = Math.max(...byWater.map((w) => w.dives), 1);
  const maxType = Math.max(...byType.map((t) => t.dives), 1);
  const maxSite = Math.max(...topSites.map((s) => s.dives), 1);

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
          allTimeStartDate={earliestDiveDate ?? undefined}
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      )}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 md:gap-3">
            <StatCard icon={Waves} label="Dives" value={summary?.total_dives ?? 0} />
            <StatCard icon={Timer} label="Total bottom time" value={formatDuration(summary?.total_bottom_time ?? 0)} />
            <StatCard
              icon={Anchor}
              label="Max depth"
              value={summary?.max_depth != null ? `${summary.max_depth} m` : '—'}
            />
            <StatCard icon={MapPin} label="Sites" value={summary?.unique_sites ?? 0} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
                <BarChart3 size={14} className="text-cyan-600 dark:text-cyan-400" />
                Dives per year
              </h3>
              {byYear.length === 0 ? (
                <p className="text-sm text-gray-400">No dives logged yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {byYear.map((y) => (
                    <li key={y.year} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 dark:text-gray-300 w-10 shrink-0">{y.year}</span>
                      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan-500 transition-all"
                          style={{ width: `${(y.dives / maxYearDives) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-24 text-right">
                        {y.dives} · {formatDuration(y.total_bottom_time)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Top sites (in period)</h3>
              {topSites.length === 0 ? (
                <p className="text-sm text-gray-400">No dives in this period.</p>
              ) : (
                <ul className="space-y-1.5">
                  {topSites.slice(0, 8).map((site, i) => (
                    <li key={`${site.place ?? 'site'}-${site.city ?? i}`}>
                      <CountBar
                        label={[site.place, site.city].filter(Boolean).join(', ')}
                        count={site.dives}
                        max={maxSite}
                        extra={site.max_depth != null ? `${site.max_depth} m max` : null}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Water (in period)</h3>
              {byWater.length === 0 ? (
                <p className="text-sm text-gray-400">No dives in this period.</p>
              ) : (
                <div className="space-y-1.5">
                  {byWater.map((w) => (
                    <CountBar
                      key={w.water_type ?? 'unknown'}
                      label={WATER_LABELS[w.water_type ?? ''] ?? (w.water_type || 'Unknown')}
                      count={w.dives}
                      max={maxWater}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Dive types (in period)</h3>
              {byType.length === 0 ? (
                <p className="text-sm text-gray-400">No dive types logged in this period.</p>
              ) : (
                <div className="space-y-1.5">
                  {byType.slice(0, 8).map((t) => (
                    <CountBar key={t.dive_type ?? 'type'} label={t.dive_type ?? 'Unknown'} count={t.dives} max={maxType} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
