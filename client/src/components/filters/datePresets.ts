/**
 * Quick date-range presets for the Home timeline filters. Dates are local
 * calendar days as `YYYY-MM-DD`; `from`/`to` are inclusive and an empty
 * string means "open-ended".
 */

export type DatePresetId = 'today' | 'week' | 'month' | 'year';

export interface DatePreset {
  id: DatePresetId;
  label: string;
  range: (today: Date) => { from: string; to: string };
}

/** Local calendar day as YYYY-MM-DD (not UTC, unlike toISOString). */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(today: Date, n: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
}

export const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    label: 'Today',
    range: (today) => {
      const d = toLocalIsoDate(today);
      return { from: d, to: d };
    },
  },
  {
    id: 'week',
    label: 'Past 7 days',
    range: (today) => ({ from: toLocalIsoDate(daysAgo(today, 6)), to: '' }),
  },
  {
    id: 'month',
    label: 'Past 30 days',
    range: (today) => ({ from: toLocalIsoDate(daysAgo(today, 29)), to: '' }),
  },
  {
    id: 'year',
    label: 'This year',
    range: (today) => ({ from: `${today.getFullYear()}-01-01`, to: '' }),
  },
];

/** The preset whose range is exactly `from`..`to` (as of `today`), if any. */
export function matchDatePreset(from: string, to: string, today: Date = new Date()): DatePreset | null {
  if (!from && !to) return null;
  return DATE_PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === from && r.to === to;
  }) ?? null;
}
