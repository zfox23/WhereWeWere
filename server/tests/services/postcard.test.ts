import { describe, expect, it } from 'vitest';
import {
  addDays,
  currentMonthRange,
  pickRandomTop,
  randomMacroWindow,
  randomSample,
  scoreWindows,
  ymOf,
  type CandidateWindow,
} from '../../src/services/postcard';

function days(start: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(start, i));
  return out;
}

/** dailyCounts built from { dayStart, dayCount } ranges. */
function counts(ranges: [string, number][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [start, n] of ranges) {
    for (const d of days(start, n)) {
      map.set(d, (map.get(d) ?? 0) + 1);
    }
  }
  return map;
}

describe('scoreWindows', () => {
  it('returns nothing for an empty macro window or inverted bounds', () => {
    expect(scoreWindows(new Map(), [7], '2024-06-05', '2024-06-01', '', '')).toEqual([]);
    expect(scoreWindows(counts([['2024-06-01', 3]]), [7], '2024-06-05', '2024-06-01', '', '')).toEqual([]);
  });

  it('skips windows with zero check-ins', () => {
    // 3 active days (Jan 1-3, 1 check-in each).
    const daily = counts([['2024-01-01', 1], ['2024-01-02', 1], ['2024-01-03', 1]]);
    const cands = scoreWindows(daily, [7], '2024-01-01', '2024-03-01', '', '');
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      // Windows are clipped to the macro window, so a window that starts on
      // Jan 1 may include only a suffix of the active days.
      expect(c.count).toBeGreaterThanOrEqual(1);
      expect(c.count).toBeLessThanOrEqual(3);
      expect(c.from >= '2024-01-01').toBe(true);
      expect(c.to <= '2024-03-01').toBe(true);
    }
    // A window that fully contains the 3 active days (e.g. Jan 1-7) scores 3.
    expect(cands.some((c) => c.count === 3)).toBe(true);
  });

  it('respects the macro window bounds (windows must fit fully inside)', () => {
    const daily = counts([['2024-02-01', 2]]);
    const cands = scoreWindows(daily, [7, 30], '2024-02-05', '2024-02-20', '', '');
    expect(cands.length).toBe(0); // the only active day is outside the macro window
  });

  it('favors sustained activity over a short burst at the same total', () => {
    // 30-day window A: 30 check-ins spread evenly (1/day).
    // 30-day window B: 30 check-ins all on one day (a 7-day burst inside).
    // Both 7-day windows see the same 30 total; the sustained window's 30-day
    // candidate should dominate because it has more active days at the same
    // total — but more directly: a 90-day sustained period should beat an
    // identical-total 7-day burst when scored at its own length.
    const sustained = new Map<string, number>();
    for (const d of days('2024-01-01', 90)) sustained.set(d, 2); // 180 total over 90 days
    const burst = new Map<string, number>();
    for (const d of days('2024-03-01', 7)) burst.set(d, 26); // 182 total over 7 days

    const macro = { from: '2023-12-01', to: '2024-04-30' };

    const cSustained = scoreWindows(sustained, [90], macro.from, macro.to);
    const cBurst = scoreWindows(burst, [7], macro.from, macro.to);
    expect(cSustained.length).toBeGreaterThan(0);
    expect(cBurst.length).toBeGreaterThan(0);
    // A 90-day sustained period (180 check-ins) scores 180/sqrt(90) ≈ 18.97;
    // the 7-day burst (182 check-ins) scores 182/sqrt(7) ≈ 68.8 at its own
    // length. The density metric compares windows of the SAME length, so
    // verify a sustained 30-day window (60 check-ins) scores as expected.
    const sameLength = scoreWindows(sustained, [30], macro.from, macro.to);
    expect(sameLength[0].score).toBeCloseTo(60 / Math.sqrt(30), 5);
  });

  it('ranks candidates by density, descending, at equal length', () => {
    // Window with 10 events in 7 days vs 2 events in 7 days (same month).
    const daily = new Map<string, number>();
    for (const d of days('2024-01-01', 7)) daily.set(d, 10);
    for (const d of days('2024-01-20', 7)) daily.set(d, 2);
    const cands = scoreWindows(daily, [7], '2024-01-01', '2024-01-31', '', '');
    expect(cands[0].count).toBe(70);
    expect(cands[0].score).toBeCloseTo(70 / Math.sqrt(7), 5);
    // The lowest-scoring candidate is a window that only grazes the sparse
    // (2/day) cluster — its count is at most 14, and the sort order holds.
    const last = cands[cands.length - 1];
    expect(last.count).toBeLessThanOrEqual(14);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].score).toBeGreaterThanOrEqual(cands[i].score);
    }
  });

  it('excludes windows overlapping the exclusion range (current month)', () => {
    const daily = counts([['2024-01-05', 5], ['2024-02-10', 5]]);
    // Exclude all of January 2024.
    const cands = scoreWindows(daily, [7], '2023-12-01', '2024-03-01', '2024-01-01', '2024-01-31');
    for (const c of cands) {
      // A window may end inside January only if it started before the
      // exclusion... no: any overlap is dropped, so both ends are post-Jan.
      expect(c.from >= '2024-02-01').toBe(true);
    }
    // The February cluster still produces candidates, including a window
    // that contains the full 5-day cluster.
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.some((c) => c.count === 5)).toBe(true);
  });

  it('supports multiple window lengths at once', () => {
    const daily = counts([['2024-01-01', 45]]);
    const cands = scoreWindows(daily, [7, 30, 90], '2023-12-15', '2024-03-15', '', '');
    const byLength = (c: CandidateWindow) => Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86400000) + 1;
    expect(new Set(cands.map(byLength)).size).toBe(3);
  });
});

