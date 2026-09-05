import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, LineChart, Mountain, Route } from 'lucide-react';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  haversineDistance,
  type DistanceUnit,
} from '../utils/geo';
import { useTheme } from '../contexts/ThemeContext';
import type { TrackPoint } from '../types';

export type TrackGraphXAxis = 'distance' | 'time';
export type TrackGraphSeriesKey = 'speed' | 'elevation' | 'heartRate';

const SERIES_META: Record<
  TrackGraphSeriesKey,
  { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  speed: { label: 'Speed', color: '#3b82f6', icon: Route },
  elevation: { label: 'Elevation', color: '#10b981', icon: Mountain },
  heartRate: { label: 'Heart Rate', color: '#f43f5e', icon: Heart },
};

const SERIES_ORDER: TrackGraphSeriesKey[] = ['speed', 'elevation', 'heartRate'];

const CHART_HEIGHT = 240;
const MARGIN = { top: 12, bottom: 26, left: 48, right: 10 };
const MAX_SAMPLES = 1500;

interface TrackGraphProps {
  /** [lng, lat] per point */
  coordinates: [number, number][];
  /** Per-point series, same order as coordinates */
  points: TrackPoint[];
  distanceUnit: DistanceUnit;
  onHoverPoint: (index: number | null) => void;
}

interface GraphData {
  n: number;
  dist: number[]; // cumulative distance (m) per point
  time: number[]; // elapsed seconds from first timestamped point
  values: Record<TrackGraphSeriesKey, (number | null)[]>;
  startEpochMs: number;
  hasData: Record<TrackGraphSeriesKey, boolean>;
}

function buildGraphData(
  coordinates: [number, number][],
  points: TrackPoint[]
): GraphData | null {
  const n = Math.min(coordinates.length, points.length);
  if (n < 2) return null;

  const dist: number[] = new Array(n);
  const time: number[] = new Array(n);
  const speed: (number | null)[] = new Array(n);
  const ele: (number | null)[] = new Array(n);
  const hr: (number | null)[] = new Array(n);

  let totalDist = 0;
  let lastKnownTime: number | null = null;
  let startEpochMs = 0;

  for (let i = 0; i < n; i++) {
    const [lng, lat] = coordinates[i];
    if (i > 0) {
      const [plng, plat] = coordinates[i - 1];
      totalDist += haversineDistance(plat, plng, lat, lng);
    }
    dist[i] = totalDist;

    const t = points[i]?.t ?? null;
    if (t != null && Number.isFinite(t)) {
      if (lastKnownTime == null) startEpochMs = t;
      lastKnownTime = t;
    }
    // Carry forward the last known timestamp for missing ones
    time[i] = lastKnownTime != null ? Math.max(0, (lastKnownTime - startEpochMs) / 1000) : 0;

    const p = points[i];
    ele[i] = p && p.ele != null && Number.isFinite(p.ele) ? p.ele : null;
    hr[i] = p && p.hr != null && Number.isFinite(p.hr) ? p.hr : null;
  }

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      speed[i] = null;
      continue;
    }
    const dt = time[i] - time[i - 1];
    const dd = dist[i] - dist[i - 1];
    speed[i] = dt > 0.05 && dd > 0 ? dd / dt : 0;
  }

  const values: GraphData['values'] = { speed, elevation: ele, heartRate: hr };
  const hasData: GraphData['hasData'] = {
    speed: time[n - 1] > 0 && dist[n - 1] > 0,
    elevation: ele.some((v) => v != null),
    heartRate: hr.some((v) => v != null),
  };

  return { n, dist, time, values, startEpochMs, hasData };
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  if (frac <= 1) return pow;
  if (frac <= 2) return 2 * pow;
  if (frac <= 5) return 5 * pow;
  return 10 * pow;
}

function yTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const step = niceStep((max - min) / count);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function formatTick(value: number, key: TrackGraphSeriesKey, unit: DistanceUnit): string {
  if (key === 'speed') return formatSpeed(value, unit).replace('.0 ', ' ');
  if (key === 'heartRate') return `${Math.round(value)}`;
  return formatDistance(value, unit);
}

