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
 *
 * Zoom and pan (time only): Ctrl/⌘ + scroll or a trackpad pinch zooms around
 * the pointer and dragging pans; on a touch screen two fingers pinch and pan,
 * while one finger still moves the popup. A plain scroll scrolls the page.
 * Zoomed in, the grouping gets finer on its own (years → months → weeks →
 * days); zooming all the way out is the full view again. The bands stay the
 * same at any zoom, and the height fits what's visible.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { scrubHandlers } from './scrub';
import { bucketEnd, bucketLabel, bucketStart, type Bucket } from './timeline';

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
export function layoutWave(data: WaveData, width = W, height = H, xs?: number[]): WaveLayout {
  const n = data.buckets.length;
  const series = data.names.map((_, g) => data.buckets.map((b) => b.counts[g] ?? 0));
  const totals = data.buckets.map((_, i) => series.reduce((s, band) => s + band[i], 0));
  const max = Math.max(...totals, 1);
  const at = xs ?? (n === 1 ? [0] : data.buckets.map((_, i) => (i / (n - 1)) * width));
  const running = totals.map((t) => -t / 2);
  const bands = series.map((band) => {
    const lo = running.slice();
    band.forEach((v, i) => (running[i] += v));
    return { lo, hi: running.slice() };
  });
  // Leave a little room so the outer edges don't touch the frame.
  const k = (height - 8) / max;
  return { xs: at, bands, y: (v) => height / 2 - v * k };
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

// ---------------------------------------------------------------------------
// Days, groups and zoom
// ---------------------------------------------------------------------------

/** What the chart is given: plays per day, dense from `first`, for each band and the rest. */
export interface WaveSeries {
  /** The first day ('YYYY-MM-DD') of every array below. */
  first: string;
  names: string[];
  /** Per band, plays per day; all arrays as long as `other`. */
  bands: number[][];
  other: number[];
}

export type WaveBucket = Bucket | 'day';

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS);
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Dense days from sparse per-day counts (several series on one axis). */
export function denseSeries(names: string[], bands: { date: string; plays: number }[][], other: { date: string; plays: number }[]): WaveSeries | null {
  const all = [...bands.flat(), ...other].map((d) => dayNumber(d.date));
  if (all.length === 0) return null;
  const first = Math.min(...all);
  const days = Math.max(...all) - first + 1;
  const fill = (daily: { date: string; plays: number }[]) => {
    const out = new Array<number>(days).fill(0);
    for (const d of daily) out[dayNumber(d.date) - first] += d.plays;
    return out;
  };
  return { first: dayString(first), names, bands: bands.map(fill), other: fill(other) };
}

const startOf = (date: string, g: WaveBucket) => (g === 'day' ? date : bucketStart(date, g));
const endOf = (start: string, g: WaveBucket) => (g === 'day' ? start : bucketEnd(start, g));

export interface Grouped {
  data: WaveData;
  /** Each group's first and last day. */
  ranges: { start: string; end: string }[];
  /** Each group's middle, in days since 1970: where it is drawn. */
  centers: number[];
}

/** The days grouped by `g`; a group sticking out past the data still counts only the days there are. */
export function groupWave(series: WaveSeries, g: WaveBucket): Grouped {
  const out: Grouped = { data: { names: series.names, buckets: [] }, ranges: [], centers: [] };
  const first = dayNumber(series.first);
  let current = '';
  for (let i = 0; i < series.other.length; i++) {
    const s = startOf(dayString(first + i), g);
    if (s !== current) {
      current = s;
      const e = endOf(s, g);
      out.ranges.push({ start: s, end: e });
      out.centers.push((dayNumber(s) + dayNumber(e) + 1) / 2);
      out.data.buckets.push({ counts: series.bands.map(() => 0), other: 0 });
    }
    const b = out.data.buckets[out.data.buckets.length - 1];
    series.bands.forEach((band, k) => (b.counts[k] += band[i] ?? 0));
    b.other += series.other[i] ?? 0;
  }
  return out;
}

