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
  const [metric, setMetric] = useState<Metric>('plays');
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);

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
      title="Listening clock"
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
        <p className="text-xs text-gray-500">Nothing played in this period.</p>
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
        </>
      )}
    </ChartCard>
  );
}
