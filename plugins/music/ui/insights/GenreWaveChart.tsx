/**
 * Genres over time, as a wave (streamgraph): one smooth band per genre,
 * stacked around a centre line, its thickness the genre's plays in each week,
 * month or year of the period (the same bucket sizes as Discovery). The
 * period's eight most played genres get bands; everything else is summed in a
 * line of text below the chart, since one band for dozens of small genres
 * would dwarf the rest. Each play counts once, toward its main genre (its
 * first: most votes on MusicBrainz, or first in the user's edit), so
 * near-duplicates such as "electronic" and "edm" don't both swell the wave.
 *
 * Hovering (or holding a finger on) the chart opens a popup beside the
 * crosshair, like the weather chart's, with that moment's mix of genres;
 * clicking a band opens the genre.
 */

import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { music } from '../api';
import { genrePath, GenreLink } from '../links';
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
/** The same slots as swatches, for the popup. */
export const BAND_SWATCH = [
  'bg-[#2a78d6] dark:bg-[#3987e5]',
  'bg-[#eb6834] dark:bg-[#d95926]',
  'bg-[#1baf7a] dark:bg-[#199e70]',
  'bg-[#eda100] dark:bg-[#c98500]',
  'bg-[#e87ba4] dark:bg-[#d55181]',
  'bg-[#008300] dark:bg-[#008300]',
  'bg-[#6250d6] dark:bg-[#9085e9]',
  'bg-[#e34948] dark:bg-[#e66767]',
];

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
  /** Per band (genres in order): the lower and upper edge (in values) at each bucket. */
  bands: { lo: number[]; hi: number[] }[];
  /** Values to SVG y. */
  y: (v: number) => number;
}

/**
 * Stack the genre bands around a centre line ("silhouette"), scaled so the
 * thickest bucket fills the height. "Other" is not drawn.
 */