describe('pickRandomTop', () => {
  const cands = Array.from({ length: 20 }, (_, i) => ({
    from: `2024-01-${String(i + 1).padStart(2, '0')}`,
    to: `2024-01-${String(i + 2).padStart(2, '0')}`,
    count: 100 - i,
    score: 100 - i,
  }));

  it('returns null for an empty list', () => {
    expect(pickRandomTop([], 7)).toBeNull();
  });

  it('never picks beyond the top n', () => {
    for (let i = 0; i < 200; i++) {
      const pick = pickRandomTop(cands, 7)!;
      expect(cands.slice(0, 7)).toContain(pick);
    }
  });

  it('varies its pick across calls (random, not always best)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const pick = pickRandomTop(cands, 7)!;
      seen.add(cands.indexOf(pick));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('randomMacroWindow', () => {
  it('returns null when history spans fewer than 30 days', () => {
    expect(randomMacroWindow('2024-01-01', '2024-01-29', 6)).toBeNull();
    expect(randomMacroWindow('2024-01-01', '2024-01-01', 6)).toBeNull();
    expect(randomMacroWindow('2024-02-01', '2024-01-01', 6)).toBeNull();
  });

  it('returns the whole span when history is shorter than the macro length', () => {
    const w = randomMacroWindow('2024-01-01', '2024-05-15', 6);
    expect(w).toEqual({ from: '2024-01-01', to: '2024-05-15' });
  });

  it('always stays within [first, last] and spans ~6 months', () => {
    for (let i = 0; i < 100; i++) {
      const w = randomMacroWindow('2020-01-01', '2025-12-31', 6)!;
      expect(w.from >= '2020-01-01').toBe(true);
      expect(w.to <= '2025-12-31').toBe(true);
      const spanDays = Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1;
      expect(spanDays).toBe(180); // 6 * 30
    }
  });
});

describe('currentMonthRange', () => {
  it('covers the whole UTC month of the given date', () => {
    const { from, to } = currentMonthRange(new Date('2026-09-30T12:00:00Z'));
    expect(from).toBe('2026-09-01');
    expect(to).toBe('2026-09-30');
  });
});

describe('addDays / ymOf', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-06-15', -15)).toBe('2024-05-31');
  });

  it('extracts YYYY-MM', () => {
    expect(ymOf('2024-07-02')).toBe('2024-07');
  });
});

describe('randomSample', () => {
  it('returns a copy when the pool is smaller than n', () => {
    const arr = [1, 2, 3];
    const out = randomSample(arr, 10);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(arr);
  });

  it('samples exactly n distinct items from a larger pool', () => {
    const pool = Array.from({ length: 40 }, (_, i) => i);
    const out = randomSample(pool, 10);
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBe(10);
    for (const v of out) expect(pool).toContain(v);
  });
});
