/**
 * Genres over time, as a wave (streamgraph): one smooth band per genre,
 * stacked around a centre line, its thickness the genre's plays in each week,
 * month or year of the period (the same bucket sizes as Discovery). The
 * period's eight most played genres get bands of their own; the rest share a
 * grey "Other" band. A play counts toward each of its genres.
 *
 * Hover (or scrub with a finger) to read a band at that point; click a band
 * to open the genre.
 */

import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { music } from '../api';
import { genrePath } from '../links';
import type { GenreStream } from '../types';
import { ChartCard } from './ChartCard';
import { bucketLabel } from './DiscoveryChart';
import { scrubHandlers } from './scrub';

/**
 * The validated categorical order (light / dark steps), one slot per band in
 * stacking order, so neighbouring bands are the pairs the palette was checked
 * for. Written out in full so Tailwind emits them.
 */
export const BAND_FILL = [
  'fill-[#2a78d6] dark:fill-[#3987e5]',
  'fill-[#eb6834] dark:fill-[#d95926]',
  'fill-[#1baf7a] dark:fill-[#199e70]',
  'fill-[#eda100] dark:fill-[#c98500]',
  'fill-[#e87ba4] dark:fill-[#d55181]',
  'fill-[#008300] dark:fill-[#008300]',
  'fill-[#6250d6] dark:fill-[#9085e9]',
  'fill-[#e34948] dark:fill-[#e66767]',
];
const OTHER_FILL = 'fill-[#bdbcb4] dark:fill-[#5c5b56]';

const W = 600;
const H = 200;

type Point = [number, number];

/**
 * A uniform cubic B-spline through `points` (d3's curveBasis): it starts and
 * ends on the end points and smooths everything between. Each point of the
 * curve is a weighted average of nearby points with non-negative weights, so
 * two boundaries that never cross at the data never cross between them either:
 * a band's thickness never goes negative.
 */
export function basisPath(points: Point[], start: 'M' | 'L' = 'M'): string {
  if (points.length === 0) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  const [x0, y0] = points[0];
  let d = `${start}${f(x0)},${f(y0)}`;
  if (points.length === 1) return d;
  if (points.length === 2) return `${d}L${f(points[1][0])},${f(points[1][1])}`;
  const p = points;
  d += `L${f((5 * p[0][0] + p[1][0]) / 6)},${f((5 * p[0][1] + p[1][1]) / 6)}`;
  for (let i = 2; i <= p.length; i++) {
    const a = p[i - 2];
    const b = p[i - 1];
    const c = p[Math.min(i, p.length - 1)];
    d +=
      `C${f((2 * a[0] + b[0]) / 3)},${f((2 * a[1] + b[1]) / 3)} ` +
      `${f((a[0] + 2 * b[0]) / 3)},${f((a[1] + 2 * b[1]) / 3)} ` +
      `${f((a[0] + 4 * b[0] + c[0]) / 6)},${f((a[1] + 4 * b[1] + c[1]) / 6)}`;
  }
  return `${d}L${f(p[p.length - 1][0])},${f(p[p.length - 1][1])}`;
}

export interface WaveLayout {
  /** x of each bucket, left to right across the full width. */
  xs: number[];
  /** Per band (genres in order, then Other): the lower and upper edge (in values) at each bucket. */
  bands: { lo: number[]; hi: number[] }[];
  /** Values to SVG y. */
  y: (v: number) => number;
}

/** Stack the bands around a centre line ("silhouette"), scaled so the thickest bucket fills the height. */
export function layoutWave(stream: Pick<GenreStream, 'buckets' | 'genres'>, width = W, height = H): WaveLayout {
  const n = stream.buckets.length;
  const series = [...stream.genres.map((_, g) => stream.buckets.map((b) => b.counts[g] ?? 0)), stream.buckets.map((b) => b.other)];
  const totals = stream.buckets.map((_, i) => series.reduce((s, band) => s + band[i], 0));
  const max = Math.max(...totals, 1);
  const xs = n === 1 ? [0] : stream.buckets.map((_, i) => (i / (n - 1)) * width);
  const running = totals.map((t) => -t / 2);
  const bands = series.map((band) => {
    const lo = running.slice();
    band.forEach((v, i) => (running[i] += v));
    return { lo, hi: running.slice() };
  });
  // Leave a little room so the outer edges don't touch the frame.
  const k = (height - 8) / max;
  return { xs, bands, y: (v) => height / 2 - v * k };
}

function bandPath(layout: WaveLayout, band: number): string {
  const { xs, bands, y } = layout;
  const { lo, hi } = bands[band];
  // A single bucket is drawn as a flat band across the whole width.
  const xsOf = xs.length === 1 ? [0, W] : xs;
  const at = (vals: number[]) => (xs.length === 1 ? [vals[0], vals[0]] : vals);
  const upper = xsOf.map((x, i): Point => [x, y(at(hi)[i])]);
  const lower = xsOf.map((x, i): Point => [x, y(at(lo)[i])]).reverse();
  return `${basisPath(upper)}${basisPath(lower, 'L')}Z`;
}