const COARSE_TO_FINE: WaveBucket[] = ['year', 'month', 'week', 'day'];
const GROUP_DAYS: Record<WaveBucket, number> = { year: 365.25, month: 30.44, week: 7, day: 1 };
/** Fewest groups worth drawing before going finer. */
export const MIN_POINTS = 8;
/** The narrowest view, in days. */
export const MIN_SPAN_DAYS = 14;

/** The grouping for a view `spanDays` wide: `base` or finer, until there are enough groups to draw. */
export function chooseBucket(base: Bucket, spanDays: number): WaveBucket {
  let i = COARSE_TO_FINE.indexOf(base);
  while (i < COARSE_TO_FINE.length - 1 && spanDays / GROUP_DAYS[COARSE_TO_FINE[i]] < MIN_POINTS) i++;
  return COARSE_TO_FINE[i];
}

export interface View {
  t0: number;
  t1: number;
}

/** A view of `span` days starting at `t0`, kept inside [d0, d1]; null when it covers it all (the full view). */
export function clampView(t0: number, span: number, d0: number, d1: number): View | null {
  const full = d1 - d0;
  if (full <= 0) return null;
  const width = Math.max(Math.min(span, full), Math.min(MIN_SPAN_DAYS, full));
  if (width >= full - 1e-6) return null;
  const start = Math.min(Math.max(t0, d0), d1 - width);
  return { t0: start, t1: start + width };
}

