import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  Smile,
  BarChart3,
  Activity,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { stats } from '../api/client';
import { MoodIcon } from './MoodIcons';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isoDate,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
  resolveMonthForYear,
  shiftMonth,
} from '../utils/periodRange';

const USER_ID = '00000000-0000-0000-0000-000000000001';

const MOOD_HEX = ['', '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'] as const;
const MOOD_LABELS = ['', 'Awful', 'Bad', 'Meh', 'Good', 'Excellent'] as const;
const MOOD_TEXT = [
  '',
  'text-red-500',
  'text-orange-400',
  'text-yellow-500',
  'text-lime-500',
  'text-green-500',
] as const;
function openInNewTab(path: string): void {
  window.open(path, '_blank', 'noopener,noreferrer');
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DailyPt = {
  date: string;
  avg_mood: number;
  min_mood: number;
  max_mood: number;
  count: number;
};
type MonthlyPt = { month: string; mood: number; count: number };
type DowPt = { day: string; avg_mood: number | null; count: number };
type CorrPt = {
  activity_id: string;
  activity_name: string;
  group_name: string;
  avg_mood: number;
  mood_impact: number;
  checkin_count: number;
};
type ComboPt = {
  combination_key: string;
  combination_name: string;
  activity_count: number;
  avg_mood: number;
  mood_impact: number;
  checkin_count: number;
};
type HeatPt = { date: string; avg_mood: number };
type MoodCount = { mood: number; count: number };
type SleepDailyPt = { date: string; total_sleep_minutes: number | null };

function formatSleepMinutesShort(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
// ─── SVG Line/Span Chart ──────────────────────────────────────────────────────

const SW = 760, SH = 280, PL = 42, PR = 16, PT = 14, PB = 34;
const CW = SW - PL - PR;
const CH = SH - PT - PB;

function toX(i: number, n: number): number {
  return n <= 1 ? PL + CW / 2 : PL + (i / (n - 1)) * CW;
}
function toY(m: number): number {
  return PT + ((5 - m) / 4) * CH;
}

function MoodLineSpanChart({
  data,
  mode,
  sleepTotalsByDate,
  showSleepBars,
}: {
  data: DailyPt[];
  mode: 'line' | 'span';
  sleepTotalsByDate: Map<string, number>;
  showSleepBars: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  useEffect(() => {
    setActiveIndex(null);
    setPinnedIndex(null);
    setIsScrubbing(false);
  }, [data, mode]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-36 text-sm text-gray-400">
        No mood data in this period
      </div>
    );
  }

  const n = data.length;

  // X ticks: one per month boundary, skipping ticks that are too close together
  const xticks: { key: string; x: number; label: string }[] = [];
  let pm = '';
  let lastTickX = -Infinity;
  data.forEach((d, i) => {
    const mo = d.date.slice(0, 7);
    if (mo !== pm) {
      const x = toX(i, n);
      if (x - lastTickX >= 55) {
        xticks.push({
          key: mo,
          x,
          label: new Date(d.date + 'T12:00').toLocaleString('en-US', { month: 'short', day: 'numeric' }),
        });
        lastTickX = x;
      }
      pm = mo;
    }
  });

  const avgPath = data
    .map((d, i) => `${i ? 'L' : 'M'} ${toX(i, n).toFixed(1)} ${toY(d.avg_mood).toFixed(1)}`)
    .join(' ');
  const maxPath = data
    .map((d, i) => `${i ? 'L' : 'M'} ${toX(i, n).toFixed(1)} ${toY(d.max_mood).toFixed(1)}`)
    .join(' ');
  const minPath = data
    .map((d, i) => `${i ? 'L' : 'M'} ${toX(i, n).toFixed(1)} ${toY(d.min_mood).toFixed(1)}`)
    .join(' ');
  const spanArea =
    data
      .map((d, i) => `${i ? 'L' : 'M'} ${toX(i, n).toFixed(1)} ${toY(d.max_mood).toFixed(1)}`)
      .join(' ') +
    ' ' +
    [...data]
      .reverse()
      .map((d, i) => `L ${toX(n - 1 - i, n).toFixed(1)} ${toY(d.min_mood).toFixed(1)}`)
      .join(' ') +
    ' Z';

  const GC = 'rgba(128,128,128,0.2)';
  const TC = 'rgba(128,128,128,0.8)';
  const AC = 'rgba(128,128,128,0.5)';

  const getIndexFromClientX = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;

    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const svgPoint = pt.matrixTransform(ctm.inverse());
    const clampedX = Math.max(PL, Math.min(SW - PR, svgPoint.x));
    if (n <= 1) return 0;
    const idx = Math.round(((clampedX - PL) / CW) * (n - 1));
    return Math.max(0, Math.min(n - 1, idx));
  };

  const updateActiveFromPointer = (clientX: number, clientY: number) => {
    const idx = getIndexFromClientX(clientX, clientY);
    if (idx === null) return;
    setActiveIndex(idx);
  };

  const displayIndex = activeIndex ?? pinnedIndex;
  const selectedPoint = displayIndex !== null ? data[displayIndex] : null;
  const selectedX = displayIndex !== null ? toX(displayIndex, n) : null;
  const sleepTotals = data.map((d) => Math.max(0, sleepTotalsByDate.get(d.date) || 0));
  const maxSleepMinutes = Math.max(...sleepTotals, 0);
  const toSleepY = (minutes: number) => {
    if (maxSleepMinutes <= 0) return PT + CH;
    return PT + CH - (minutes / maxSleepMinutes) * CH;
  };
  const step = n <= 1 ? CW : CW / (n - 1);
  const barWidth = Math.max(2, Math.min(10, step * 0.6));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SW} ${SH}`}
        className="w-full"
        style={{ height: SH, display: 'block', touchAction: 'none' }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          updateActiveFromPointer(e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') {
            updateActiveFromPointer(e.clientX, e.clientY);
            return;
          }
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsScrubbing(true);
          updateActiveFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' && !isScrubbing) {
            updateActiveFromPointer(e.clientX, e.clientY);
            return;
          }
          if (!isScrubbing) return;
          updateActiveFromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') {
            const idx = getIndexFromClientX(e.clientX, e.clientY);
            if (idx !== null) {
              const day = data[idx]?.date;
              if (day) openInNewTab(`/?from=${day}&to=${day}`);
            }
            return;
          }
          if (!isScrubbing) return;
          const idx = getIndexFromClientX(e.clientX, e.clientY);
          setIsScrubbing(false);
          setActiveIndex(null);
          if (idx !== null) setPinnedIndex(idx);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          setIsScrubbing(false);
          setActiveIndex(null);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          setActiveIndex(null);
        }}
      >
        {/* Y grid lines + labels */}
        {[1, 2, 3, 4, 5].map((m) => (
          <g key={m}>
            <line x1={PL} y1={toY(m)} x2={SW - PR} y2={toY(m)} stroke={GC} strokeWidth={1} />
            <text
              x={PL - 4}
              y={toY(m) + 4}
              textAnchor="end"
              fontSize={10}
              fill={TC}
              fontFamily="system-ui, sans-serif"
            >
              {m}
            </text>
          </g>
        ))}

        {/* X axis baseline */}
        <line x1={PL} y1={PT + CH} x2={SW - PR} y2={PT + CH} stroke={AC} strokeWidth={1} />

        {/* X axis ticks + labels */}
        {xticks.map((t) => (
          <g key={t.key}>
            <line x1={t.x} y1={PT + CH} x2={t.x} y2={PT + CH + 4} stroke={AC} strokeWidth={1} />
            <text
              x={t.x}
              y={SH - 4}
              textAnchor="middle"
              fontSize={9}
              fill={TC}
              fontFamily="system-ui, sans-serif"
            >
              {t.label}
            </text>
          </g>
        ))}

        {showSleepBars && (
          <>
            {sleepTotals.map((minutes, i) => {
              if (minutes <= 0) return null;
              const x = toX(i, n) - barWidth / 2;
              const y = toSleepY(minutes);
              const h = PT + CH - y;
              return (
                <rect
                  key={`sleep-${data[i].date}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  rx={1}
                  fill="rgba(20, 184, 166, 0.35)"
                >
                  <title>{`${data[i].date}: sleep ${formatSleepMinutesShort(minutes)}`}</title>
                </rect>
              );
            })}

            {maxSleepMinutes > 0 &&
              [0, 0.33, 0.66, 1].map((ratio) => {
                const val = maxSleepMinutes * ratio;
                const y = toSleepY(val);
                return (
                  <text
                    key={`sleep-label-${ratio}`}
                    x={SW - 2}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={10}
                    fill="rgba(13, 148, 136, 0.85)"
                    fontFamily="system-ui, sans-serif"
                  >
                    {formatSleepMinutesShort(val)}
                  </text>
                );
              })}
          </>
        )}

        {mode === 'span' && (
          <>
            <path d={spanArea} fill="rgba(99,102,241,0.18)" />
            <path d={maxPath} fill="none" stroke="rgba(99,102,241,0.45)" strokeWidth={1} strokeDasharray="3 2" />
            <path d={minPath} fill="none" stroke="rgba(99,102,241,0.45)" strokeWidth={1} strokeDasharray="3 2" />
            <path
              d={avgPath}
              fill="none"
              stroke="#6366f1"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {mode === 'line' && (
          <>
            <path
              d={
                avgPath +
                ` L ${toX(n - 1, n).toFixed(1)} ${(PT + CH).toFixed(1)} L ${toX(0, n).toFixed(1)} ${(PT + CH).toFixed(1)} Z`
              }
              fill="rgba(99,102,241,0.08)"
            />
            <path
              d={avgPath}
              fill="none"
              stroke="#6366f1"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {n <= 45 &&
              data.map((d, i) => (
                <circle key={d.date} cx={toX(i, n)} cy={toY(d.avg_mood)} r={2.5} fill="#6366f1">
                  <title>
                    {d.date}: avg {d.avg_mood.toFixed(1)} ({d.count} {d.count === 1 ? 'entry' : 'entries'})
                  </title>
                </circle>
              ))}
          </>
        )}

        {selectedPoint && selectedX !== null && (
          <>
            <line
              x1={selectedX}
              y1={PT}
              x2={selectedX}
              y2={PT + CH}
              stroke="rgba(99,102,241,0.5)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <circle cx={selectedX} cy={toY(selectedPoint.avg_mood)} r={4} fill="#6366f1" />
          </>
        )}
      </svg>

      {selectedPoint && selectedX !== null && (
        <div
          className="absolute top-2 px-2.5 py-1 rounded-md bg-gray-900/90 text-white text-xs font-medium whitespace-nowrap pointer-events-none"
          style={{
            left: `${(selectedX / SW) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          {selectedPoint.date} • avg {selectedPoint.avg_mood.toFixed(1)}
          {showSleepBars && ` • sleep ${formatSleepMinutesShort(sleepTotalsByDate.get(selectedPoint.date) || 0)}`}
        </div>
      )}
    </div>
  );
}

// ─── Mood Count Summary ───────────────────────────────────────────────────────

function MoodCountSummary({ data }: { data: MoodCount[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2 justify-center">
      {data
        .filter((d) => d.count > 0)
        .map((d) => (
          <div
            key={d.mood}
            className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-3 py-1.5"
          >
            <MoodIcon mood={d.mood} size={16} />
            <span className={`text-sm font-bold ${MOOD_TEXT[d.mood as 1 | 2 | 3 | 4 | 5]}`}>
              {d.count}
            </span>
            <span className="text-xs text-gray-500 hidden sm:inline">
              {MOOD_LABELS[d.mood as 1 | 2 | 3 | 4 | 5]}
            </span>
          </div>
        ))}
      <span className="self-center text-xs text-gray-400">/ {total} total</span>
    </div>
  );
}

// ─── Monthly Pie Chart ────────────────────────────────────────────────────────

function MoodPieChart({ slices }: { slices: MoodCount[] }) {
  const total = slices.reduce((s, d) => s + d.count, 0);
  if (!total) {
    return (
      <div className="flex items-center justify-center w-[168px] h-[168px] text-sm text-gray-400">
        No data
      </div>
    );
  }

  const CX = 84, CY = 84, R = 78;
  let angle = -Math.PI / 2;
  const paths = slices
    .filter((d) => d.count > 0)
    .map((d) => {
      const pct = d.count / total;
      const sa = angle;
      angle += pct * Math.PI * 2;
      const ea = angle;
      const x1 = CX + R * Math.cos(sa);
      const y1 = CY + R * Math.sin(sa);
      const x2 = CX + R * Math.cos(ea);
      const y2 = CY + R * Math.sin(ea);
      const la = pct > 0.5 ? 1 : 0;
      return {
        mood: d.mood,
        count: d.count,
        pct,
        path: `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${la} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      };
    });

  return (
    <svg viewBox="0 0 168 168" className="shrink-0 w-40 h-40 sm:w-44 sm:h-44">
      {paths.map((s) => (
        <path key={s.mood} d={s.path} fill={MOOD_HEX[s.mood]}>
          <title>
            {MOOD_LABELS[s.mood as 1 | 2 | 3 | 4 | 5]}: {s.count} ({(s.pct * 100).toFixed(0)}%)
          </title>
        </path>
      ))}
    </svg>
  );
}

// ─── Monthly Breakdown Section ────────────────────────────────────────────────

function MoodMonthlySection({
  monthlyData,
  dailyData,
  moodCounts,
  dowData,
  corrData,
  comboData,
  sleepDailyData,
  chartMode,
  onChartModeChange,
  showSleepBars,
  onShowSleepBarsChange,
  periodMode,
  monthLoading,
  selectedMonth,
}: {
  monthlyData: MonthlyPt[];
  dailyData: DailyPt[];
  moodCounts: MoodCount[];
  dowData: DowPt[];
  corrData: CorrPt[];
  comboData: ComboPt[];
  sleepDailyData: SleepDailyPt[];
  chartMode: 'line' | 'span';
  onChartModeChange: (mode: 'line' | 'span') => void;
  showSleepBars: boolean;
  onShowSleepBarsChange: (show: boolean) => void;
  periodMode: PeriodMode;
  monthLoading: boolean;
  selectedMonth: string;
}) {
  const monthMap = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const p of monthlyData) {
      if (!m.has(p.month)) m.set(p.month, new Map());
      m.get(p.month)!.set(p.mood, p.count);
    }
    return m;
  }, [monthlyData]);

  const pie = useMemo(
    () => {
      if (periodMode === 'all' || periodMode === 'weekly') return moodCounts;
      const months = periodMode === 'single'
        ? [selectedMonth]
        : periodMode === 'triple'
          ? [shiftMonth(selectedMonth, -2), shiftMonth(selectedMonth, -1), selectedMonth]
          : Array.from({ length: 12 }, (_, i) => shiftMonth(selectedMonth, -(11 - i)));

      return ([1, 2, 3, 4, 5] as const).map((m) => ({
        mood: m,
        count: months.reduce((sum, month) => sum + (monthMap.get(month)?.get(m) || 0), 0),
      })) as MoodCount[];
    },
    [monthMap, selectedMonth, periodMode, moodCounts]
  );

  const totalCheckins = moodCounts.reduce((s, d) => s + d.count, 0);
  const avgMood =
    totalCheckins > 0
      ? moodCounts.reduce((s, d) => s + d.mood * d.count, 0) / totalCheckins
      : null;
  const activeDays = dailyData.filter((d) => d.count > 0).length;

  const pieTotal = pie.reduce((s, d) => s + d.count, 0);
  const selLabel = selectedMonth
    ? new Date(selectedMonth + '-01T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';
  const rangeLabel = useMemo(() => getPeriodRangeLabel(selectedMonth, periodMode), [selectedMonth, periodMode]);
  const visibleRange = useMemo(() => getPeriodDateRange(selectedMonth, periodMode), [selectedMonth, periodMode]);
  const sleepTotalsByDate = useMemo(
    () => new Map(sleepDailyData.map((d) => [d.date, Math.max(0, d.total_sleep_minutes || 0)])),
    [sleepDailyData]
  );

  return (
    <div className="space-y-4">
      {totalCheckins > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={Smile} label="Mood Check-ins" value={totalCheckins} />
          <StatCard icon={Activity} label="Avg Mood" value={avgMood !== null ? avgMood.toFixed(1) : '—'} />
          <StatCard icon={CalendarDays} label="Active Days" value={activeDays} />
        </div>
      )}

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
        {/* Pie + legend for selected month */}
        <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr] gap-4 sm:gap-6 items-center">
          <div className="mx-auto sm:mx-0">
            <MoodPieChart slices={pie} />
          </div>
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-1 gap-2 pt-1">
            {([5, 4, 3, 2, 1] as const).map((m) => {
              const cnt = pie.find((d) => d.mood === m)?.count || 0;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    const qp = new URLSearchParams();
                    if (visibleRange.from && visibleRange.to) {
                      qp.set('from', visibleRange.from);
                      qp.set('to', visibleRange.to);
                    }
                    qp.set('mood', String(m));
                    openInNewTab(`/?${qp.toString()}`);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg bg-gray-50/80 dark:bg-gray-800/60 px-2.5 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/25 transition-colors"
                  title={`Open Home filtered to ${MOOD_LABELS[m]} mood for this visible period`}
                >
                  <div className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: MOOD_HEX[m] }} />
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 text-right min-w-[20px]">
                    {cnt}
                  </span>
                  <span className="text-xs text-gray-500">
                    {MOOD_LABELS[m]}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">
                    ({pieTotal ? Math.round((cnt / pieTotal) * 100) : 0}%)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
          <BarChart3 size={16} className="text-indigo-500" />
          Mood Trend
        </h3>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
            {(['line', 'span'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onChartModeChange(m)}
              className={`px-2.5 py-1 font-medium capitalize transition-colors ${chartMode === m
                ? 'bg-indigo-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
            >
              {m}
            </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onShowSleepBarsChange(!showSleepBars)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${showSleepBars
              ? 'bg-teal-500 text-white border-teal-500'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            title="Show or hide total sleep bars with right-axis labels"
          >
            Sleep Bars
          </button>
        </div>

        <div className="relative">
          <div className={monthLoading ? 'opacity-65 transition-opacity' : 'opacity-100 transition-opacity'}>
            <MoodLineSpanChart
              data={dailyData}
              mode={chartMode}
              sleepTotalsByDate={sleepTotalsByDate}
              showSleepBars={showSleepBars}
            />
          </div>
          {monthLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-8 w-8 rounded-full border-2 border-indigo-500/70 border-t-transparent animate-spin bg-white/40 dark:bg-gray-900/30 backdrop-blur-[1px]" />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
          <CalendarDays size={16} className="text-amber-500" />
          Day of Week
        </h3>
        <MoodDowChart data={dowData} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MoodActivityCorrelations data={corrData} />
        <MoodActivityCombinations data={comboData} />
      </div>
    </div>
  );
}

// ─── Day of Week Mood Chart ───────────────────────────────────────────────────

function MoodDowChart({ data }: { data: DowPt[] }) {
  return (
    <div className="">
      {data.every((d) => d.avg_mood === null) ? (
        <p className="text-sm text-gray-400">No mood data yet.</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((d) => {
            const has = d.avg_mood !== null;
            const avg = d.avg_mood ?? 0;
            const rounded = Math.max(1, Math.min(5, Math.round(avg)));
            return (
              <div key={d.day} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8 shrink-0">{d.day.slice(0, 3)}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${has ? (avg / 5) * 100 : 0}%`, backgroundColor: has ? MOOD_HEX[rounded] : '#e5e7eb' }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-8 text-right">
                  {has ? avg.toFixed(1) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Activity–Mood Correlations ───────────────────────────────────────────────

function MoodActivityCorrelations({
  data,
}: {
  data: CorrPt[];
}) {
  type SortKey = keyof CorrPt;
  const [sortKey, setSortKey] = useState<SortKey>('mood_impact');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(col); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const SortInd = ({ col }: { col: SortKey }) => (
    <span className={`ml-0.5 text-[10px] ${sortKey === col ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'}`}>
      {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  );

  const content = (
    <>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-1.5">
        <Activity size={16} className="text-rose-500" />
        Activity Impact
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Average mood lift or drop when an activity appears in a mood check-in.
      </p>
      {!data.length ? (
        <p className="text-sm text-gray-400">
          No activity data yet for this period (need ≥2 entries per activity).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="text-left font-medium text-gray-500 py-1.5 pr-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('activity_name')}>Activity <SortInd col="activity_name" /></th>
                <th className="text-left font-medium text-gray-500 py-1.5 pr-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('group_name')}>Group <SortInd col="group_name" /></th>
                <th className="text-center font-medium text-gray-500 py-1.5 px-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('avg_mood')}>Avg Mood <SortInd col="avg_mood" /></th>
                <th className="text-center font-medium text-gray-500 py-1.5 px-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('mood_impact')}>Impact <SortInd col="mood_impact" /></th>
                <th className="text-right font-medium text-gray-500 py-1.5 pl-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('checkin_count')}>Entries <SortInd col="checkin_count" /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const r = Math.max(1, Math.min(5, Math.round(d.avg_mood)));
                const impactClass = d.mood_impact > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : d.mood_impact < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-500 dark:text-gray-400';
                const impactLabel = `${d.mood_impact > 0 ? '+' : ''}${d.mood_impact.toFixed(2)}`;
                return (
                  <tr
                    key={d.activity_id}
                    onClick={() => openInNewTab(`/?activity=${encodeURIComponent(d.activity_name)}`)}
                    className="cursor-pointer border-b border-gray-50 dark:border-gray-800/50 hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20 transition-colors"
                    title={`Filter Home by "${d.activity_name}"`}
                  >
                    <td className="py-1.5 pr-3 font-medium text-gray-800 dark:text-gray-200">
                      {d.activity_name}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-500">{d.group_name}</td>
                    <td className="py-1.5 px-2 text-center">
                      <span className="font-semibold" style={{ color: MOOD_HEX[r] }}>
                        {d.avg_mood.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={`font-semibold ${impactClass}`}>
                        {impactLabel}
                      </span>
                    </td>
                    <td className="py-1.5 pl-2 text-right text-gray-500">
                      {d.checkin_count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      {content}
    </div>
  );
}

function MoodActivityCombinations({
  data,
}: {
  data: ComboPt[];
}) {
  type SortKey = keyof ComboPt;
  const [sortKey, setSortKey] = useState<SortKey>('mood_impact');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(col); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const SortInd = ({ col }: { col: SortKey }) => (
    <span className={`ml-0.5 text-[10px] ${sortKey === col ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'}`}>
      {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  );

  const content = (
    <>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-1.5">
        <BarChart3 size={16} className="text-fuchsia-500" />
        Activity Combinations
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Repeated sets of two or more activities and how they shift your mood.
      </p>
      {!data.length ? (
        <p className="text-sm text-gray-400">
          No repeated activity combinations yet for this period (need ≥2 matching check-ins).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="text-left font-medium text-gray-500 py-1.5 pr-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('combination_name')}>Combination <SortInd col="combination_name" /></th>
                <th className="text-center font-medium text-gray-500 py-1.5 px-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('avg_mood')}>Avg Mood <SortInd col="avg_mood" /></th>
                <th className="text-center font-medium text-gray-500 py-1.5 px-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('mood_impact')}>Impact <SortInd col="mood_impact" /></th>
                <th className="text-right font-medium text-gray-500 py-1.5 pl-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300" onClick={() => toggleSort('checkin_count')}>Entries <SortInd col="checkin_count" /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const r = Math.max(1, Math.min(5, Math.round(d.avg_mood)));
                const impactClass = d.mood_impact > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : d.mood_impact < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-500 dark:text-gray-400';
                const impactLabel = `${d.mood_impact > 0 ? '+' : ''}${d.mood_impact.toFixed(2)}`;
                return (
                  <tr key={d.combination_key} className="border-b border-gray-50 dark:border-gray-800/50">
                    <td className="py-1.5 pr-3 font-medium text-gray-800 dark:text-gray-200">
                      {d.combination_name}
                      <span className="ml-2 text-[11px] font-normal text-gray-400">
                        ({d.activity_count} activities)
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span className="font-semibold" style={{ color: MOOD_HEX[r] }}>
                        {d.avg_mood.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={`font-semibold ${impactClass}`}>
                        {impactLabel}
                      </span>
                    </td>
                    <td className="py-1.5 pl-2 text-right text-gray-500">
                      {d.checkin_count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      {content}
    </div>
  );
}

// ─── Year in Pixels ───────────────────────────────────────────────────────────

export function MoodYearInPixels({
  data,
  year,
  onYearChange,
  showYearControls = true,
  showTitleIcon = true,
  showTitleYear = true,
}: {
  data: HeatPt[];
  year: number;
  onYearChange?: (y: number) => void;
  showYearControls?: boolean;
  showTitleIcon?: boolean;
  showTitleYear?: boolean;
}) {
  const dayMap = new Map(data.map((d) => [d.date, d.avg_mood]));
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  const allDays: { date: string; mood: number | null }[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const ds = isoDate(cur);
    const v = dayMap.get(ds);
    allDays.push({ date: ds, mood: v !== undefined ? v : null });
    cur.setDate(cur.getDate() + 1);
  }

  const startDow = new Date(startDate).getDay();
  const padded = [
    ...Array.from({ length: startDow }, () => null as null),
    ...allDays,
  ];

  const weeks: (typeof padded)[] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentYear = new Date().getFullYear();

  return (
    <div className="">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          {showTitleIcon ? <Smile size={16} className="text-emerald-500" /> : null}
          {showTitleYear ? `${year} Year in Pixels` : 'Year in Pixels'}
        </h3>
        {showYearControls && onYearChange && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onYearChange(year - 1)}
              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-medium text-gray-500 w-10 text-center">{year}</span>
            {year < currentYear && (
              <button
                onClick={() => onYearChange(year + 1)}
                className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {/* Month labels */}
        <div className="relative h-4 mb-1" style={{ minWidth: weeks.length * 15 }}>
          {MN.map((m, i) => {
            const wk = Math.floor((i * 52) / 12);
            return (
              <span
                key={m}
                className="absolute text-[10px] text-gray-400"
                style={{ left: wk * 15 }}
              >
                {m}
              </span>
            );
          })}
        </div>

        {/* Grid */}
        <div className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) => {
                if (day === null) {
                  return <div key={di} className="w-[12px] h-[12px]" />;
                }
                if (day.mood === null) {
                  return (
                    <div
                      key={di}
                      className="w-[12px] h-[12px] rounded-sm bg-gray-100 dark:bg-gray-800"
                      title={`${day.date}: no data`}
                    />
                  );
                }
                const r = Math.max(1, Math.min(5, Math.round(day.mood)));
                return (
                  <div
                    key={di}
                    className="w-[12px] h-[12px] rounded-sm cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 dark:hover:ring-gray-500"
                    style={{ backgroundColor: MOOD_HEX[r] }}
                    title={`${day.date}: avg ${day.mood.toFixed(1)}`}
                    onClick={() => openInNewTab(`/?from=${day.date}&to=${day.date}`)}
                  />
                );
              })}
              {week.length < 7 &&
                Array.from({ length: 7 - week.length }, (_, k) => (
                  <div key={`p${k}`} className="w-[12px] h-[12px]" />
                ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1 mt-2 justify-start">
          <span className="text-[10px] text-gray-400 mr-1">{MOOD_LABELS[1]}</span>
          {([1, 2, 3, 4, 5] as const).map((m) => (
            <div key={m} className="w-[12px] h-[12px] rounded-sm" style={{ backgroundColor: MOOD_HEX[m] }} />
          ))}
          <span className="text-[10px] text-gray-400 ml-1">{MOOD_LABELS[5]}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Moods Tab ───────────────────────────────────────────────────────────

export function MoodsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMonthParam = isValidMonthParam(searchParams.get('moodsMonth'))
    ? searchParams.get('moodsMonth')
    : null;
  const initialWeekParam = isValidDateParam(searchParams.get('moodsWeek'))
    ? searchParams.get('moodsWeek')
    : null;
  const initialPeriodParam = parsePeriodParam(searchParams.get('moodsPeriod'));
  const [chartMode, setChartMode] = useState<'line' | 'span'>('line');
  const [periodMode, setPeriodMode] = useState<PeriodMode>(initialPeriodParam ?? 'single');
  const [year, setYear] = useState(initialMonthParam ? parseInt(initialMonthParam.slice(0, 4), 10) : new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(initialMonthParam ?? '');
  const [selectedWeek, setSelectedWeek] = useState(initialWeekParam ?? getCurrentDateIso());

  const [dailyData, setDailyData] = useState<DailyPt[]>([]);
  const [moodCounts, setMoodCounts] = useState<MoodCount[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyPt[]>([]);
  const [dowData, setDowData] = useState<DowPt[]>([]);
  const [corrData, setCorrData] = useState<CorrPt[]>([]);
  const [comboData, setComboData] = useState<ComboPt[]>([]);
  const [sleepDailyData, setSleepDailyData] = useState<SleepDailyPt[]>([]);
  const [showSleepBars, setShowSleepBars] = useState(false);
  const [monthLoading, setMonthLoading] = useState(true);

  // Year-scoped data
  useEffect(() => {
    stats.moodMonthly(USER_ID, year)
      .then((monthly) => {
        setMonthlyData(monthly);
      })
      .catch(console.error);
  }, [year]);

  // Default selected month for the chosen year
  useEffect(() => {
    if (selectedMonth.startsWith(`${year}-`)) {
      return;
    }

    setSelectedMonth(resolveMonthForYear(year, monthlyData.map((month) => month.month)));
  }, [monthlyData, year, selectedMonth]);

  useEffect(() => {
    const monthParam = isValidMonthParam(searchParams.get('moodsMonth')) ? searchParams.get('moodsMonth') : null;
    const weekParam = isValidDateParam(searchParams.get('moodsWeek')) ? searchParams.get('moodsWeek') : null;
    const periodParam = parsePeriodParam(searchParams.get('moodsPeriod'));

    if (periodParam && periodParam !== periodMode) {
      setPeriodMode(periodParam);
    }

    if (monthParam && monthParam !== selectedMonth) {
      setSelectedMonth(monthParam);
      const monthYear = parseInt(monthParam.slice(0, 4), 10);
      if (monthYear !== year) {
        setYear(monthYear);
      }
    }

    if (weekParam && weekParam !== selectedWeek) {
      setSelectedWeek(weekParam);
      const weekYear = parseInt(weekParam.slice(0, 4), 10);
      if (weekYear !== year) {
        setYear(weekYear);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedMonth) return;

    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (next.get('tab') !== 'moods') {
      next.set('tab', 'moods');
      changed = true;
    }
    if (next.get('moodsMonth') !== selectedMonth) {
      next.set('moodsMonth', selectedMonth);
      changed = true;
    }
    if (next.get('moodsPeriod') !== periodMode) {
      next.set('moodsPeriod', periodMode);
      changed = true;
    }
    if (next.get('moodsWeek') !== selectedWeek) {
      next.set('moodsWeek', selectedWeek);
      changed = true;
    }

    if (changed) {
      setSearchParams(next, { replace: true });
    }
  }, [periodMode, searchParams, selectedMonth, selectedWeek, setSearchParams]);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  // Selected-month data (line/span + count summary)
  useEffect(() => {
    const isAll = periodMode === 'all';
    if (!isAll && !visibleRange.from) return;

    const rangeStart = isAll ? undefined : visibleRange.from;
    const rangeEnd = isAll ? undefined : visibleRange.to;

    setMonthLoading(true);
    Promise.all([
      stats.moodDaily(USER_ID, rangeStart, rangeEnd),
      stats.moodCountRange(USER_ID, rangeStart, rangeEnd),
      stats.moodByDayOfWeek(USER_ID, rangeStart, rangeEnd),
      stats.moodActivityCorrelations(USER_ID, rangeStart, rangeEnd),
      stats.moodActivityCombinations(USER_ID, rangeStart, rangeEnd),
      stats.sleepDaily(USER_ID, rangeStart, rangeEnd),
    ])
      .then(([daily, counts, dow, corr, combos, sleepDaily]) => {
        setDailyData(daily);
        setMoodCounts(counts);
        setDowData(dow);
        setCorrData(corr);
        setComboData(combos);
        setSleepDailyData(sleepDaily);
      })
      .catch(console.error)
      .finally(() => setMonthLoading(false));
  }, [periodMode, visibleRange.from, visibleRange.to]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PeriodRangeSelector
          periodMode={periodMode}
          onPeriodModeChange={setPeriodMode}
          year={year}
          onYearChange={setYear}
          selectedMonth={selectedMonth}
          selectedWeek={selectedWeek}
          onSelectedWeekChange={setSelectedWeek}
          onSelectedMonthChange={(month) => {
            setSelectedMonth(month);
            const nextYear = parseInt(month.slice(0, 4), 10);
            if (nextYear !== year) setYear(nextYear);
          }}
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              openInNewTab(`/?from=${visibleRange.from}&to=${visibleRange.to}`);
            } else {
              openInNewTab('/');
            }
          }}
        />
      </div>

      <MoodMonthlySection
        monthlyData={monthlyData}
        dailyData={dailyData}
        moodCounts={moodCounts}
        dowData={dowData}
        corrData={corrData}
        comboData={comboData}
        sleepDailyData={sleepDailyData}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        showSleepBars={showSleepBars}
        onShowSleepBarsChange={setShowSleepBars}
        periodMode={periodMode}
        monthLoading={monthLoading}
        selectedMonth={selectedMonth}
      />

    </div>
  );
}
