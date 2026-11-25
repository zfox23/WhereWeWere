/**
 * Exploring or comfort-listening: per week, month or year of the period,
 * plays of songs first heard in that bucket ("new") stacked under the rest
 * ("familiar"), plus how many songs, artists and genres were new to you.
 */

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { music } from '../api';
import type { Discovery, DiscoveryBucket, DiscoveryBucketSize } from '../types';
import { ChartCard } from './ChartCard';
import { columnAt, scrubHandlers } from './scrub';

// Validated pair (pink-600 / sky-600): passes CVD and contrast checks in light and dark.
const NEW = 'fill-pink-600';
const FAMILIAR = 'fill-sky-600';

export function bucketLabel(start: string, size: DiscoveryBucketSize): string {
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'UTC' }).format(date);
  if (size === 'year') return String(y);
  if (size === 'month') return fmt({ month: 'short', year: 'numeric' });
  return `Week of ${fmt({ month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function describe(b: DiscoveryBucket, size: DiscoveryBucketSize): string {
  return `${bucketLabel(b.start, size)}: ${plural(b.new_plays, 'new play')}, ${plural(b.familiar_plays, 'familiar play')} · ${plural(
    b.new_songs,
    'new song',
  )}, ${plural(b.new_artists, 'new artist')}${b.new_genres ? `, ${plural(b.new_genres, 'new genre')}` : ''}`;
}

export function DiscoveryChart({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .discovery(from, to)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const buckets = data?.buckets ?? [];
  const totals = data?.totals;
  const W = 600;
  const H = 120;
  const slot = buckets.length ? W / buckets.length : W;
  const gap = slot > 6 ? 2 : 0;
  const max = Math.max(...buckets.map((b) => b.new_plays + b.familiar_plays), 1);
  const scale = (n: number) => (n / max) * (H - 2);
  const scrub = scrubHandlers<SVGSVGElement, number>((e) => columnAt(e, buckets.length), setHover);

  return (
    <ChartCard title="Discovery" icon={Sparkles} loading={loading}>
      {error ? (
        <p className="text-xs text-red-500">Couldn't load discovery.</p>
      ) : !totals || totals.plays === 0 ? (
        !loading && <p className="text-xs text-gray-500">Nothing played in this period.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold">{pct(totals.new_plays, totals.plays)}%</span> of plays were songs new to you ·{' '}
            {plural(totals.new_songs, 'new song')} · {plural(totals.new_artists, 'new artist')}
            {(totals.new_genres ?? 0) > 0 && <> · {plural(totals.new_genres, 'new genre')}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-pink-600" /> New to you
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-sky-600" /> Familiar
            </span>
          </div>
          <p className="mt-1 min-h-4 text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-live="polite">
            {hover != null && buckets[hover] ? describe(buckets[hover], data!.bucket) : ''}
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="mt-1 block h-32 w-full"
            role="img"
            aria-label={`New and familiar plays per ${data!.bucket}`}
            {...scrub}
          >
            <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
            {buckets.map((b, i) => {
              const x = i * slot + gap / 2;
              const w = Math.max(slot - gap, 1);
              const hn = scale(b.new_plays);
              const hf = scale(b.familiar_plays);
              // A 2px surface gap between the two segments when both are drawn.
              const seam = hn > 0 && hf > 0 ? 2 : 0;
              return (
                <g key={b.start} opacity={hover == null || hover === i ? 1 : 0.55}>
                  {hn > 0 && <rect x={x} y={H - hn} width={w} height={hn} className={NEW} />}
                  {hf > seam && <rect x={x} y={H - hn - hf} width={w} height={hf - seam} className={FAMILIAR} />}
                  <title>{describe(b, data!.bucket)}</title>
                </g>
              );
            })}
          </svg>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
            <span>{bucketLabel(buckets[0].start, data!.bucket)}</span>
            {buckets.length > 1 && <span>{bucketLabel(buckets[buckets.length - 1].start, data!.bucket)}</span>}
          </div>
        </>
      )}
    </ChartCard>
  );
}
