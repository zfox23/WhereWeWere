/**
 * Plays over time for the song, artist and album pages, from plays per local
 * day ('YYYY-MM-DD', as the server reads each play in its own zone): weeks
 * (Monday to Sunday), months and years, zero-filled, and the streaks and
 * peaks drawn from the same days. Dates are calendar dates, handled in UTC
 * so no browser zone shifts them.
 */

import type { DayCount } from '../types';

export type Bucket = 'week' | 'month' | 'year';

export interface BucketCount {
  /** First day of the week, month or year. */
  start: string;
  /** Last day of it. */
  end: string;
  plays: number;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

const toTime = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromTime = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (date: string, days: number): string => fromTime(toTime(date) + days * DAY_MS);
export const daysBetween = (a: string, b: string): number => Math.round((toTime(b) - toTime(a)) / DAY_MS);

/** The first day of the week (Monday), month or year holding `date`. */
export function bucketStart(date: string, bucket: Bucket): string {
  if (bucket === 'year') return `${date.slice(0, 4)}-01-01`;
  if (bucket === 'month') return `${date.slice(0, 7)}-01`;
  const dow = new Date(toTime(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The last day of the bucket starting `start`. */
export function bucketEnd(start: string, bucket: Bucket): string {
  if (bucket === 'year') return `${start.slice(0, 4)}-12-31`;
  if (bucket === 'week') return addDays(start, 6);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return fromTime(Date.UTC(y, m, 0));
}

/** Plays per bucket from the first played to the last, empty buckets included. */
export function bucketize(daily: DayCount[], bucket: Bucket): BucketCount[] {
  if (daily.length === 0) return [];
  const counts = new Map<string, number>();
  for (const d of daily) {
    const s = bucketStart(d.date, bucket);
    counts.set(s, (counts.get(s) ?? 0) + d.plays);
  }
  const last = bucketStart(daily[daily.length - 1].date, bucket);
  const out: BucketCount[] = [];
  for (let s = bucketStart(daily[0].date, bucket); s <= last; s = addDays(bucketEnd(s, bucket), 1)) {
    out.push({ start: s, end: bucketEnd(s, bucket), plays: counts.get(s) ?? 0 });
  }
  return out;
}

/** Plays per week (Monday to Sunday) for every week touching `month` ('YYYY-MM'); whole weeks are counted. */
export function weeksOfMonth(daily: DayCount[], month: string): BucketCount[] {
  const first = `${month}-01`;
  const last = bucketEnd(first, 'month');
  const out: BucketCount[] = [];
  for (let s = bucketStart(first, 'week'); s <= last; s = addDays(s, 7)) {
    const e = addDays(s, 6);
    out.push({ start: s, end: e, plays: daily.reduce((n, d) => (d.date >= s && d.date <= e ? n + d.plays : n), 0) });
  }
  return out;
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(toTime(date)));

/** "Mar 4 – 10, 2024" / "Mar 2024" / "2024"; `short` drops the week's year. */
export function bucketLabel(b: Pick<BucketCount, 'start' | 'end'>, bucket: Bucket, short = false): string {
  if (bucket === 'year') return b.start.slice(0, 4);
  if (bucket === 'month') return fmt(b.start, { month: 'short', year: 'numeric' });
  const sameMonth = b.start.slice(0, 7) === b.end.slice(0, 7);
  const range = `${fmt(b.start, { month: 'short', day: 'numeric' })} – ${sameMonth ? fmt(b.end, { day: 'numeric' }) : fmt(b.end, { month: 'short', day: 'numeric' })}`;
  return short ? range : `${range}, ${b.end.slice(0, 4)}`;
}

export interface Highlights {
  daysPlayed: number;
  /** Longest run of consecutive days with a play. */
  longestStreak: { days: number; start: string; end: string } | null;
  busiestDay: { date: string; plays: number } | null;
  busiestWeek: BucketCount | null;
  busiestMonth: BucketCount | null;
  /** Longest stretch without a play between two plays (days between them, exclusive). */
  longestGap: { days: number; after: string; before: string } | null;
}

const busiest = (rows: BucketCount[]) => rows.reduce<BucketCount | null>((b, r) => (r.plays > (b?.plays ?? 0) ? r : b), null);

export function highlights(daily: DayCount[]): Highlights {
  let longestStreak: Highlights['longestStreak'] = null;
  let longestGap: Highlights['longestGap'] = null;
  let runStart = '';
  daily.forEach((d, i) => {
    const prev = daily[i - 1];
    const gap = prev ? daysBetween(prev.date, d.date) : 0;
    if (!prev || gap !== 1) runStart = d.date;
    if (prev && gap > 1 && gap - 1 > (longestGap?.days ?? 0)) longestGap = { days: gap - 1, after: prev.date, before: d.date };
    const days = daysBetween(runStart, d.date) + 1;
    if (days > (longestStreak?.days ?? 0)) longestStreak = { days, start: runStart, end: d.date };
  });
  return {
    daysPlayed: daily.length,
    longestStreak,
    busiestDay: daily.reduce<Highlights['busiestDay']>((b, d) => (d.plays > (b?.plays ?? 0) ? d : b), null),
    busiestWeek: busiest(bucketize(daily, 'week')),
    busiestMonth: busiest(bucketize(daily, 'month')),
    longestGap,
  };
}
