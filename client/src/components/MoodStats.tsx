import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  CalendarDays,
  BarChart3,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { stats } from '../api/client';
import { MoodIcon } from './MoodIcons';

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
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
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
  checkin_count: number;
};
type HeatPt = { date: string; avg_mood: number };
type MoodCount = { mood: number; count: number };

// ─── SVG Line/Span Chart ──────────────────────────────────────────────────────

const SW = 560, SH = 180, PL = 30, PR = 10, PT = 12, PB = 28;
const CW = SW - PL - PR;
const CH = SH - PT - PB;

function toX(i: number, n: number): number {
  return n <= 1 ? PL + CW / 2 : PL + (i / (n - 1)) * CW;
}
function toY(m: number): number {
  return PT + ((5 - m) / 4) * CH;
}

function MoodLineSpanChart({ data, mode }: { data: DailyPt[]; mode: 'line' | 'span' }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-36 text-sm text-gray-400">
        No mood data in this period
      </div>
    );
  }

  const n = data.length;

  // X ticks: one per month boundary
  const xticks: { x: number; label: string }[] = [];
  let pm = '';
  data.forEach((d, i) => {
    const mo = d.date.slice(0, 7);
    if (mo !== pm) {
      xticks.push({
        x: toX(i, n),
        label: new Date(d.date + 'T12:00').toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      });
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

  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full" style={{ height: SH, display: 'block' }}>
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
        <g key={t.label}>
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
    </svg>
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
      <div className="flex items-center justify-center w-[120px] h-[120px] text-xs text-gray-400">
        No data
      </div>
    );
  }

  const CX = 60, CY = 60, R = 56;
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
    <svg viewBox="0 0 120 120" width={120} height={120} className="shrink-0">
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
  year,
  onYearChange,
}: {
  monthlyData: MonthlyPt[];
  year: number;
  onYearChange: (y: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState('');

  const monthMap = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const p of monthlyData) {
      if (!m.has(p.month)) m.set(p.month, new Map());
      m.get(p.month)!.set(p.mood, p.count);
    }
    return m;
  }, [monthlyData]);

  useEffect(() => {
    const months = [...monthMap.keys()].sort();
    const cm = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const target = months.includes(cm) ? cm : months.length ? months[months.length - 1] : cm;
    setSelectedMonth(target);
  }, [monthMap, year]);

  const pie = useMemo(
    () =>
      ([1, 2, 3, 4, 5] as const).map((m) => ({
        mood: m,
        count: monthMap.get(selectedMonth)?.get(m) || 0,
      })) as MoodCount[],
    [monthMap, selectedMonth]
  );

  const allMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const pieTotal = pie.reduce((s, d) => s + d.count, 0);
  const selLabel = selectedMonth
    ? new Date(selectedMonth + '-01T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <CalendarDays size={16} className="text-violet-500" />
          Monthly Mood Breakdown
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onYearChange(year - 1)}
            className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400 w-12 text-center">
            {year}
          </span>
          {year < currentYear && (
            <button
              onClick={() => onYearChange(year + 1)}
              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Pie + legend for selected month */}
      <div className="flex items-start gap-4 mb-5">
        <div>
          <p className="text-xs text-gray-500 mb-1 text-center">{selLabel}</p>
          <MoodPieChart slices={pie} />
        </div>
        <div className="flex flex-col gap-1.5 pt-1">
          {([5, 4, 3, 2, 1] as const).map((m) => {
            const cnt = pie.find((d) => d.mood === m)?.count || 0;
            return (
              <div key={m} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: MOOD_HEX[m] }} />
                <span className="text-xs text-gray-600 dark:text-gray-400 w-16">{MOOD_LABELS[m]}</span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 w-6 text-right">
                  {cnt}
                </span>
                <span className="text-[10px] text-gray-400">
                  ({pieTotal ? Math.round((cnt / pieTotal) * 100) : 0}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Month picker */}
      <div className="flex flex-wrap gap-1 mb-4">
        {allMonths.map((m, i) => {
          const hasData = monthMap.has(m);
          const isSel = m === selectedMonth;
          return (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              disabled={!hasData}
              className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
                isSel
                  ? 'bg-violet-500 text-white font-semibold'
                  : hasData
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              {MONTH_NAMES[i]}
            </button>
          );
        })}
      </div>

      {/* Monthly counts table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="text-left font-medium text-gray-500 py-1 pr-3">Month</th>
              {([1, 2, 3, 4, 5] as const).map((m) => (
                <th key={m} className="py-1 px-1">
                  <div className="flex justify-center">
                    <MoodIcon mood={m} size={12} />
                  </div>
                </th>
              ))}
              <th className="text-right font-medium text-gray-500 py-1 pl-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {allMonths.map((month, i) => {
              const mmap = monthMap.get(month);
              if (!mmap) return null;
              const total = [...mmap.values()].reduce((s, v) => s + v, 0);
              return (
                <tr
                  key={month}
                  onClick={() => setSelectedMonth(month)}
                  className={`cursor-pointer border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors ${
                    month === selectedMonth ? 'bg-violet-50/50 dark:bg-violet-900/10' : ''
                  }`}
                >
                  <td className="py-1 pr-3 font-medium text-gray-700 dark:text-gray-300">
                    {MONTH_NAMES[i]}
                  </td>
                  {([1, 2, 3, 4, 5] as const).map((m) => {
                    const cnt = mmap.get(m) || 0;
                    return (
                      <td key={m} className="text-center py-1 px-1">
                        {cnt > 0 ? (
                          <span className={`font-medium ${MOOD_TEXT[m]}`}>{cnt}</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right py-1 pl-3 font-semibold text-gray-700 dark:text-gray-300">
                    {total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!monthlyData.length && (
          <p className="text-sm text-gray-400 text-center py-3">No mood data for {year}</p>
        )}
      </div>
    </div>
  );
}

// ─── Day of Week Mood Chart ───────────────────────────────────────────────────

function MoodDowChart({ data }: { data: DowPt[] }) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <BarChart3 size={16} className="text-sky-500" />
        Mood by Day of Week
      </h3>
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

function MoodActivityCorrelations({ data }: { data: CorrPt[] }) {
  const navigate = useNavigate();
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Activity size={16} className="text-rose-500" />
        Activity–Mood Correlations
      </h3>
      {!data.length ? (
        <p className="text-sm text-gray-400">
          No activity data yet (need ≥2 entries per activity).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="text-left font-medium text-gray-500 py-1.5 pr-3">Activity</th>
                <th className="text-left font-medium text-gray-500 py-1.5 pr-3">Group</th>
                <th className="text-center font-medium text-gray-500 py-1.5 px-2">Avg Mood</th>
                <th className="text-right font-medium text-gray-500 py-1.5 pl-2">Entries</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const r = Math.max(1, Math.min(5, Math.round(d.avg_mood)));
                return (
                  <tr
                    key={d.activity_id}
                    onClick={() => navigate(`/?activity=${encodeURIComponent(d.activity_name)}`)}
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
    </div>
  );
}

// ─── Year in Pixels ───────────────────────────────────────────────────────────

function MoodYearInPixels({
  data,
  year,
  onYearChange,
}: {
  data: HeatPt[];
  year: number;
  onYearChange: (y: number) => void;
}) {
  const navigate = useNavigate();
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
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <CalendarDays size={16} className="text-emerald-500" />
          {year} Year in Pixels
        </h3>
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
                    title={`${day.date}: avg ${day.mood.toFixed(1)} — click to view`}
                    onClick={() => navigate(`/?from=${day.date}&to=${day.date}`)}
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
        <div className="flex items-center gap-2 mt-2">
          <div className="w-[12px] h-[12px] rounded-sm bg-gray-100 dark:bg-gray-800" />
          <span className="text-[10px] text-gray-400 mr-2">No data</span>
          {([1, 2, 3, 4, 5] as const).map((m) => (
            <div key={m} className="flex items-center gap-0.5">
              <div className="w-[12px] h-[12px] rounded-sm" style={{ backgroundColor: MOOD_HEX[m] }} />
              <span className="text-[10px] text-gray-400">{MOOD_LABELS[m]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Moods Tab ───────────────────────────────────────────────────────────

export function MoodsTab() {
  const [chartRange, setChartRange] = useState<1 | 3>(1);
  const [chartMode, setChartMode] = useState<'line' | 'span'>('line');
  const [year, setYear] = useState(new Date().getFullYear());

  const [dailyData, setDailyData] = useState<DailyPt[]>([]);
  const [moodCounts, setMoodCounts] = useState<MoodCount[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyPt[]>([]);
  const [dowData, setDowData] = useState<DowPt[]>([]);
  const [corrData, setCorrData] = useState<CorrPt[]>([]);
  const [heatData, setHeatData] = useState<HeatPt[]>([]);
  const [rangeLoading, setRangeLoading] = useState(true);

  // Static data — loaded once
  useEffect(() => {
    Promise.all([
      stats.moodByDayOfWeek(USER_ID),
      stats.moodActivityCorrelations(USER_ID),
    ])
      .then(([dow, corr]) => {
        setDowData(dow);
        setCorrData(corr);
      })
      .catch(console.error);
  }, []);

  // Year-scoped data
  useEffect(() => {
    Promise.all([
      stats.moodMonthly(USER_ID, year),
      stats.moodHeatmap(USER_ID, year),
    ])
      .then(([monthly, heat]) => {
        setMonthlyData(monthly);
        setHeatData(heat);
      })
      .catch(console.error);
  }, [year]);

  // Range-scoped data
  useEffect(() => {
    const to = new Date();
    const from = addMonths(to, -chartRange);
    setRangeLoading(true);
    Promise.all([
      stats.moodDaily(USER_ID, isoDate(from), isoDate(to)),
      stats.moodCountRange(USER_ID, isoDate(from), isoDate(to)),
    ])
      .then(([daily, counts]) => {
        setDailyData(daily);
        setMoodCounts(counts);
      })
      .catch(console.error)
      .finally(() => setRangeLoading(false));
  }, [chartRange]);

  return (
    <div className="space-y-6">
      {/* Mood Over Time */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <TrendingUp size={16} className="text-indigo-500" />
            Mood Over Time
          </h3>
          <div className="flex items-center gap-2">
            {/* Range picker */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
              {([1, 3] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`px-2.5 py-1 font-medium transition-colors ${
                    chartRange === r
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {r}mo
                </button>
              ))}
            </div>
            {/* Chart mode */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
              {(['line', 'span'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  className={`px-2.5 py-1 font-medium capitalize transition-colors ${
                    chartMode === m
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rangeLoading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <MoodLineSpanChart data={dailyData} mode={chartMode} />
        )}

        <MoodCountSummary data={moodCounts} />
      </div>

      {/* Monthly breakdown */}
      <MoodMonthlySection monthlyData={monthlyData} year={year} onYearChange={setYear} />

      {/* Day of week */}
      <MoodDowChart data={dowData} />

      {/* Activity correlations */}
      <MoodActivityCorrelations data={corrData} />

      {/* Year in pixels */}
      <MoodYearInPixels data={heatData} year={year} onYearChange={setYear} />
    </div>
  );
}
