/**
 * Plays over time for a song, artist or album: one bar per week, month or
 * year (switchable), zero-filled from the first play to the last. With
 * `onSelect`, each bar is a button choosing its period (the song page filters
 * its plays to it); bars inside `selected` are highlighted.
 */

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { DayCount } from '../types';
import { ChartCard, Toggle } from './ChartCard';
import { scrubHandlers } from './scrub';
import { bucketize, bucketLabel, type Bucket, type BucketCount } from './timeline';

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const plural = (n: number) => `${n.toLocaleString()} play${n === 1 ? '' : 's'}`;

export function PlaysOverTime({
  daily,
  bucket,
  onBucketChange,
  selected = null,
  onSelect,
  title = 'Plays over time',
}: {
  daily: DayCount[];
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
  /** Local dates (inclusive) whose bars are highlighted. */
  selected?: { from: string; to: string } | null;
  onSelect?: (b: BucketCount) => void;
  title?: string;
}) {
  const bars = useMemo(() => bucketize(daily, bucket), [daily, bucket]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.plays), 1);
  const inSelection = (b: BucketCount) => selected != null && b.start <= selected.to && b.end >= selected.from;
  const peak = bars.reduce<BucketCount | null>((best, b) => (b.plays > (best?.plays ?? 0) ? b : best), null);
  const shown = hover != null ? bars[hover] : null;
  const scrub = scrubHandlers<HTMLDivElement, number>((e) => {
    const el = document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null;
    const i = el?.closest<HTMLElement>('[data-bar]')?.dataset.bar;
    return i != null ? Number(i) : null;
  }, setHover);

  return (
    <ChartCard
      title={title}
      icon={BarChart3}
      controls={<Toggle label="Group plays by" value={bucket} onChange={onBucketChange} options={BUCKETS} />}
    >
      {bars.length === 0 ? (
        <p className="text-xs text-gray-500">No plays yet.</p>
      ) : (
        <>
          <p className="mb-1 min-h-4 text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-live="polite">
            {shown
              ? `${bucketLabel(shown, bucket)} · ${plural(shown.plays)}`
              : peak
                ? `Peak: ${bucketLabel(peak, bucket)} · ${plural(peak.plays)}`
                : ''}
          </p>
          <div
            role="group"
            aria-label={`Plays per ${bucket} from ${bucketLabel(bars[0], bucket)} to ${bucketLabel(bars[bars.length - 1], bucket)}`}
            className={`flex h-28 items-end border-b border-gray-200 dark:border-gray-700 ${bars.length > 120 ? '' : 'gap-px'}`}
            {...scrub}
          >
            {bars.map((b, i) => {
              const pct = b.plays ? Math.max((b.plays / max) * 100, 3) : 0;
              const label = `${bucketLabel(b, bucket)}: ${plural(b.plays)}`;
              const active = hover === i || inSelection(b);
              const bar = (
                <span
                  className={`block w-full rounded-t-sm transition-colors ${
                    active ? 'bg-pink-600 dark:bg-pink-300' : selected ? 'bg-pink-300/70 dark:bg-pink-700/70' : 'bg-pink-400/80'
                  }`}
                  style={{ height: `${pct}%` }}
                />
              );
              const common = {
                'data-bar': i,
                title: label,
                className: 'flex h-full min-w-0 flex-1 items-end',
                onMouseEnter: () => setHover(i),
              };
              return onSelect ? (
                <button
                  key={b.start}
                  type="button"
                  {...common}
                  aria-label={`${label}. Show these plays`}
                  aria-pressed={inSelection(b)}
                  onClick={() => onSelect(b)}
                  className={`${common.className} cursor-pointer focus-visible:outline-2 focus-visible:outline-pink-400`}
                >
                  {bar}
                </button>
              ) : (
                <span key={b.start} {...common}>
                  {bar}
                </span>
              );
            })}
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
            <span>{bucketLabel(bars[0], bucket)}</span>
            {bars.length > 1 && <span>{bucketLabel(bars[bars.length - 1], bucket)}</span>}
          </div>
          {onSelect && <p className="mt-1 text-[11px] text-gray-400">Click a bar to show its plays below.</p>}
        </>
      )}
    </ChartCard>
  );
}
