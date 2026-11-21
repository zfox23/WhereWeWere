/**
 * When you listen: a day-of-week by hour-of-day grid for the period, each
 * play read in its own local time. One hue, darker for more.
 */

import { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { music } from '../api';
import { formatDuration } from '../format';
import type { ClockCell } from '../types';
import { ChartCard, Toggle } from './ChartCard';
import { scrubHandlers } from './scrub';

/** Rows Monday first, so the weekend sits together at the bottom. */
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function hourLabel(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

type Metric = 'plays' | 'time';

export function ListeningClock({ from, to }: { from?: string; to?: string }) {
  const [cells, setCells] = useState<ClockCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .listeningClock(from, to)
      .then((c) => {
        if (cancelled) return;
        setCells(c);
        setError(false);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return <ClockCard cells={cells} loading={loading} error={error} />;
}

/**
 * The grid itself, for any set of plays: the Overview's period, or one song's
 * or artist's whole history on their pages.
 */
export function ClockCard({
  cells,
  loading = false,
  error = false,
  title = 'Listening clock',
  emptyText = 'Nothing played in this period.',
  withTotals = false,
}: {
  cells: ClockCell[];
  loading?: boolean;
  error?: boolean;
  title?: string;
  emptyText?: string;
  /** Add bars by hour and by weekday under the grid. */
  withTotals?: boolean;
}) {
  const [metric, setMetric] = useState<Metric>('plays');
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);

  const value = (c: ClockCell | undefined) => (c ? (metric === 'plays' ? c.plays : c.seconds) : 0);
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c])), [cells]);
  const max = Math.max(...cells.map(value), 1);
  const peak = cells.reduce<ClockCell | null>((best, c) => (!best || value(c) > value(best) ? c : best), null);
  const describe = (c: ClockCell | undefined, dow: number, hour: number) => {
    const amount = metric === 'plays' ? `${c?.plays ?? 0} play${c?.plays === 1 ? '' : 's'}` : formatDuration(c?.seconds ?? 0);
    return `${DAY_NAMES[dow]} ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${amount}`;
  };
  // The cell under the pointer (a finger keeps its first target, so look it up by position).
  const scrub = scrubHandlers<HTMLDivElement, { dow: number; hour: number }>((e) => {
    const el = document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null;
    const dow = el?.dataset.dow;
    const hour = el?.dataset.hour;
    return dow != null && hour != null ? { dow: Number(dow), hour: Number(hour) } : null;
  }, setHover);
  const readout = hover
    ? describe(byKey.get(`${hover.dow}-${hover.hour}`), hover.dow, hover.hour)
    : peak
      ? `Busiest: ${describe(peak, peak.dow, peak.hour)}`
      : '';

  return (
    <ChartCard
      title={title}
      icon={Clock}
      loading={loading}
      controls={
        <Toggle
          label="Measure"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'plays', label: 'Plays' },
            { value: 'time', label: 'Time' },
          ]}
        />
      }
    >
      {error ? (
        <p className="text-xs text-red-500">Couldn't load the listening clock.</p>
      ) : cells.length === 0 && !loading ? (
        <p className="text-xs text-gray-500">{emptyText}</p>
      ) : (
        <>
          <p className="mb-2 min-h-4 text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-live="polite">
            {readout}
          </p>
          <div
            role="img"
            aria-label={peak ? `Listening by day and hour. ${readout}` : 'Listening by day and hour'}
            className="grid gap-[2px]"
            {...scrub}
            style={{ ...scrub.style, gridTemplateColumns: '2rem repeat(24, minmax(0, 1fr))' }}
          >
            {DAYS.map((dow) => (
              <div key={dow} className="contents">
                <span className="self-center pr-1 text-right text-[10px] text-gray-400">{DAY_NAMES[dow].slice(0, 3)}</span>
                {HOURS.map((hour) => {
                  const c = byKey.get(`${dow}-${hour}`);
                  const v = value(c);
                  return (
                    <div
                      key={hour}
                      data-testid={`clock-${dow}-${hour}`}
                      data-dow={dow}
                      data-hour={hour}
                      title={describe(c, dow, hour)}
                      className={`aspect-square rounded-[3px] ${
                        v ? 'bg-pink-600 dark:bg-pink-400' : 'bg-gray-100 dark:bg-gray-800'
                      } ${hover?.dow === dow && hover.hour === hour ? 'ring-2 ring-pink-300 dark:ring-pink-200' : ''}`}
                      // Never fainter than a quarter, so a single play still shows.
                      style={v ? { opacity: 0.25 + 0.75 * (v / max) } : undefined}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            {HOURS.map((h) => (
              <span key={h} className="text-center text-[9px] text-gray-400">
                {h % 3 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
          </div>
          {withTotals && <Totals cells={cells} value={value} />}
        </>
      )}
    </ChartCard>
  );
}

/** By hour of day and by weekday on their own, summed across the other. */
function Totals({ cells, value }: { cells: ClockCell[]; value: (c: ClockCell | undefined) => number }) {
  const byHour = HOURS.map((h) => cells.reduce((n, c) => (c.hour === h ? n + value(c) : n), 0));
  const byDay = DAYS.map((d) => cells.reduce((n, c) => (c.dow === d ? n + value(c) : n), 0));
  const topHour = byHour.indexOf(Math.max(...byHour));
  const topDay = DAYS[byDay.indexOf(Math.max(...byDay))];
  const bars = (values: number[], labels: string[], titles: string[], name: string) => {
    const max = Math.max(...values, 1);
    return (
      <div role="img" aria-label={name} className="flex h-12 items-end gap-px">
        {values.map((v, i) => (
          <div key={i} title={titles[i]} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="block w-full rounded-t-sm bg-pink-400/80" style={{ height: `${v ? Math.max((v / max) * 100, 4) : 0}%` }} />
            <span className="mt-0.5 h-3 text-[9px] leading-3 text-gray-400">{labels[i]}</span>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[3fr_1fr]">
      <div>
        <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
          By hour · most at <span className="font-medium text-gray-700 dark:text-gray-200">{hourLabel(topHour)}</span>
        </p>
        {bars(byHour, HOURS.map((h) => (h % 6 === 0 ? hourLabel(h) : '')), HOURS.map((h, i) => `${hourLabel(h)}: ${byHour[i]}`), 'Listening by hour of day')}
      </div>
      <div>
        <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
          By weekday · most on <span className="font-medium text-gray-700 dark:text-gray-200">{DAY_NAMES[topDay].slice(0, 3)}</span>
        </p>
        {bars(byDay, DAYS.map((d) => DAY_NAMES[d].slice(0, 1)), DAYS.map((d, i) => `${DAY_NAMES[d]}: ${byDay[i]}`), 'Listening by weekday')}
      </div>
    </div>
  );
}