const label = (r: { start: string; end: string }, g: WaveBucket) =>
  g === 'day'
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${r.start}T00:00:00Z`))
    : bucketLabel(r, g);

/** Whether the scroll hint has been shown on this page load. */
let hinted = false;
export const resetZoomHint = () => {
  hinted = false;
};

interface Hover {
  /** Index into the visible groups. */
  index: number;
  /** Band index, or null between bands. */
  band: number | null;
  /** Where across the chart the crosshair is, 0..1, to place the popup beside it. */
  fx: number;
}

export function WaveChart({
  series,
  base,
  caption,
  ariaLabel,
  otherLabel,
  bandHref,
  onViewRange,
}: {
  series: WaveSeries;
  /** The grouping of the full view; zooming in goes finer. */
  base: Bucket;
  /** Above the chart, told the grouping in use. */
  caption?: (g: WaveBucket) => ReactNode;
  ariaLabel: (g: WaveBucket) => string;
  /** The popup's line for what isn't a band ("Other genres"). */
  otherLabel: string;
  /** Where clicking a band goes. */
  bandHref?: (band: number) => string | null;
  /** Told the first and last day of the groups in view, whenever they change. */
  onViewRange?: (range: { from: string; to: string }) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hint, setHint] = useState(false);
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // The full view's groups set the zoomable range: first group's middle to the last's.
  const baseGroups = useMemo(() => groupWave(series, base), [series, base]);
  const d0 = baseGroups.centers[0] ?? 0;
  const d1 = baseGroups.centers[baseGroups.centers.length - 1] ?? 0;
  const g: WaveBucket = view ? chooseBucket(base, view.t1 - view.t0) : base;
  const groups = useMemo(() => (g === base ? baseGroups : groupWave(series, g)), [series, g, base, baseGroups]);

  // Other days or another grouping start at the full view. New bands over the
  // same days (re-picked for the stretch in view) keep the zoom.
  const domainKey = `${series.first}|${series.other.length}|${base}`;
  useEffect(() => {
    setView(null);
  }, [domainKey]);
  useEffect(() => setHover(null), [series, base]);

  const t0 = view?.t0 ?? d0;
  const t1 = view?.t1 ?? d1;
  const single = baseGroups.centers.length === 1;

  // What's drawn: the groups in view and one beyond each edge, so bands run off the sides.
  const visible = useMemo(() => {
    const idx = groups.centers.map((c, i) => ({ c, i })).filter(({ c }) => c >= t0 - 1e-9 && c <= t1 + 1e-9).map(({ i }) => i);
    if (idx.length === 0) return { from: 0, to: -1, inView: [] as number[] };
    return { from: Math.max(0, idx[0] - 1), to: Math.min(groups.centers.length - 1, idx[idx.length - 1] + 1), inView: idx };
  }, [groups, t0, t1]);
  const slice = useMemo<WaveData>(
    () => ({ names: groups.data.names, buckets: groups.data.buckets.slice(visible.from, visible.to + 1) }),
    [groups, visible],
  );
  const xAt = (c: number) => (single ? W / 2 : ((c - t0) / (t1 - t0)) * W);
  const xs = useMemo(
    () => (single ? undefined : groups.centers.slice(visible.from, visible.to + 1).map(xAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, visible, t0, t1, single],
  );
  const layout = useMemo(() => (slice.buckets.length && slice.names.length ? layoutWave(slice, W, H, xs) : null), [slice, xs]);

  // ---- Zoom and pan --------------------------------------------------------

  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const span = () => (viewRef.current ? viewRef.current.t1 - viewRef.current.t0 : d1 - d0);
  const start = () => viewRef.current?.t0 ?? d0;
  /** Zoom by `factor` (< 1 in), keeping the time under `fx` (0..1 across the chart) where it is. */
  const zoomAt = (factor: number, fx: number) => {
    const s = span();
    const anchor = start() + fx * s;
    const next = s * factor;
    setView(clampView(anchor - fx * next, next, d0, d1));
    setHover(null);
  };
  const panBy = (fraction: number, from: View | null) => {
    if (!from) return;
    setView(clampView(from.t0 - fraction * (from.t1 - from.t0), from.t1 - from.t0, d0, d1));
  };

  // Ctrl/⌘ + scroll (and trackpad pinches, which browsers send as Ctrl + scroll) zoom;
  // a plain scroll scrolls the page, with a hint the first time.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || single) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const box = svg.getBoundingClientRect();
        if (!box.width) return;
        zoomAt(Math.exp(e.deltaY * 0.01), Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
      } else if (!hinted) {
        hinted = true;
        setHint(true);
        window.setTimeout(() => setHint(false), 2500);
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d0, d1, single]);

  const drag = useRef<{ x: number; from: View | null; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: number; t0: number; span: number } | null>(null);

  const fxOf = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return box.width ? (e.clientX - box.left) / box.width : 0;
  };
  const twoFingers = (box: DOMRect) => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: ((a.x + b.x) / 2 - box.left) / box.width };
  };

  // ---- Hover ---------------------------------------------------------------

  const pick = (e: PointerEvent<SVGSVGElement>): Hover | null => {
    if (!layout || visible.inView.length === 0) return null;
    const fx = fxOf(e);
    if (fx < 0 || fx > 1) return null;
    const box = e.currentTarget.getBoundingClientRect();
    // The group in view whose middle is nearest the pointer.
    const at = single ? 0 : t0 + fx * (t1 - t0);
    const nearest = visible.inView.reduce((best, i) => (Math.abs(groups.centers[i] - at) < Math.abs(groups.centers[best] - at) ? i : best));
    const index = nearest - visible.from;
    const sy = box.height ? ((e.clientY - box.top) / box.height) * H : -1;
    const band = layout.bands.findIndex((b) => sy <= layout.y(b.lo[index]) && sy >= layout.y(b.hi[index]));
    return { index, band: band >= 0 ? band : null, fx: single ? 0.5 : xAt(groups.centers[nearest]) / W };
  };
  const scrub = scrubHandlers<SVGSVGElement, Hover>(pick, setHover);

  const handlers = {
    style: scrub.style,
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      dragged.current = false;
      if (e.pointerType === 'mouse') {
        if (e.button === 0 && !single) {
          drag.current = { x: e.clientX, from: viewRef.current, moved: false };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        scrub.onPointerDown(e);
        return;
      }
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2 && !single) {
        const box = e.currentTarget.getBoundingClientRect();
        if (box.width) pinch.current = { ...twoFingers(box), t0: start(), span: span() };
        setHover(null);
        return;
      }
      if (touches.current.size === 1) scrub.onPointerDown(e);
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      if (e.pointerType !== 'mouse' && touches.current.has(e.pointerId)) {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pinch.current;
        if (p && touches.current.size >= 2) {
          const box = e.currentTarget.getBoundingClientRect();
          const now = twoFingers(box);
          const next = now.dist > 0 ? p.span * (p.dist / now.dist) : p.span;
          // The time under the fingers' first midpoint follows their midpoint now.
          const anchor = p.t0 + p.mid * p.span;
          setView(clampView(anchor - now.mid * next, next, d0, d1));
          return;
        }
      }
      const d = drag.current;
      if (e.pointerType === 'mouse' && d && e.buttons & 1) {
        const box = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > 3) d.moved = true;
        if (d.moved && box.width) {
          dragged.current = true;
          setHover(null);
          panBy(dx / box.width, d.from);
          return;
        }
      }
      if (!pinch.current) scrub.onPointerMove(e);
    },
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      if (e.pointerType === 'mouse') drag.current = null;
      scrub.onPointerUp(e);
    },
    onPointerCancel: (e: PointerEvent<SVGSVGElement>) => {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      drag.current = null;
      scrub.onPointerCancel(e);
    },
    onPointerLeave: (e: PointerEvent<SVGSVGElement>) => {
      if (!drag.current) scrub.onPointerLeave(e);
    },
  };

  // ---- Drawing -------------------------------------------------------------

  const current = hover && hover.index < slice.buckets.length ? hover : null;
  const moment = current ? momentRows(slice, current.index, current.band) : null;
  // Beside the crosshair, on whichever side has room (as the weather chart does),
  // and never wider than that room, so it stays on screen on a phone.
  const popupStyle =
    current == null
      ? undefined
      : current.fx > 0.5
        ? { right: `calc(${(1 - current.fx) * 100}% + 10px)`, maxWidth: `min(15rem, calc(${current.fx * 100}% - 12px))` }
        : { left: `calc(${current.fx * 100}% + 10px)`, maxWidth: `min(15rem, calc(${(1 - current.fx) * 100}% - 12px))` };

  const firstInView = visible.inView[0];
  const lastInView = visible.inView[visible.inView.length - 1];
  const rangeFrom = firstInView != null ? groups.ranges[firstInView].start : null;
  const rangeTo = lastInView != null ? groups.ranges[lastInView].end : null;
  useEffect(() => {
    if (rangeFrom && rangeTo) onViewRange?.({ from: rangeFrom, to: rangeTo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo]);

  if (baseGroups.centers.length === 0) return null;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

  return (
    <>
      {caption && <p className="text-xs text-gray-500 dark:text-gray-400">{caption(g)}</p>}
      <div className="relative mt-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={`block h-48 w-full ${single ? '' : drag.current?.moved ? 'cursor-grabbing' : ''}`}
          role="img"
          aria-label={ariaLabel(g)}
          {...handlers}
        >
          {layout &&
            slice.names.map((name, i) => {
              const href = bandHref?.(i) ?? null;
              return (
                <path
                  key={i}
                  d={bandPath(layout, i)}
                  className={`${BAND_FILL[i]} ${href ? 'cursor-pointer' : ''} stroke-white transition-opacity dark:stroke-gray-900`}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={current?.band == null || current.band === i ? 1 : 0.35}
                  onClick={
                    href
                      ? () => {
                          // A drag that pans the chart isn't a click on a band.
                          if (!dragged.current) navigate(href);
                        }
                      : undefined
                  }
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
        {hint && (
          <div role="note" className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center">
            <span className="rounded-lg bg-gray-900/80 px-2.5 py-1 text-[11px] text-white dark:bg-gray-100/90 dark:text-gray-900">
              {isMac ? '⌘' : 'Ctrl'} + scroll, or pinch, to zoom · drag to pan
            </span>
          </div>
        )}
        {current && moment && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 w-max rounded-lg border border-gray-200/70 bg-white/95 px-2.5 py-1.5 text-[11px] text-gray-600 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/95 dark:text-gray-300"
            style={popupStyle}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-gray-800 dark:text-gray-100">{label(groups.ranges[visible.from + current.index], g)}</span>
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
      {firstInView != null && (
        <div className="mt-0.5 flex justify-between text-[10px] text-gray-400" aria-label="Showing">
          <span>{label(groups.ranges[firstInView], g)}</span>
          {lastInView !== firstInView && <span>{label(groups.ranges[lastInView], g)}</span>}
        </div>
      )}
    </>
  );
}
