import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import {
  MONTH_NAMES,
  PeriodMode,
  getAdditionalIncludedMonths,
  getCurrentMonthIso,
  getVisibleMonths,
  shiftMonth,
} from '../utils/periodRange';

interface PeriodRangeSelectorProps {
  periodMode: PeriodMode;
  onPeriodModeChange: (mode: PeriodMode) => void;
  year: number;
  onYearChange: (year: number) => void;
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
  resetMode?: PeriodMode;
  allTimeLabel?: string;
}

export function PeriodRangeSelector({
  periodMode,
  onPeriodModeChange,
  year,
  onYearChange,
  selectedMonth,
  onSelectedMonthChange,
  resetMode = 'triple',
  allTimeLabel = 'All available data',
}: PeriodRangeSelectorProps) {
  const currentYear = new Date().getFullYear();
  const currentMonthIso = getCurrentMonthIso();
  const additionalIncludedMonths = getAdditionalIncludedMonths(selectedMonth, periodMode);
  const visibleMonths = getVisibleMonths(selectedMonth, year);

  const selectMonth = (month: string) => {
    onSelectedMonthChange(month);
    const nextYear = parseInt(month.slice(0, 4), 10);
    if (nextYear !== year) {
      onYearChange(nextYear);
    }
  };

  const resetToDefaultView = () => {
    onPeriodModeChange(resetMode);
    onYearChange(currentYear);
    onSelectedMonthChange(currentMonthIso);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={resetToDefaultView}
        className="shrink-0 rounded-md p-1 text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300"
        title="Reset to current month and 3-month view"
        aria-label="Reset to current month and 3-month view"
      >
        <RotateCcw size={14} />
      </button>
      <div className="flex shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
        {([
          { label: '1M', value: 'single' as const },
          { label: '3M', value: 'triple' as const },
          { label: '12M', value: 'twelve' as const },
          { label: 'All', value: 'all' as const },
        ]).map(({ label, value }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPeriodModeChange(value)}
            className={`px-2.5 py-1 font-medium transition-colors ${periodMode === value
              ? 'bg-violet-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      {periodMode !== 'all' && (
        <button
          type="button"
          onClick={() => selectedMonth && selectMonth(shiftMonth(selectedMonth, -1))}
          className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30"
          title="Previous month"
          aria-label="Previous month"
        >
          <ChevronLeft size={12} />
        </button>
      )}
      {periodMode === 'all' ? (
        <div className="min-w-0 flex-1 flex items-center">
          <span className="text-[11px] text-gray-400 italic">{allTimeLabel}</span>
        </div>
      ) : (
        <div className="relative h-6 min-w-0 flex-1 overflow-hidden">
          <div className="absolute right-0 top-0 flex w-max flex-nowrap gap-0.5">
            {visibleMonths.map((month) => {
              const isSelected = month === selectedMonth;
              const isIncludedPreviousMonth = additionalIncludedMonths.has(month);
              const [monthYear, monthIndex] = month.split('-').map((value) => parseInt(value, 10));
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => selectMonth(month)}
                  className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${isSelected
                    ? 'bg-violet-500 text-white font-semibold'
                    : isIncludedPreviousMonth
                      ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                    }`}
                  title={`${MONTH_NAMES[monthIndex - 1]} ${monthYear}`}
                >
                  {MONTH_NAMES[monthIndex - 1]} '{String(monthYear).slice(2)}
                </button>
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white/95 via-white/70 to-transparent dark:from-gray-900/95 dark:via-gray-900/70 dark:to-transparent" />
        </div>
      )}
      {periodMode !== 'all' && (
        <button
          type="button"
          onClick={() => selectedMonth && selectMonth(shiftMonth(selectedMonth, 1))}
          disabled={!selectedMonth || selectedMonth >= currentMonthIso}
          className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-40 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-800"
          title="Next month"
          aria-label="Next month"
        >
          <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}