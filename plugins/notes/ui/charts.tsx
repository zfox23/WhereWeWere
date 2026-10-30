/**
 * Small chart kit for Profile > Notes (hand-built, like the app's other
 * charts): a hover tooltip, a sequential heat grid, and a legend for it.
 *
 * Sequential magnitude uses one hue (blue), light -> dark on the light
 * surface; dark mode has its own steps where low values recede into the dark
 * surface and high values brighten.
 */

import { useRef, useState, type ReactNode } from 'react';

/** Six magnitude levels as static Tailwind classes (light step / dark step). */
export const SEQ_LEVELS = [
  'bg-[#cde2fb] dark:bg-[#123a6e]',
  'bg-[#9ec5f4] dark:bg-[#184f95]',
  'bg-[#6da7ec] dark:bg-[#1c5cab]',
  'bg-[#3987e5] dark:bg-[#2a78d6]',
  'bg-[#256abf] dark:bg-[#5598e7]',
  'bg-[#184f95] dark:bg-[#9ec5f4]',
] as const;

export const EMPTY_CELL = 'bg-gray-100 dark:bg-gray-800/70';

/** Level index (0..5) for `value` in (0, max], or -1 for nothing. sqrt scale so small counts still show. */
export function seqLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1;
  return Math.min(SEQ_LEVELS.length - 1, Math.floor(Math.sqrt(value / max) * SEQ_LEVELS.length - 1e-9));
}

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** A container that shows a tooltip near the pointer for whatever child calls `show`. */
export function useTooltip() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const show = (e: React.MouseEvent | React.FocusEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    if ('clientX' in e) {
      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
    } else {
      const t = (e.target as HTMLElement).getBoundingClientRect();
      setTip({ x: t.left - box.left + t.width / 2, y: t.top - box.top, content });
    }
  };
  const hide = () => setTip(null);
  const layer = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-100 shadow-lg"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide, layer };
}

export function SeqLegend({ max, unit }: { max: number; unit: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span>Fewer</span>
      <span className={`h-3 w-3 rounded-sm ${EMPTY_CELL}`} />
      {SEQ_LEVELS.map((c) => <span key={c} className={`h-3 w-3 rounded-sm ${c}`} />)}
      <span>More</span>
      <span className="ml-1 tabular-nums">(max {max.toLocaleString()} {unit})</span>
    </div>
  );
}

interface HeatGridProps {
  rows: { key: string; label: ReactNode }[];
  cols: { key: string; label: string; show?: boolean }[];
  value: (row: string, col: string) => number;
  describe: (row: string, col: string, value: number) => ReactNode;
  unit: string;
  /** Print the count inside non-empty cells (for small grids). */
  showValues?: boolean;
  cellMinWidth?: number;
}

/** Rows × columns of magnitude cells with a hover tooltip and a legend. */
export function HeatGrid({ rows, cols, value, describe, unit, showValues = false, cellMinWidth = 14 }: HeatGridProps) {
  const { ref, show, hide, layer } = useTooltip();
  let max = 0;
  for (const r of rows) for (const c of cols) max = Math.max(max, value(r.key, c.key));

  return (
    <div className="space-y-2">
      <div ref={ref} className="relative overflow-x-auto" onMouseLeave={hide}>
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.key} className="px-0 text-[10px] font-normal text-gray-400 tabular-nums" style={{ minWidth: cellMinWidth }}>
                  {c.show === false ? '' : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="pr-2 text-left text-xs font-normal text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.label}</th>
                {cols.map((c) => {
                  const v = value(r.key, c.key);
                  const level = seqLevel(v, max);
                  const text = describe(r.key, c.key, v);
                  return (
                    <td
                      key={c.key}
                      tabIndex={v > 0 ? 0 : -1}
                      onMouseMove={(e) => show(e, text)}
                      onFocus={(e) => show(e, text)}
                      onBlur={hide}
                      aria-label={typeof text === 'string' ? text : `${v} ${unit}`}
                      className={`h-5 rounded-[3px] text-center text-[10px] tabular-nums ${level < 0 ? EMPTY_CELL : SEQ_LEVELS[level]} ${
                        level >= 3 ? 'text-white dark:text-gray-900' : 'text-gray-700 dark:text-gray-200'
                      }`}
                      style={{ minWidth: cellMinWidth }}
                    >
                      {showValues && v > 0 ? v : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {layer}
      </div>
      {max > 0 && <SeqLegend max={max} unit={unit} />}
    </div>
  );
}

/** Card wrapper used by every section of the tab. */
export function Panel({ title, icon, subtitle, children, action }: {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">{icon}{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
