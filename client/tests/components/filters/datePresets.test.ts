import { describe, expect, it } from 'vitest';
import { DATE_PRESETS, matchDatePreset, toLocalIsoDate } from '../../../src/components/filters/datePresets';

const today = new Date(2026, 10, 19); // 19 Nov 2026, local time
const range = (id: string) => DATE_PRESETS.find((p) => p.id === id)!.range(today);

describe('date presets', () => {
  it('formats local calendar days', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('computes inclusive ranges', () => {
    expect(range('today')).toEqual({ from: '2026-11-19', to: '2026-11-19' });
    expect(range('week')).toEqual({ from: '2026-11-13', to: '' });
    expect(range('month')).toEqual({ from: '2026-10-21', to: '' });
    expect(range('year')).toEqual({ from: '2026-01-01', to: '' });
  });

  it('crosses month and year boundaries', () => {
    const jan2 = new Date(2027, 0, 2);
    expect(DATE_PRESETS.find((p) => p.id === 'week')!.range(jan2).from).toBe('2026-12-27');
  });

  it('matches only exact preset ranges', () => {
    expect(matchDatePreset('2026-11-13', '', today)?.id).toBe('week');
    expect(matchDatePreset('2026-11-19', '2026-11-19', today)?.id).toBe('today');
    expect(matchDatePreset('2026-11-13', '2026-11-19', today)).toBeNull();
    expect(matchDatePreset('', '', today)).toBeNull();
  });
});