const plural = (n: number) => `${n.toLocaleString()} play${n === 1 ? '' : 's'}`;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

interface Hover {
  bucket: number;
  /** Band index (Other = genres.length), or null between bands. */
  band: number | null;
}

export function GenreWaveChart({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<GenreStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .genreStream(from, to)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
        setHover(null);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const buckets = data?.buckets ?? [];
  const genres = data?.genres ?? [];
  const layout = useMemo(() => (data && data.buckets.length ? layoutWave(data) : null), [data]);
  const hasOther = buckets.some((b) => b.other > 0);
  const bandCount = genres.length + (hasOther ? 1 : 0);

  const pick = (e: PointerEvent<SVGSVGElement>): Hover | null => {
    if (!layout) return null;
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const fx = (e.clientX - box.left) / box.width;
    const bucket = buckets.length === 1 ? 0 : Math.round(fx * (buckets.length - 1));
    if (bucket < 0 || bucket >= buckets.length) return null;
    // Which band is under the pointer, read against this bucket's edges.
    const sy = ((e.clientY - box.top) / box.height) * H;
    const band = layout.bands.findIndex((b, i) => i < bandCount && sy <= layout.y(b.lo[bucket]) && sy >= layout.y(b.hi[bucket]));
    return { bucket, band: band >= 0 ? band : null };
  };
  const scrub = scrubHandlers<SVGSVGElement, Hover>(pick, setHover);

  const describe = (h: Hover): string => {
    const b = buckets[h.bucket];
    const when = bucketLabel(b.start, data!.bucket);
    const total = b.counts.reduce((n, c) => n + c, 0) + b.other;
    if (h.band != null && h.band < genres.length) {
      const n = b.counts[h.band];
      return `${when} · ${genres[h.band]}: ${plural(n)} (${pct(n, total)}%)`;
    }
    if (h.band === genres.length) {
      const named = b.other_top.map((o) => `${o.name} ${o.plays.toLocaleString()}`).join(', ');
      return `${when} · Other: ${plural(b.other)}${named ? ` (most: ${named})` : ''}`;
    }
    const top = genres
      .map((g, i) => ({ g, n: b.counts[i] }))
      .filter((x) => x.n > 0)
      .slice(0, 3)
      .map((x) => `${x.g} ${x.n.toLocaleString()}`)
      .join(', ');
    return `${when} · ${top || 'no plays with genres'}`;
  };

  const coverage = data && data.plays > 0 ? pct(data.plays_with_genres, data.plays) : 100;

  return (
    <ChartCard title="Genres over time" icon={Waves} loading={loading}>
      {error ? (
        <p className="text-xs text-red-500">Couldn't load genres.</p>
      ) : !data || data.plays === 0 ? (
        !loading && <p className="text-xs text-gray-500">Nothing played in this period.</p>
      ) : data.plays_with_genres === 0 ? (
        <p className="text-xs text-gray-500">
          None of this period's plays have genres yet. Look them up in{' '}
          <Link to="/settings?tab=plugin:music" className="font-medium text-primary-600 hover:underline">
            Settings → Music
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Plays per {data.bucket} for the period's top genres. A play counts toward each of its genres.
            {coverage < 100 && ` ${coverage}% of plays have genres.`}
          </p>
          <p className="mt-1 min-h-4 text-xs tabular-nums text-gray-600 dark:text-gray-300" aria-live="polite">
            {hover ? describe(hover) : ''}
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="mt-1 block h-48 w-full"
            role="img"
            aria-label={`Plays per ${data.bucket} of the top genres`}
            {...scrub}
          >
            {layout &&
              Array.from({ length: bandCount }, (_, i) => (
                <path
                  key={i < genres.length ? genres[i] : 'other'}
                  d={bandPath(layout, i)}
                  className={`${i < genres.length ? `${BAND_FILL[i]} cursor-pointer` : OTHER_FILL} stroke-white transition-opacity dark:stroke-gray-900`}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={hover?.band == null || hover.band === i ? 1 : 0.35}
                  onClick={i < genres.length ? () => navigate(genrePath(genres[i])) : undefined}
                >
                  <title>{i < genres.length ? genres[i] : 'Other'}</title>
                </path>
              ))}
            {layout && hover && (
              <line
                x1={layout.xs.length === 1 ? W / 2 : layout.xs[hover.bucket]}
                x2={layout.xs.length === 1 ? W / 2 : layout.xs[hover.bucket]}
                y1={0}
                y2={H}
                className="pointer-events-none stroke-gray-500 dark:stroke-gray-400"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
            <span>{bucketLabel(buckets[0].start, data.bucket)}</span>
            {buckets.length > 1 && <span>{bucketLabel(buckets[buckets.length - 1].start, data.bucket)}</span>}
          </div>
        </>
      )}
    </ChartCard>
  );
}
