import { MapPinCheck } from 'lucide-react';
import type { HeatmapDay } from '../types';

export function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex items-center gap-2 text-gray-500 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

export function Heatmap({
  days,
  year,
  onYearChange,
  onDayClick,
  showTitleIcon = true,
  showTitleYear = true,
}: {
  days: HeatmapDay[];
  year: number;
  onYearChange?: (year: number) => void;
  onDayClick?: (date: string) => void;
  showTitleIcon?: boolean;
  showTitleYear?: boolean;
}) {
  const dayMap = new Map(days.map((d) => [d.date, d.count]));
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  // Build array of all days in the year using local dates to match server YYYY-MM-DD format
  const allDays: { date: string; count: number }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    allDays.push({ date: dateStr, count: dayMap.get(dateStr) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Pad start so first week begins on Sunday
  const startDow = new Date(startDate).getDay();
  const paddedDays = [
    ...Array.from({ length: startDow }, () => null),
    ...allDays,
  ];

  // Split into weeks (columns)
  const weeks: (typeof paddedDays)[] = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    weeks.push(paddedDays.slice(i, i + 7));
  }

  const maxCount = Math.max(...allDays.map((d) => d.count), 1);

  function getColor(count: number): string {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 'bg-primary-200';
    if (ratio <= 0.5) return 'bg-primary-300';
    if (ratio <= 0.75) return 'bg-primary-500';
    return 'bg-primary-700';
  }

  const monthLabels = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const currentYear = new Date().getFullYear();

  return (
    <div className="">
      <div className="flex items-center justify-start mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          {showTitleIcon ? <MapPinCheck size={16} className="text-primary-600" /> : null}
          {showTitleYear ? `${year} Activity` : 'Venue Activity'}
        </h3>
        {onYearChange && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onYearChange(year - 1)}
              className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
            >
              &larr; {year - 1}
            </button>
            {year < currentYear && (
              <button
                onClick={() => onYearChange(year + 1)}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
              >
                {year + 1} &rarr;
              </button>
            )}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        {/* Month labels */}
        <div className="flex gap-[3px] mb-1 ml-0">
          {monthLabels.map((m, i) => {
            // Approximate position: each month ~4.3 weeks
            const weekIndex = Math.floor((i * 52) / 12);
            return (
              <span
                key={m}
                className="text-[10px] text-gray-400"
                style={{
                  position: 'relative',
                  left: `${weekIndex * 15}px`,
                }}
              >
                {i % 2 === 0 ? m : ''}
              </span>
            );
          })}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) => (
                <div
                  key={di}
                  className={`w-[12px] h-[12px] rounded-sm ${
                    day ? getColor(day.count) : 'bg-transparent'
                  } ${day && day.count > 0 && onDayClick ? 'cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1' : ''}`}
                  title={day ? `${day.date}: ${day.count} check-in${day.count !== 1 ? 's' : ''}` : ''}
                  onClick={() => {
                    if (day && day.count > 0 && onDayClick) {
                      onDayClick(day.date);
                    }
                  }}
                />
              ))}
              {/* Pad incomplete weeks at the end */}
              {week.length < 7 &&
                Array.from({ length: 7 - week.length }, (_, k) => (
                  <div key={`pad-${k}`} className="w-[12px] h-[12px]" />
                ))}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-1 mt-2 justify-start">
          <span className="text-[10px] text-gray-400 mr-1">Fewer</span>
          <div className="w-[12px] h-[12px] rounded-sm bg-gray-100 dark:bg-gray-800" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-200" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-300" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-500" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-700" />
          <span className="text-[10px] text-gray-400 ml-1">More</span>
        </div>
      </div>
    </div>
  );
}
