import { describe, expect, it } from 'vitest';
import { hourLabel, localHours, monotonePath, niceScale } from '../ui/weatherChart';

describe('weather chart helpers', () => {
  it('reads local hours from the ISO text, without time zone shifts', () => {
    expect(localHours('2025-06-01T06:42')).toBeCloseTo(6.7);
    expect(localHours('2025-06-01T00:00')).toBe(0);
    expect(localHours(null)).toBeNull();
    expect(localHours('nope')).toBeNull();
  });

  it('labels hour ticks', () => {
    expect(hourLabel(0)).toBe('12 AM');
    expect(hourLabel(9)).toBe('9 AM');
    expect(hourLabel(12)).toBe('12 PM');
    expect(hourLabel(21)).toBe('9 PM');
  });

  it('widens a domain to nice ticks', () => {
    expect(niceScale(52.3, 71.8)).toEqual({ min: 50, max: 75, ticks: [50, 55, 60, 65, 70, 75] });
    expect(niceScale(0, 0.04)).toEqual({ min: 0, max: 0.04, ticks: [0, 0.01, 0.02, 0.03, 0.04] });
    // A flat series still gets a usable range.
    const flat = niceScale(10, 10);
    expect(flat.min).toBeLessThan(10);
    expect(flat.max).toBeGreaterThan(10);
  });

  it('draws a monotone curve that breaks at gaps and never overshoots', () => {
    const d = monotonePath([[0, 0], [10, 10], [20, 10], null, [40, 5], [50, 0]]);
    expect(d.match(/M/g)).toHaveLength(2);
    // Every control point stays within the data's y range [0, 10].
    const ys = [...d.matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });

  it('swaps coordinates for a vertical curve', () => {
    expect(monotonePath([[0, 5], [10, 5]], true)).toBe('M5.0,0.0C5.0,3.3 5.0,6.7 5.0,10.0');
  });
});
