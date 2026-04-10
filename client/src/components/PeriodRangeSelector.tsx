import { ChevronLeft, ChevronRight, House, RotateCcw } from 'lucide-react';
import {
  MONTH_NAMES,
  PeriodMode,
  getAdditionalIncludedMonths,
  getCurrentDateIso,
  getCurrentMonthIso,
  getVisibleMonths,
  getVisibleWeeks,
  isValidDateParam,
  shiftDateDays,
  shiftMonth,
} from '../utils/periodRange';

interface PeriodRangeSelectorProps {
  periodMode: PeriodMode;
  onPeriodModeChange: (mode: PeriodMode) => void;
  year: number;
  onYearChange: (year: number) => void;
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
  selectedWeek?: string;
  onSelectedWeekChange?: (weekEndIso: string) => void;
  resetMode?: PeriodMode;
  allTimeLabel?: string;
  allTimeStartDate?: string;
  onOpenHome?: () => void;
}

export function PeriodRangeSelector({
  periodMode,
  onPeriodModeChange,
  year,
  onYearChange,
  selectedMonth,
  onSelectedMonthChange,
  selectedWeek,
  onSelectedWeekChange,
  resetMode = 'triple',
  allTimeLabel = 'All available data',
  allTimeStartDate,
  onOpenHome,
}: PeriodRangeSelectorProps) {
  const currentYear = new Date().getFullYear();
  const currentMonthIso = getCurrentMonthIso();
  const currentDateIso = getCurrentDateIso();
  const additionalIncludedMonths = getAdditionalIncludedMonths(selectedMonth, periodMode);
  const visibleMonths = getVisibleMonths(selectedMonth, year);
  const effectiveSelectedWeek = isValidDateParam(selectedWeek ?? null)
    ? (selectedWeek as string)
    : currentDateIso;
  const visibleWeeks = getVisibleWeeks(effectiveSelectedWeek);

  const selectMonth = (month: string) => {
    onSelectedMonthChange(month);
    const nextYear = parseInt(month.slice(0, 4), 10);
    if (nextYear !== year) {
      onYearChange(nextYear);
    }
  };

  const selectWeek = (weekEndIso: string) => {
    onSelectedWeekChange?.(weekEndIso);
    const nextYear = parseInt(weekEndIso.slice(0, 4), 10);
    if (nextYear !== year) {
      onYearChange(nextYear);
    }
  };

  const formatWeekLabel = (weekEndIso: string): string => {
    const [year, month, day] = weekEndIso.split('-').map((value) => parseInt(value, 10));
    const end = new Date(year, month - 1, day);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const resetToDefaultView = () => {
    onPeriodModeChange(resetMode);
    onYearChange(currentYear);
    onSelectedMonthChange(currentMonthIso);
    onSelectedWeekChange?.(currentDateIso);
  };

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
        {([
          { label: '1W', value: 'weekly' as const },
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
        <button
          type="button"
          onClick={resetToDefaultView}
          className="shrink-0 rounded-md p-1 text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300"
          title="Reset to current month and 3-month view"
          aria-label="Reset to current month and 3-month view"
        >
          <RotateCcw size={14} />
        </button>
        {onOpenHome && (
          <button
            type="button"
            onClick={onOpenHome}
            className="shrink-0 rounded-md p-1 text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-900/20 dark:hover:text-primary-300"
            title="Open selected period in Home"
            aria-label="Open selected period in Home"
          >
            <House size={14} />
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {periodMode !== 'all' && (
          <button
            type="button"
            onClick={() => {
              if (periodMode === 'weekly') {
                selectWeek(shiftDateDays(effectiveSelectedWeek, -7));
              } else if (selectedMonth) {
                selectMonth(shiftMonth(selectedMonth, -1));
              }
            }}
            className="shrink-0 rounded-md bg-gray-100 px-1.5 py-1 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30"
            title={periodMode === 'weekly' ? 'Previous week' : 'Previous month'}
            aria-label={periodMode === 'weekly' ? 'Previous week' : 'Previous month'}
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {periodMode === 'all' ? (
          <div className="min-w-0 flex-1 flex items-center">
            <span className="text-[11px] text-gray-400 italic">
              {allTimeStartDate ? `${allTimeStartDate} to Present` : allTimeLabel}
            </span>
          </div>
        ) : periodMode === 'weekly' ? (
          <div className="relative h-6 min-w-0 flex-1 overflow-hidden">
            <div className="absolute right-0 top-0 flex w-max flex-nowrap gap-0.5">
              {visibleWeeks.map((weekEndIso) => {
                const isSelected = weekEndIso === effectiveSelectedWeek;
                return (
                  <button
                    key={weekEndIso}
                    type="button"
                    onClick={() => selectWeek(weekEndIso)}
                    className={`shrink-0 h-6 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${isSelected
                      ? 'bg-violet-500 text-white font-semibold'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                      }`}
                    title={formatWeekLabel(weekEndIso)}
                  >
                    {formatWeekLabel(weekEndIso)}
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white/95 via-white/70 to-transparent dark:from-gray-900/95 dark:via-gray-900/70 dark:to-transparent" />
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
                    className={`shrink-0 h-6 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${isSelected
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
            onClick={() => {
              if (periodMode === 'weekly') {
                selectWeek(shiftDateDays(effectiveSelectedWeek, 7));
              } else if (selectedMonth) {
                selectMonth(shiftMonth(selectedMonth, 1));
              }
            }}
            disabled={
              periodMode === 'weekly'
                ? effectiveSelectedWeek >= currentDateIso
                : (!selectedMonth || selectedMonth >= currentMonthIso)
            }
            className="shrink-0 rounded-md bg-gray-100 px-1.5 py-1 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-40 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-800"
            title={periodMode === 'weekly' ? 'Next week' : 'Next month'}
            aria-label={periodMode === 'weekly' ? 'Next week' : 'Next month'}
          >
            <ChevronRight size={16} />
          </button>
        )}
        </div>
    </div>
  );
}