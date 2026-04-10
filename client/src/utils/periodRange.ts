export type PeriodMode = 'single' | 'weekly' | 'triple' | 'twelve' | 'all';

const PERIOD_VALUES: PeriodMode[] = ['single', 'weekly', 'triple', 'twelve', 'all'];

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function isValidMonthParam(value: string | null): value is string {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function parsePeriodParam(value: string | null): PeriodMode | null {
  return value !== null && PERIOD_VALUES.includes(value as PeriodMode)
    ? (value as PeriodMode)
    : null;
}

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidDateParam(value: string | null): value is string {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value);
}

export function getCurrentDateIso(baseDate = new Date()): string {
  return isoDate(baseDate);
}

export function shiftDateDays(iso: string, deltaDays: number): string {
  const [year, month, day] = iso.split('-').map((value) => parseInt(value, 10));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + deltaDays);
  return isoDate(date);
}

export function getCurrentMonthIso(baseDate = new Date()): string {
  return `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map((value) => parseInt(value, 10));
  const date = new Date(year, monthIndex - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getVisibleMonths(selectedMonth: string, year: number, total = 24): string[] {
  if (!selectedMonth) {
    return Array.from({ length: total }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  }

  const endOffset = Math.floor(total / 6);
  const startOffset = total - endOffset - 1;
  return Array.from({ length: total }, (_, index) => shiftMonth(selectedMonth, index - startOffset));
}

export function getVisibleWeeks(selectedWeekEndIso: string, total = 11): string[] {
  const endOffset = Math.floor(total / 6);
  const startOffset = total - endOffset - 1;
  return Array.from({ length: total }, (_, index) => shiftDateDays(selectedWeekEndIso, (index - startOffset) * 7));
}

export function getAdditionalIncludedMonths(selectedMonth: string, periodMode: PeriodMode): Set<string> {
  if (!selectedMonth || periodMode === 'single' || periodMode === 'weekly' || periodMode === 'all') {
    return new Set<string>();
  }

  const monthsToInclude = periodMode === 'triple' ? 2 : 11;
  const months = new Set<string>();
  for (let index = 1; index <= monthsToInclude; index += 1) {
    months.add(shiftMonth(selectedMonth, -index));
  }
  return months;
}

export function getPeriodDateRange(selectedMonth: string, periodMode: PeriodMode, selectedWeekEndIso?: string): { from: string; to: string } {
  if (periodMode === 'all' || !selectedMonth) {
    return { from: '', to: '' };
  }

  if (periodMode === 'weekly') {
    const weeklyAnchor = selectedWeekEndIso ?? getCurrentDateIso();
    const [year, month, day] = weeklyAnchor.split('-').map((value) => parseInt(value, 10));
    const endDate = new Date(year, month - 1, day);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    return {
      from: isoDate(startDate),
      to: isoDate(endDate),
    };
  }

  const [year, month] = selectedMonth.split('-').map((value) => parseInt(value, 10));
  const endDate = new Date(year, month, 0);

  const startDate = periodMode === 'single'
    ? new Date(year, month - 1, 1)
    : periodMode === 'triple'
      ? new Date(year, month - 3, 1)
      : new Date(year, month - 12, 1);

  return {
    from: isoDate(startDate),
    to: isoDate(endDate),
  };
}

export function getPeriodRangeLabel(selectedMonth: string, periodMode: PeriodMode, selectedWeekEndIso?: string): string {
  if (periodMode === 'all') {
    return 'All Time';
  }

  if (!selectedMonth) {
    return '';
  }

  const selectedDate = new Date(`${selectedMonth}-01T12:00:00`);
  if (periodMode === 'single') {
    return selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  if (periodMode === 'weekly') {
    const weeklyAnchor = selectedWeekEndIso ?? getCurrentDateIso();
    const [year, month, day] = weeklyAnchor.split('-').map((value) => parseInt(value, 10));
    const end = new Date(year, month - 1, day);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  const monthsBack = periodMode === 'triple' ? 3 : 12;
  const [year, month] = selectedMonth.split('-').map((value) => parseInt(value, 10));
  const start = new Date(year, month - monthsBack, 1);
  const end = new Date(year, month - 1, 1);
  return `${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

export function resolveMonthForYear(year: number, months: string[]): string {
  const sortedMonths = [...new Set(months)].sort();
  const currentMonth = getCurrentMonthIso();
  const matchingCurrentMonth = currentMonth.startsWith(`${year}-`) ? currentMonth : null;

  if (matchingCurrentMonth && sortedMonths.includes(matchingCurrentMonth)) {
    return matchingCurrentMonth;
  }

  const lastMonthInYear = sortedMonths.filter((month) => month.startsWith(`${year}-`)).at(-1);
  return lastMonthInYear ?? `${year}-01`;
}