export default function TrackGraph({
  coordinates,
  points,
  distanceUnit,
  onHoverPoint,
}: TrackGraphProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  const data = useMemo(
    () => buildGraphData(coordinates, points),
    [coordinates, points]
  );

  const [xAxis, setXAxis] = useState<TrackGraphXAxis>('distance');
  const [selected, setSelected] = useState<TrackGraphSeriesKey[]>(() =>
    data ? SERIES_ORDER.filter((k) => data.hasData[k]).slice(0, 2) : []
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep at least one series selected; max two.
  const toggleSeries = (key: TrackGraphSeriesKey) => {
    setSelected((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      }
      return prev.length < 2 ? [...prev, key] : prev;
    });
  };

  const geometry = useMemo(() => {
    if (!data || selected.length === 0) return null;

    const n = data.n;
    const xMax =
      (xAxis === 'distance' ? data.dist[n - 1] : data.time[n - 1]) || 1;

    // Downsample large tracks (always keep the last point)
    let indices: number[];
    if (n <= MAX_SAMPLES) {
      indices = Array.from({ length: n }, (_, i) => i);
    } else {
      const stride = Math.ceil(n / MAX_SAMPLES);
      indices = [];
      for (let i = 0; i < n; i += stride) indices.push(i);
      if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
    }

    const left = MARGIN.left;
    const right = width - MARGIN.right;
    const top = MARGIN.top;
    const bottom = CHART_HEIGHT - MARGIN.bottom;
    const innerW = Math.max(1, right - left);
    const innerH = bottom - top;

    const xOf = (i: number) =>
      left + ((xAxis === 'distance' ? data.dist[i] : data.time[i]) / xMax) * innerW;

    const domains: Partial<Record<TrackGraphSeriesKey, [number, number]>> = {};
    for (const key of selected) {
      const vals = data.values[key];
      let min = Infinity;
      let max = -Infinity;
      for (const v of vals) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      } else {
        if (key === 'speed' || key === 'heartRate') min = 0;
        if (min === max) {
          min -= 1;
          max += 1;
        }
        if (key === 'elevation') {
          const pad = (max - min) * 0.05;
          min -= pad;
          max += pad;
        }
      }
      domains[key] = [min, max];
    }

    const paths: Partial<Record<TrackGraphSeriesKey, string>> = {};
    for (const key of selected) {
      const [min, max] = domains[key]!;
      const yOf = (v: number) => bottom - ((v - min) / (max - min)) * innerH;
      let d = '';
      let penDown = false;
      for (const i of indices) {
        const v = data.values[key][i];
        if (v == null) {
          penDown = false;
          continue;
        }
        const x = xOf(i).toFixed(1);
        const y = yOf(v).toFixed(1);
        d += penDown ? `L${x},${y}` : `M${x},${y}`;
        penDown = true;
      }
      paths[key] = d;
    }

    const leftTicks = yTicks(...(domains[selected[0]] ?? [0, 1]));
    const rightTicks =
      selected.length > 1 ? yTicks(...(domains[selected[1]] ?? [0, 1])) : null;

    // X-axis tick values: even splits for distance, nice round durations for time
    let xTicks: number[];
    if (xAxis === 'time') {
      const DURATION_STEPS_S = [
        1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200,
      ];
      // Nice round duration steps (seconds) so the axis reads e.g. "0", "30m", "1h"
      const step = DURATION_STEPS_S.find((s) => xMax / s <= 5) ?? 86400;
      xTicks = [];
      for (let v = 0; v <= xMax + 1e-9; v += step) xTicks.push(v);
      if (xTicks[xTicks.length - 1] < xMax && xMax - xTicks[xTicks.length - 1] >= step / 2) {
        xTicks.push(xMax);
      }
    } else {
      xTicks = Array.from({ length: 5 }, (_, i) => (i / 4) * xMax);
    }

    return {
      indices,
      xMax,
      left,
      right,
      top,
      bottom,
      innerW,
      innerH,
      xOf,
      domains,
      paths,
      leftTicks,
      rightTicks,
      xTicks,
      width,
    };
  }, [data, selected, xAxis, width]);

  const formatX = (x: number): string =>
    xAxis === 'distance' ? formatDistance(x, distanceUnit) : formatDuration(x);

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!geometry || !data) return;
    // Measure against the <svg> (not the overlay rect, whose box already
    // starts at geometry.left) so px includes the left margin.
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = Math.min(1, Math.max(0, (px - geometry.left) / geometry.innerW));
    const targetX = frac * geometry.xMax;

    // Binary search the nearest sampled point by x value
    const idxs = geometry.indices;
    const xAt = (i: number) => (xAxis === 'distance' ? data.dist[i] : data.time[i]);
    let lo = 0;
    let hi = idxs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xAt(idxs[mid]) < targetX) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(xAt(idxs[lo - 1]) - targetX) <= Math.abs(xAt(idxs[lo]) - targetX)) {
      lo -= 1;
    }
    const pointIndex = idxs[lo];
    if (pointIndex !== hoverIndex) {
      setHoverIndex(pointIndex);
      onHoverPoint(pointIndex);
    }
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
    onHoverPoint(null);
  };

  if (!data || !geometry) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-gray-400 dark:text-gray-500">
        Not enough track data to display a graph.
      </div>
    );
  }

  const axisText = dark ? '#9ca3af' : '#6b7280';
  const gridLine = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const plotBg = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  const hoverX = hoverIndex != null ? geometry.xOf(hoverIndex) : null;
  const hoverRight = hoverX != null && hoverX > geometry.left + geometry.innerW * 0.6;

  return (
    <div>
      {/* Chart */}
      <div ref={containerRef} className="relative select-none">
        <svg
          width={width}
          height={CHART_HEIGHT}
          className="block touch-pan-y"
          role="img"
          aria-label="Track graph"
        >
          <rect
            x={geometry.left}
            y={geometry.top}
            width={geometry.innerW}
            height={geometry.innerH}
            fill={plotBg}
          />

          {/* Horizontal gridlines + left y-axis ticks */}
          {geometry.leftTicks.map((t) => {
            const [min, max] = geometry.domains[selected[0]]!;
            const y =
              geometry.bottom - ((t - min) / (max - min)) * geometry.innerH;
            if (y < geometry.top - 0.5 || y > geometry.bottom + 0.5) return null;
            return (
              <g key={`lt-${t}`}>
                <line x1={geometry.left} x2={geometry.right} y1={y} y2={y} stroke={gridLine} />
                <text x={geometry.left - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill={axisText}>
                  {formatTick(t, selected[0], distanceUnit)}
                </text>
              </g>
            );
          })}

          {/* Right y-axis ticks (second series) */}
          {selected.length > 1 &&
            geometry.rightTicks?.map((t) => {
              const [min, max] = geometry.domains[selected[1]]!;
              const y = geometry.bottom - ((t - min) / (max - min)) * geometry.innerH;
              if (y < geometry.top - 0.5 || y > geometry.bottom + 0.5) return null;
              return (
                <text
                  key={`rt-${t}`}
                  x={geometry.right + 6}
                  y={y + 3.5}
                  textAnchor="start"
                  fontSize={10}
                  fill={SERIES_META[selected[1]].color}
                >
                  {formatTick(t, selected[1], distanceUnit)}
                </text>
              );
            })}

          {/* X-axis ticks */}
          {geometry.xTicks.map((t, i) => (
            <text
              key={`xt-${i}`}
              x={geometry.left + (t / geometry.xMax) * geometry.innerW}
              y={geometry.bottom + 16}
              textAnchor={t === 0 ? 'start' : t >= geometry.xMax ? 'end' : 'middle'}
              fontSize={10}
              fill={axisText}
            >
              {formatX(t)}
            </text>
          ))}

          {/* Series */}
          {selected.map((key) => (
            <path
              key={key}
              d={geometry.paths[key]}
              fill="none"
              stroke={SERIES_META[key].color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}

          {/* Hover guide */}
          {hoverX != null && (
            <g>
              <line
                x1={hoverX}
                x2={hoverX}
                y1={geometry.top}
                y2={geometry.bottom}
                stroke={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'}
                strokeDasharray="3 3"
              />
              {selected.map((key) => {
                const v = data.values[key][hoverIndex!];
                if (v == null) return null;
                const [min, max] = geometry.domains[key]!;
                const y = geometry.bottom - ((v - min) / (max - min)) * geometry.innerH;
                return (
                  <circle
                    key={`h-${key}`}
                    cx={hoverX}
                    cy={y}
                    r={4}
                    fill={SERIES_META[key].color}
                    stroke={dark ? '#111827' : '#ffffff'}
                    strokeWidth={1.5}
                  />
                );
              })}
            </g>
          )}

          {/* Pointer capture overlay */}
          <rect
            data-testid="chart-overlay"
            x={geometry.left}
            y={geometry.top}
            width={geometry.innerW}
            height={geometry.innerH}
            fill="transparent"
            style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerUp={(e) => {
              if (e.pointerType === 'touch') handlePointerLeave();
            }}
          />
        </svg>

        {/* Hover readout */}
        {hoverIndex != null && (
          <div
            className={`pointer-events-none absolute top-1 rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/90 dark:bg-gray-900/90 backdrop-blur px-2.5 py-1.5 text-[11px] shadow-sm ${
              hoverRight ? 'right-2' : 'left-12'
            }`}
          >
            <div className="font-semibold text-gray-700 dark:text-gray-200">
              {formatX(xAxis === 'distance' ? data.dist[hoverIndex] : data.time[hoverIndex])}
            </div>
            {selected.map((key) => {
              const v = data.values[key][hoverIndex];
              return (
                <div key={key} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: SERIES_META[key].color }}
                  />
                  <span>
                    {SERIES_META[key].label}:{' '}
                    {v == null
                      ? '—'
                      : key === 'speed'
                        ? formatSpeed(v, distanceUnit)
                        : key === 'heartRate'
                          ? `${Math.round(v)} bpm`
                          : formatDistance(v, distanceUnit)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
        <div
          role="group"
          aria-label="X axis"
          className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs"
        >
          {(['distance', 'time'] as TrackGraphXAxis[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setXAxis(mode)}
              aria-pressed={xAxis === mode}
              className={`px-3 py-1.5 capitalize transition-colors ${
                xAxis === mode
                  ? 'bg-rose-500 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Data series"
          className="flex items-center gap-1.5 flex-wrap"
        >
          {SERIES_ORDER.filter((key) => data.hasData[key]).map((key) => {
            const meta = SERIES_META[key];
            const active = selected.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSeries(key)}
                aria-pressed={active}
                title={`Toggle ${meta.label.toLowerCase()}`}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-transparent text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                style={active ? { backgroundColor: meta.color } : undefined}
              >
                <meta.icon size={13} />
                {meta.label}
              </button>
            );
          })}
          {SERIES_ORDER.filter((key) => data.hasData[key]).length > 1 &&
            selected.length < 2 && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                Select up to two series (left + right axis)
              </span>
            )}
        </div>
      </div>
    </div>
  );
}
