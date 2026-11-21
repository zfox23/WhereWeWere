import { describe, expect, it } from 'vitest';
import { bucketEnd, bucketLabel, bucketStart, bucketize, highlights, weeksOfMonth } from '../ui/insights/timeline';

describe('buckets', () => {
  it('starts weeks on Monday, and months and years on their first day', () => {
    expect(bucketStart('2024-03-06', 'week')).toBe('2024-03-04'); // a Wednesday
    expect(bucketStart('2024-03-10', 'week')).toBe('2024-03-04'); // a Sunday
    expect(bucketStart('2024-03-06', 'month')).toBe('2024-03-01');
    expect(bucketStart('2024-03-06', 'year')).toBe('2024-01-01');
    expect(bucketEnd('2024-02-01', 'month')).toBe('2024-02-29');
    expect(bucketEnd('2024-12-30', 'week')).toBe('2025-01-05');
  });

  it('zero-fills from the first play to the last', () => {
    const daily = [{ date: '2023-11-20', plays: 2 }, { date: '2023-11-21', plays: 1 }, { date: '2024-02-03', plays: 4 }];
    expect(bucketize(daily, 'month').map((b) => [b.start, b.plays])).toEqual([
      ['2023-11-01', 3], ['2023-12-01', 0], ['2024-01-01', 0], ['2024-02-01', 4],
    ]);
    expect(bucketize(daily, 'year').map((b) => [b.start, b.end, b.plays])).toEqual([
      ['2023-01-01', '2023-12-31', 3], ['2024-01-01', '2024-12-31', 4],
    ]);
    expect(bucketize(daily, 'week')).toHaveLength(11);
    expect(bucketize([], 'week')).toEqual([]);
  });

  it('lists the whole weeks touching a month', () => {
    const weeks = weeksOfMonth([{ date: '2024-02-29', plays: 1 }, { date: '2024-03-02', plays: 2 }, { date: '2024-03-20', plays: 5 }], '2024-03');
    expect(weeks.map((w) => [w.start, w.end, w.plays])).toEqual([
      ['2024-02-26', '2024-03-03', 3],
      ['2024-03-04', '2024-03-10', 0],
      ['2024-03-11', '2024-03-17', 0],
      ['2024-03-18', '2024-03-24', 5],
      ['2024-03-25', '2024-03-31', 0],
    ]);
  });

  it('labels weeks, months and years', () => {
    expect(bucketLabel({ start: '2024-03-04', end: '2024-03-10' }, 'week')).toBe('Mar 4 – 10, 2024');
    expect(bucketLabel({ start: '2024-02-26', end: '2024-03-03' }, 'week', true)).toBe('Feb 26 – Mar 3');
    expect(bucketLabel({ start: '2024-03-01', end: '2024-03-31' }, 'month')).toBe('Mar 2024');
    expect(bucketLabel({ start: '2024-01-01', end: '2024-12-31' }, 'year')).toBe('2024');
  });
});

describe('highlights', () => {
  it('finds the longest streak, the busiest day, week and month, and the longest break', () => {
    const h = highlights([
      { date: '2024-01-30', plays: 1 },
      { date: '2024-01-31', plays: 2 },
      { date: '2024-02-01', plays: 1 },
      { date: '2024-02-10', plays: 6 },
      { date: '2024-02-11', plays: 1 },
    ]);
    expect(h.daysPlayed).toBe(5);
    expect(h.longestStreak).toEqual({ days: 3, start: '2024-01-30', end: '2024-02-01' });
    expect(h.busiestDay).toEqual({ date: '2024-02-10', plays: 6 });
    expect(h.busiestWeek).toMatchObject({ start: '2024-02-05', plays: 7 });
    expect(h.busiestMonth).toMatchObject({ start: '2024-02-01', plays: 8 });
    expect(h.longestGap).toEqual({ days: 8, after: '2024-02-01', before: '2024-02-10' });
  });

  it('has nothing to say without plays, and no break with one day', () => {
    expect(highlights([])).toMatchObject({ daysPlayed: 0, longestStreak: null, busiestDay: null, longestGap: null });
    expect(highlights([{ date: '2024-01-01', plays: 2 }]).longestGap).toBeNull();
  });
});