export function layoutWave(stream: Pick<GenreStream, 'buckets' | 'genres'>, width = W, height = H): WaveLayout {
  const n = stream.buckets.length;
  const series = stream.genres.map((_, g) => stream.buckets.map((b) => b.counts[g] ?? 0));
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

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const plays = (n: number) => `${n.toLocaleString()} play${n === 1 ? '' : 's'}`;

/** Genres listed in the popup; the rest of the moment is summed in one line. */
export const POPUP_ROWS = 5;

interface Hover {
  bucket: number;
  /** Band index, or null between bands. */
  band: number | null;
  /** Where across the chart the crosshair is, 0..1, to place the popup beside it. */
  fx: number;
}

/** One moment's mix: its genres, biggest first (the hovered one always listed), then what's left. */
export function momentRows(stream: Pick<GenreStream, 'genres' | 'buckets'>, bucket: number, hovered: number | null) {
  const b = stream.buckets[bucket];
  const total = b.counts.reduce((n, c) => n + c, 0) + b.other;
  const ranked = stream.genres
    .map((name, band) => ({ name, band, plays: b.counts[band] ?? 0 }))
    .filter((r) => r.plays > 0)
    .sort((x, y) => y.plays - x.plays || x.band - y.band);
  let rows = ranked.slice(0, POPUP_ROWS);
  const hoveredRow = ranked.find((r) => r.band === hovered);
  if (hoveredRow && !rows.includes(hoveredRow)) rows = [...rows.slice(0, POPUP_ROWS - 1), hoveredRow];
  const listed = rows.reduce((n, r) => n + r.plays, 0);
  return { total, rows, rest: total - listed };
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
  const layout = useMemo(() => (data && data.buckets.length && data.genres.length ? layoutWave(data) : null), [data]);

  const pick = (e: PointerEvent<SVGSVGElement>): Hover | null => {
    if (!layout) return null;
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const raw = (e.clientX - box.left) / box.width;
    if (raw < 0 || raw > 1) return null;
    const bucket = buckets.length === 1 ? 0 : Math.round(raw * (buckets.length - 1));
    // Which band is under the pointer, read against this bucket's edges.
    const sy = ((e.clientY - box.top) / box.height) * H;
    const band = layout.bands.findIndex((b) => sy <= layout.y(b.lo[bucket]) && sy >= layout.y(b.hi[bucket]));
    const fx = buckets.length === 1 ? 0.5 : bucket / (buckets.length - 1);
    return { bucket, band: band >= 0 ? band : null, fx };
  };
  const scrub = scrubHandlers<SVGSVGElement, Hover>(pick, setHover);

  const coverage = data && data.plays > 0 ? pct(data.plays_with_genres, data.plays) : 100;
  const moment = data && hover ? momentRows(data, hover.bucket, hover.band) : null;
  // Beside the crosshair, on whichever side has room (as the weather chart does).
  // Never wider than the room on that side, so it stays on screen on a phone.
  const popupStyle =
    hover == null
      ? undefined
      : hover.fx > 0.5
        ? { right: `calc(${(1 - hover.fx) * 100}% + 10px)`, maxWidth: `min(15rem, calc(${hover.fx * 100}% - 12px))` }
        : { left: `calc(${hover.fx * 100}% + 10px)`, maxWidth: `min(15rem, calc(${(1 - hover.fx) * 100}% - 12px))` };
  const other = data?.other;

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
            Plays per {data.bucket} by each play's main genre (its first listed).
            {coverage < 100 && ` ${coverage}% of plays have genres.`}
          </p>
          <div className="relative mt-2">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="block h-48 w-full"
              role="img"
              aria-label={`Plays per ${data.bucket} of the top genres`}
              {...scrub}
            >
              {layout &&
                genres.map((g, i) => (
                  <path
                    key={g}
                    d={bandPath(layout, i)}
                    className={`${BAND_FILL[i]} cursor-pointer stroke-white transition-opacity dark:stroke-gray-900`}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    opacity={hover?.band == null || hover.band === i ? 1 : 0.35}
                    onClick={() => navigate(genrePath(g))}
                  >
                    <title>{g}</title>
                  </path>
                ))}
              {layout && hover && (
                <line
                  x1={hover.fx * W}
                  x2={hover.fx * W}
                  y1={0}
                  y2={H}
                  className="pointer-events-none stroke-gray-500 dark:stroke-gray-400"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {hover && moment && (
              <div
                role="status"
                className="pointer-events-none absolute top-1 z-10 w-max rounded-lg border border-gray-200/70 bg-white/95 px-2.5 py-1.5 text-[11px] text-gray-600 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/95 dark:text-gray-300"
                style={popupStyle}
              >
                <div className="font-semibold text-gray-800 dark:text-gray-100">{bucketLabel(buckets[hover.bucket].start, data.bucket)}</div>
                {moment.rows.length === 0 && moment.rest === 0 ? (
                  <div>No plays with genres</div>
                ) : (
                  <ul className="mt-0.5 space-y-px">
                    {moment.rows.map((r) => (
                      <li
                        key={r.name}
                        className={`flex items-center gap-1.5 ${r.band === hover.band ? 'font-semibold text-gray-900 dark:text-gray-50' : ''}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-sm ${BAND_SWATCH[r.band]}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {r.plays.toLocaleString()} · {pct(r.plays, moment.total)}%
                        </span>
                      </li>
                    ))}
                    {moment.rest > 0 && (
                      <li className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                        <span className="h-2 w-2 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">Other genres</span>
                        <span className="shrink-0 tabular-nums">
                          {moment.rest.toLocaleString()} · {pct(moment.rest, moment.total)}%
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
            <span>{bucketLabel(buckets[0].start, data.bucket)}</span>
            {buckets.length > 1 && <span>{bucketLabel(buckets[buckets.length - 1].start, data.bucket)}</span>}
          </div>
          {other && other.plays > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Other genres, not drawn: {plays(other.plays)} across {other.genres.toLocaleString()} more genre
              {other.genres === 1 ? '' : 's'}
              {other.top.length > 0 && (
                <>
                  {' '}
                  (most:{' '}
                  {other.top.map((g, i) => (
                    <span key={g.name}>
                      {i > 0 && ', '}
                      <GenreLink name={g.name} /> <span className="tabular-nums">{g.plays.toLocaleString()}</span>
                    </span>
                  ))}
                  {other.genres > other.top.length ? ', …' : ''})
                </>
              )}
              .
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
