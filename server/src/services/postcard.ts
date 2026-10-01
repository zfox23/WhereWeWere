/**
 * Pure, testable helpers for "Postcard From Your Past".
 *
 * An "interesting period" is a run of days in the user's past with an
 * unusually high density of check-ins. The picker (see routes/llm.ts):
 *   1. picks a random 6-month macro-window inside the user's overall
 *      check-in history,
 *   2. scores every day-aligned candidate sub-window (7 / 30 / 90 days) in
 *      that macro-window by density `count / sqrt(length)`,
 *   3. drops any window overlapping the current calendar month, and
 *   4. picks uniformly at random among the top 7 candidates.
 *
 * This module holds only the date math and scoring — no DB, no LLM — so it
 * is trivially unit-testable.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD string as a UTC day (days are calendar-UTC in this app). */
function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Format a UTC day (ms epoch) as YYYY-MM-DD. */
function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface CandidateWindow {
  from: string; // YYYY-MM-DD (inclusive)
  to: string; // YYYY-MM-DD (inclusive)
  /** Total check-ins in the window. */
  count: number;
  /** count / sqrt(length in days). */
  score: number;
}

/**
 * Score every day-aligned window of each given length (in days) that fits
 * fully inside [macroFrom, macroTo]. Windows with zero check-ins are
 * dropped, as are windows overlapping [excludeFrom, excludeTo] (typically
 * the current calendar month, so the postcard is always about the past).
 * Results are sorted by score, descending.
 */
export function scoreWindows(
  dailyCounts: Map<string, number>,
  windowLengths: number[],
  macroFrom: string,
  macroTo: string,
  /**
   * Inclusive range to drop (typically the current calendar month). Pass
   * empty strings (or from > to) to disable the exclusion.
   */
  excludeFrom = '',
  excludeTo = ''
): CandidateWindow[] {
  const macroStart = parseDay(macroFrom);
  const macroEnd = parseDay(macroTo);
  if (Number.isNaN(macroStart) || Number.isNaN(macroEnd) || macroEnd < macroStart) {
    return [];
  }
  const exclStart = parseDay(excludeFrom);
  const exclEnd = parseDay(excludeTo);
  // An empty or inverted exclusion range disables the exclusion check.
  const hasExclusion =
    !Number.isNaN(exclStart) && !Number.isNaN(exclEnd) && exclStart <= exclEnd;

  const out: CandidateWindow[] = [];
  for (const length of windowLengths) {
    if (!Number.isInteger(length) || length < 1) continue;
    const spanMs = (length - 1) * MS_PER_DAY;
    for (let start = macroStart; start + spanMs <= macroEnd; start += MS_PER_DAY) {
      const end = start + spanMs;
      // Skip windows overlapping the exclusion range.
      if (hasExclusion && start <= exclEnd && end >= exclStart) continue;
      let count = 0;
      for (let d = start; d <= end; d += MS_PER_DAY) {
        count += dailyCounts.get(dayStr(d)) ?? 0;
      }
      if (count === 0) continue;
      out.push({
        from: dayStr(start),
        to: dayStr(end),
        count,
        score: count / Math.sqrt(length),
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Uniformly pick one candidate from the top `n` (e.g. top 7) for variety.
 * Falls back to the best candidate when `candidates` is non-empty but
 * shorter than `n`. Returns null for an empty list.
 */
export function pickRandomTop(
  candidates: CandidateWindow[],
  n: number
): CandidateWindow | null {
  if (candidates.length === 0) return null;
  const top = candidates.slice(0, Math.max(1, n));
  return top[Math.floor(Math.random() * top.length)];
}

/**
 * A random ~`months`-long window fully inside [first, last]. Returns null
 * when the history spans fewer than 30 days (there is nothing to
 * "randomize" — callers should then use the whole history).
 */
export function randomMacroWindow(
  first: string,
  last: string,
  months = 6
): { from: string; to: string } | null {
  const start = parseDay(first);
  const end = parseDay(last);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const spanDays = Math.round((end - start) / MS_PER_DAY) + 1;
  if (spanDays < 30) return null;

  const windowDays = months * 30;
  if (spanDays <= windowDays) return { from: dayStr(start), to: dayStr(end) };

  const maxOffset = spanDays - windowDays;
  const offset = Math.floor(Math.random() * (maxOffset + 1));
  return {
    from: dayStr(start + offset * MS_PER_DAY),
    to: dayStr(start + (offset + windowDays - 1) * MS_PER_DAY),
  };
}

/** The inclusive current calendar month (UTC day strings). */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { from: dayStr(first.getTime()), to: dayStr(last.getTime()) };
}

/** Add days to a YYYY-MM-DD date string. */
export function addDays(date: string, days: number): string {
  return dayStr(parseDay(date) + days * MS_PER_DAY);
}

/** Pick a uniform random sample of up to `n` items from `arr`. */
export function randomSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/** YYYY-MM of a YYYY-MM-DD date (the "from" line suffix). */
export function ymOf(date: string): string {
  return date.slice(0, 7);
}
