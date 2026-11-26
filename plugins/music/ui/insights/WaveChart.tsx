/**
 * The wave (streamgraph) shared by Genres over time and the plays-over-time
 * charts of album, artist, playlist and list pages: up to eight smooth bands
 * stacked around a centre line, each band's thickness its plays per week,
 * month or year. Whatever isn't a band ("Other") is not drawn; the caller
 * sums it beside the chart, and the popup counts it.
 *
 * Hovering (or holding a finger on) the chart opens a popup beside the
 * crosshair, like the weather chart's, with that moment's total and mix.
 * Clicking a band can open what it stands for.
 */

import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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

/** What a wave draws: band names (most played first) and, per bucket, each band's plays and the rest. */
export interface WaveData {
  names: string[];
  buckets: { counts: number[]; other: number }[];
}

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
  /** Per band: the lower and upper edge (in values) at each bucket. */
  bands: { lo: number[]; hi: number[] }[];
  /** Values to SVG y. */
  y: (v: number) => number;
}

/**
 * Stack the bands around a centre line ("silhouette"), scaled so the thickest
 * bucket fills the height. "Other" is not drawn.
 */
export function layoutWave(data: WaveData, width = W, height = H): WaveLayout {
  const n = data.buckets.length;
  const series = data.names.map((_, g) => data.buckets.map((b) => b.counts[g] ?? 0));
  const totals = data.buckets.map((_, i) => series.reduce((s, band) => s + band[i], 0));
  const max = Math.max(...totals, 1);
  const xs = n === 1 ? [0] : data.buckets.map((_, i) => (i / (n - 1)) * width);
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

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Rows listed in the popup; the rest of the moment is summed in one line. */
export const POPUP_ROWS = 5;

/** One moment's mix: its bands, biggest first (the hovered one always listed), then what's left. */
export function momentRows(data: WaveData, bucket: number, hovered: number | null) {
  const b = data.buckets[bucket];
  const total = b.counts.reduce((n, c) => n + c, 0) + b.other;
  const ranked = data.names
    .map((name, band) => ({ name, band, plays: b.counts[band] ?? 0 }))
    .filter((r) => r.plays > 0)
    .sort((x, y) => y.plays - x.plays || x.band - y.band);
  let rows = ranked.slice(0, POPUP_ROWS);
  const hoveredRow = ranked.find((r) => r.band === hovered);
  if (hoveredRow && !rows.includes(hoveredRow)) rows = [...rows.slice(0, POPUP_ROWS - 1), hoveredRow];
  const listed = rows.reduce((n, r) => n + r.plays, 0);
  return { total, rows, rest: total - listed };
}

interface Hover {
  bucket: number;
  /** Band index, or null between bands. */
  band: number | null;
  /** Where across the chart the crosshair is, 0..1, to place the popup beside it. */
  fx: number;
}

export function WaveChart({
  data,
  label,
  ariaLabel,
  otherLabel,
  bandHref,
}: {
  data: WaveData;
  /** A bucket's name ("Mar 2024"), for the popup and the axis. */
  label: (bucket: number) => string;
  ariaLabel: string;
  /** The popup's line for what isn't a band ("Other genres"). */
  otherLabel: string;
  /** Where clicking a band goes. */
  bandHref?: (band: number) => string | null;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const navigate = useNavigate();
  const layout = useMemo(() => (data.buckets.length && data.names.length ? layoutWave(data) : null), [data]);
  const n = data.buckets.length;
  // New data (another period or grouping) starts without a hover.
  useEffect(() => setHover(null), [data]);

  const pick = (e: PointerEvent<SVGSVGElement>): Hover | null => {
    if (!layout) return null;
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const raw = (e.clientX - box.left) / box.width;
    if (raw < 0 || raw > 1) return null;
    const bucket = n === 1 ? 0 : Math.round(raw * (n - 1));
    // Which band is under the pointer, read against this bucket's edges.
    const sy = ((e.clientY - box.top) / box.height) * H;
    const band = layout.bands.findIndex((b) => sy <= layout.y(b.lo[bucket]) && sy >= layout.y(b.hi[bucket]));
    const fx = n === 1 ? 0.5 : bucket / (n - 1);
    return { bucket, band: band >= 0 ? band : null, fx };
  };
  const scrub = scrubHandlers<SVGSVGElement, Hover>(pick, setHover);

  const current = hover && hover.bucket < n ? hover : null;
  const moment = current ? momentRows(data, current.bucket, current.band) : null;
  // Beside the crosshair, on whichever side has room (as the weather chart does),
  // and never wider than that room, so it stays on screen on a phone.
  const popupStyle =
    current == null
      ? undefined
      : current.fx > 0.5
        ? { right: `calc(${(1 - current.fx) * 100}% + 10px)`, maxWidth: `min(15rem, calc(${current.fx * 100}% - 12px))` }
        : { left: `calc(${current.fx * 100}% + 10px)`, maxWidth: `min(15rem, calc(${(1 - current.fx) * 100}% - 12px))` };

  if (n === 0) return null;
  return (
    <>
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-48 w-full"
          role="img"
          aria-label={ariaLabel}
          {...scrub}
        >
          {layout &&
            data.names.map((name, i) => {
              const href = bandHref?.(i) ?? null;
              return (
                <path
                  key={i}
                  d={bandPath(layout, i)}
                  className={`${BAND_FILL[i]} ${href ? 'cursor-pointer' : ''} stroke-white transition-opacity dark:stroke-gray-900`}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={current?.band == null || current.band === i ? 1 : 0.35}
                  onClick={href ? () => navigate(href) : undefined}
                >
                  <title>{name}</title>
                </path>
              );
            })}
          {layout && current && (
            <line
              x1={current.fx * W}
              x2={current.fx * W}
              y1={0}
              y2={H}
              className="pointer-events-none stroke-gray-500 dark:stroke-gray-400"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {current && moment && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 w-max rounded-lg border border-gray-200/70 bg-white/95 px-2.5 py-1.5 text-[11px] text-gray-600 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/95 dark:text-gray-300"
            style={popupStyle}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-gray-800 dark:text-gray-100">{label(current.bucket)}</span>
              {moment.total > 0 && (
                <span className="tabular-nums">
                  {moment.total.toLocaleString()} play{moment.total === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {moment.total === 0 ? (
              <div>No plays</div>
            ) : (
              <ul className="mt-0.5 space-y-px">
                {moment.rows.map((r) => (
                  <li
                    key={r.band}
                    className={`flex items-center gap-1.5 ${r.band === current.band ? 'font-semibold text-gray-900 dark:text-gray-50' : ''}`}
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
                    <span className="min-w-0 flex-1 truncate">{otherLabel}</span>
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
        <span>{label(0)}</span>
        {n > 1 && <span>{label(n - 1)}</span>}
      </div>
    </>
  );
}
