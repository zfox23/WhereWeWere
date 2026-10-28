import { useEffect, useMemo, useRef, useState } from 'react';
import { Sunrise, Sunset } from 'lucide-react';
import { useTheme } from '../../../client/src/contexts/ThemeContext';
import type { DistanceUnit } from './geo';
import { describeWeather, formatClock, formatPrecip, formatTemp, formatWind, type WeatherHour } from './weatherFormat';
import { hourLabel, localHours, monotonePath, niceScale } from './weatherChart';

interface Props {
  hourly: WeatherHour[];
  sunrise: string | null;
  sunset: string | null;
  unit: DistanceUnit;
}

const WIDE_QUERY = '(min-width: 640px)';
/** Horizontal chart height; the vertical chart instead gives each hour a row. */
const H_HEIGHT = 240;
const V_ROW = 22;
const H_MARGIN = { top: 26, bottom: 22, left: 36, right: 40 };
const V_MARGIN = { top: 22, bottom: 22, left: 44, right: 70 };
/** Time domain in hours: each hour is centered in its own band. */
const T0 = -0.5;
const T1 = 23.5;
const TICK_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

/** True at `sm`+. Defaults to wide where matchMedia is unavailable (tests). */
function useIsWide(): boolean {
  const get = () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia(WIDE_QUERY).matches;
  const [isWide, setIsWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(WIDE_QUERY);
    const onChange = () => setIsWide(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isWide;
}

const toTemp = (c: number, unit: DistanceUnit) => (unit === 'imperial' ? c * 9 / 5 + 32 : c);
const toPrecip = (mm: number, unit: DistanceUnit) => (unit === 'imperial' ? mm / 25.4 : mm);

/**
 * Hourly temperature (smooth line, left/top axis) and precipitation (bars,
 * right/bottom axis) for one day, with night shaded and the exact sunrise and
 * sunset marked. Time runs left→right on wide screens and top→bottom on narrow
 * ones. Hovering or tapping an hour shows its details.
 */
export default function WeatherChart({ hourly, sunrise, sunset, unit }: Props) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const horizontal = useIsWide();

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(260, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [active, setActive] = useState<number | null>(null);

  const hours = useMemo(
    () =>
      hourly
        .map((h) => ({ ...h, t: localHours(h.time) }))
        .filter((h): h is WeatherHour & { t: number } => h.t != null),
    [hourly],
  );

  const g = useMemo(() => {
    const m = horizontal ? H_MARGIN : V_MARGIN;
    const height = horizontal ? H_HEIGHT : 24 * V_ROW + m.top + m.bottom;
    const plot = { left: m.left, right: width - m.right, top: m.top, bottom: height - m.bottom };
    // Time runs along x (horizontal) or y (vertical); values along the other.
    const [tStart, tEnd] = horizontal ? [plot.left, plot.right] : [plot.top, plot.bottom];
    const [vBase, vFar] = horizontal ? [plot.bottom, plot.top] : [plot.left, plot.right];
    const tPos = (t: number) => tStart + ((t - T0) / (T1 - T0)) * (tEnd - tStart);
    const band = (tEnd - tStart) / (T1 - T0);

    const temps = hours.map((h) => h.temp).filter((v): v is number => v != null).map((v) => toTemp(v, unit));
    const tempScale = temps.length ? niceScale(Math.min(...temps), Math.max(...temps), horizontal ? 4 : 3) : null;
    const precips = hours.map((h) => (h.precip != null ? toPrecip(h.precip, unit) : 0));
    const precipScale = niceScale(0, Math.max(unit === 'imperial' ? 0.04 : 1, ...precips), horizontal ? 4 : 3);

    const tempPos = (v: number) =>
      tempScale ? vBase + ((v - tempScale.min) / (tempScale.max - tempScale.min)) * (vFar - vBase) : vBase;
    const precipPos = (v: number) => vBase + (v / precipScale.max) * (vFar - vBase);
    /** An (along-time, along-value) pair as SVG (x, y). */
    const xy = (tp: number, vp: number): [number, number] => (horizontal ? [tp, vp] : [vp, tp]);

    const tempPath = monotonePath(
      hours.map((h) => (h.temp != null ? [tPos(h.t), tempPos(toTemp(h.temp, unit))] : null)),
      !horizontal,
    );

    return { m, height, plot, tStart, tEnd, vBase, vFar, tPos, band, tempScale, precipScale, tempPos, precipPos, xy, tempPath };
  }, [hours, horizontal, width, unit]);

  if (hours.length === 0) return null;

  const colors = {
    temp: '#ea580c',
    precip: dark ? '#3b82f6' : '#2563eb',
    axis: dark ? '#9ca3af' : '#6b7280',
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    night: dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.10)',
    sun: dark ? '#fbbf24' : '#d97706',
    surface: dark ? '#111827' : '#ffffff',
  };

  const sunrisePos = localHours(sunrise);
  const sunsetPos = localHours(sunset);
  /** A rect spanning [t0, t1] along time and the full value range. */
  const timeRect = (t0: number, t1: number) => {
    const a = Math.max(g.tStart, Math.min(g.tEnd, g.tPos(t0)));
    const b = Math.max(g.tStart, Math.min(g.tEnd, g.tPos(t1)));
    const [x, y] = g.xy(a, Math.min(g.vBase, g.vFar));
    const [w, h] = g.xy(b - a, Math.abs(g.vFar - g.vBase));
    return { x, y, width: Math.max(0, w), height: Math.max(0, h) };
  };

  const fmtPrecipTick = (v: number) => String(Number(v.toFixed(2)));
  const select = (i: number | null) => setActive(i == null ? null : Math.max(0, Math.min(hours.length - 1, i)));
  const onKeyDown = (e: React.KeyboardEvent) => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) { e.preventDefault(); select((active ?? 1) - 1); }
    else if (e.key === fwd) { e.preventDefault(); select((active ?? -1) + 1); }
    else if (e.key === 'Escape' && active != null) { e.stopPropagation(); setActive(null); }
  };

  const activeHour = active != null ? hours[active] : null;
  const activePos = activeHour ? g.tPos(activeHour.t) : null;
  const sky = activeHour ? describeWeather(activeHour.code) : null;
  // Keep the popup clear of the chart edge it would otherwise overflow.
  const popupStyle: React.CSSProperties | undefined =
    activePos == null
      ? undefined
      : horizontal
        ? activePos > width / 2
          ? { right: width - activePos + 10, top: g.plot.top }
          : { left: activePos + 10, top: g.plot.top }
        : activePos > g.height / 2
          ? { right: g.m.right, bottom: g.height - activePos + 10 }
          : { right: g.m.right, top: activePos + 10 };

  const unitTemp = unit === 'imperial' ? '°F' : '°C';
  const unitPrecip = unit === 'imperial' ? 'in' : 'mm';

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300 mb-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: colors.temp }} />
          Temperature ({unitTemp})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-3 rounded-sm" style={{ backgroundColor: colors.precip }} />
          Precipitation ({unitPrecip})
        </span>
      </div>
      <div ref={containerRef} className="relative select-none">
        <svg
          width={width}
          height={g.height}
          className="block outline-none"
          role="img"
          aria-label="Hourly temperature and precipitation"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          style={{ touchAction: 'pan-y' }}
        >
          {/* Night */}
          {sunrisePos != null && <rect data-testid="night" {...timeRect(T0, sunrisePos)} fill={colors.night} />}
          {sunsetPos != null && <rect data-testid="night" {...timeRect(sunsetPos, T1)} fill={colors.night} />}

          {/* Temperature gridlines and ticks */}
          {g.tempScale?.ticks.map((v) => {
            const p = g.tempPos(v);
            const [x1, y1] = g.xy(g.tStart, p);
            const [x2, y2] = g.xy(g.tEnd, p);
            return (
              <g key={`t-${v}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.grid} />
                {horizontal ? (
                  <text x={x1 - 6} y={y1 + 3.5} textAnchor="end" fontSize={10} fill={colors.axis}>{Math.round(v)}°</text>
                ) : (
                  <text x={x1} y={g.plot.top - 7} textAnchor="middle" fontSize={10} fill={colors.axis}>{Math.round(v)}°</text>
                )}
              </g>
            );
          })}

          {/* Precipitation ticks */}
          {g.precipScale.ticks.map((v) => {
            const p = g.precipPos(v);
            return horizontal ? (
              <text key={`p-${v}`} x={g.plot.right + 6} y={p + 3.5} textAnchor="start" fontSize={10} fill={colors.axis}>{fmtPrecipTick(v)}</text>
            ) : (
              <text key={`p-${v}`} x={p} y={g.plot.bottom + 15} textAnchor="middle" fontSize={10} fill={colors.axis}>{fmtPrecipTick(v)}</text>
            );
          })}

          {/* Axis unit labels */}
          {horizontal ? (
            <>
              <text x={g.plot.left - 6} y={g.plot.top - 8} textAnchor="end" fontSize={10} fill={colors.axis}>{unitTemp}</text>
              <text x={g.plot.right + 6} y={g.plot.top - 8} textAnchor="start" fontSize={10} fill={colors.axis}>{unitPrecip}</text>
            </>
          ) : (
            <>
              <text x={g.plot.left - 6} y={g.plot.top - 7} textAnchor="end" fontSize={10} fill={colors.axis}>{unitTemp}</text>
              <text x={g.plot.left - 6} y={g.plot.bottom + 15} textAnchor="end" fontSize={10} fill={colors.axis}>{unitPrecip}</text>
            </>
          )}

          {/* Hour ticks */}
          {TICK_HOURS.map((t) => {
            const p = g.tPos(t);
            return horizontal ? (
              <text key={`h-${t}`} x={p} y={g.plot.bottom + 15} textAnchor="middle" fontSize={10} fill={colors.axis}>{hourLabel(t)}</text>
            ) : (
              <text key={`h-${t}`} x={g.plot.left - 6} y={p + 3.5} textAnchor="end" fontSize={10} fill={colors.axis}>{hourLabel(t)}</text>
            );
          })}

          {/* Precipitation bars */}
          {hours.map((h) => {
            if (h.precip == null || h.precip <= 0) return null;
            const p = g.precipPos(toPrecip(h.precip, unit));
            const thick = g.band * 0.6;
            const rect = horizontal
              ? { x: g.tPos(h.t) - thick / 2, y: p, width: thick, height: g.vBase - p }
              : { x: g.vBase, y: g.tPos(h.t) - thick / 2, width: p - g.vBase, height: thick };
            return <rect key={`b-${h.time}`} data-testid="precip-bar" {...rect} rx={1.5} fill={colors.precip} opacity={active == null || hours[active] === h ? 0.85 : 0.55} />;
          })}

          {/* Temperature line */}
          <path d={g.tempPath} fill="none" stroke={colors.temp} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Sunrise / sunset at their exact times, labeled in the lane opposite the hour ticks */}
          {([[sunrisePos, sunrise, Sunrise, 'Sunrise'], [sunsetPos, sunset, Sunset, 'Sunset']] as const).map(([t, iso, Icon, label]) => {
            if (t == null) return null;
            const p = g.tPos(t);
            const [x1, y1] = g.xy(p, g.vBase);
            const [x2, y2] = g.xy(p, g.vFar);
            const text = formatClock(iso);
            // Horizontal: centered above the plot, clamped to the chart width.
            const labelW = 64;
            const lx = Math.max(labelW / 2, Math.min(width - labelW / 2, p));
            return (
              <g key={label} aria-label={`${label} ${text}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.sun} strokeWidth={1.25} strokeDasharray="4 3" />
                {horizontal ? (
                  <>
                    <Icon x={lx - labelW / 2} y={4} width={13} height={13} color={colors.sun} aria-hidden="true" />
                    <text x={lx - labelW / 2 + 16} y={14} fontSize={10} fill={colors.axis}>{text}</text>
                  </>
                ) : (
                  <>
                    <Icon x={g.plot.right + 5} y={p - 7} width={13} height={13} color={colors.sun} aria-hidden="true" />
                    <text x={g.plot.right + 21} y={p + 3.5} fontSize={10} fill={colors.axis}>{text}</text>
                  </>
                )}
              </g>
            );
          })}

          {/* Active hour guide */}
          {activeHour && activePos != null && (
            <g pointerEvents="none">
              {(() => {
                const [x1, y1] = g.xy(activePos, g.vBase);
                const [x2, y2] = g.xy(activePos, g.vFar);
                return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'} strokeDasharray="3 3" />;
              })()}
              {activeHour.temp != null && (() => {
                const [cx, cy] = g.xy(activePos, g.tempPos(toTemp(activeHour.temp, unit)));
                return <circle cx={cx} cy={cy} r={4} fill={colors.temp} stroke={colors.surface} strokeWidth={2} />;
              })()}
            </g>
          )}

          {/* Hit targets: one band per hour */}
          <g onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}>
            {hours.map((h, i) => (
              <rect
                key={`hit-${h.time}`}
                data-testid="hour-hit"
                {...timeRect(h.t - 0.5, h.t + 0.5)}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(i); }}
                onPointerDown={() => setActive(i)}
              />
            ))}
          </g>
        </svg>

        {activeHour && sky && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-2.5 py-1.5 text-[11px] shadow-sm text-gray-600 dark:text-gray-300 whitespace-nowrap"
            style={popupStyle}
          >
            <div className="font-semibold text-gray-800 dark:text-gray-100">{formatClock(activeHour.time)}</div>
            <div className="flex items-center gap-1.5 text-gray-800 dark:text-gray-100">
              <sky.icon size={13} aria-hidden="true" />
              <span>{formatTemp(activeHour.temp, unit)} · {sky.label}</span>
            </div>
            <div>Precip {formatPrecip(activeHour.precip, unit)}</div>
            <div>Humidity {activeHour.humidity != null ? `${Math.round(activeHour.humidity)}%` : '–'}</div>
            <div>Wind {formatWind(activeHour.wind, unit)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
