import { describe, expect, it } from 'vitest';
import {
  depthToDisplay,
  depthToStored,
  formatDepth,
  formatPressure,
  formatTemp,
  formatWeight,
  pressureToDisplay,
  pressureToStored,
  tempToDisplay,
  tempToStored,
  weightToDisplay,
  weightToStored,
} from '../../ui/units';

describe('depth conversions', () => {
  it('passes through metric values unchanged (1 decimal)', () => {
    expect(depthToDisplay(12.34, 'metric')).toBe(12.3);
    expect(depthToStored(12.3, 'metric')).toBe(12.3);
  });

  it('converts meters to feet for imperial display', () => {
    expect(depthToDisplay(10, 'imperial')).toBe(33); // 32.808 → 33
    expect(depthToDisplay(30.48, 'imperial')).toBe(100);
  });

  it('converts imperial input back to stored meters', () => {
    expect(depthToStored(33, 'imperial')).toBe(10.06);
    expect(depthToStored(100, 'imperial')).toBe(30.48);
  });

  it('round-trips metric → imperial → metric within half a foot', () => {
    // Rounding to whole feet can shift the stored depth by at most 0.5 ft (≈15cm).
    for (const m of [0.5, 10, 30.48, 40.23]) {
      const back = depthToStored(depthToDisplay(m, 'imperial'), 'imperial');
      expect(back).not.toBeNull();
      expect(Math.abs((back as number) - m)).toBeLessThan(0.16);
    }
  });

  it('returns undefined for null/undefined/non-finite', () => {
    expect(depthToDisplay(null, 'metric')).toBeUndefined();
    expect(depthToDisplay(undefined, 'imperial')).toBeUndefined();
    expect(depthToDisplay(NaN, 'metric')).toBeUndefined();
  });
});

describe('temperature conversions', () => {
  it('passes through °C unchanged for metric', () => {
    expect(tempToDisplay(25.67, 'metric')).toBe(25.7);
    expect(tempToStored(25.7, 'metric')).toBe(25.7);
  });

  it('converts °C to °F for imperial display', () => {
    expect(tempToDisplay(0, 'imperial')).toBe(32);
    expect(tempToDisplay(100, 'imperial')).toBe(212);
    expect(tempToDisplay(22.5, 'imperial')).toBe(72.5);
  });

  it('converts imperial input back to stored °C', () => {
    expect(tempToStored(32, 'imperial')).toBe(0);
    expect(tempToStored(212, 'imperial')).toBe(100);
    expect(tempToStored(72.5, 'imperial')).toBe(22.5);
  });

  it('returns undefined for null/undefined', () => {
    expect(tempToDisplay(null, 'imperial')).toBeUndefined();
    expect(tempToStored(undefined, 'metric')).toBeUndefined();
  });
});

describe('pressure conversions', () => {
  it('passes through bar unchanged for metric', () => {
    expect(pressureToDisplay(200.45, 'metric')).toBe(200.5);
    expect(pressureToStored(200.5, 'metric')).toBe(200.5);
  });

  it('converts bar to psi for imperial display', () => {
    expect(pressureToDisplay(1, 'imperial')).toBe(15); // 14.504 → 15
    expect(pressureToDisplay(200, 'imperial')).toBe(2901);
  });

  it('converts imperial input back to stored bar', () => {
    expect(pressureToStored(14.5, 'imperial')).toBe(1);
    expect(pressureToStored(2900.75, 'imperial')).toBe(200);
  });

  it('returns undefined for null', () => {
    expect(pressureToDisplay(null, 'imperial')).toBeUndefined();
  });
});

describe('weight conversions', () => {
  it('passes through kg unchanged for metric', () => {
    expect(weightToDisplay(9.25, 'metric')).toBe(9.3);
    expect(weightToStored(9.3, 'metric')).toBe(9.3);
  });

  it('converts kg to lb for imperial display', () => {
    expect(weightToDisplay(1, 'imperial')).toBe(2.2);
    expect(weightToDisplay(10, 'imperial')).toBe(22);
  });

  it('converts imperial input back to stored kg', () => {
    expect(weightToStored(22.05, 'imperial')).toBe(10);
    expect(weightToStored(22, 'imperial')).toBe(9.98);
  });

  it('returns undefined for null', () => {
    expect(weightToDisplay(null, 'metric')).toBeUndefined();
  });
});

describe('display formatters', () => {
  it('formats depth per unit', () => {
    expect(formatDepth(12.34, 'metric')).toBe('12.3 m');
    expect(formatDepth(12.34, 'imperial')).toBe('40 ft'); // 40.49 ft
    expect(formatDepth(null, 'metric')).toBeNull();
    expect(formatDepth(undefined, 'imperial')).toBeNull();
  });

  it('formats temperature per unit', () => {
    expect(formatTemp(22.5, 'metric')).toBe('22.5 °C');
    expect(formatTemp(22.5, 'imperial')).toBe('73 °F');
    expect(formatTemp(null, 'metric')).toBeNull();
  });

  it('formats pressure per unit', () => {
    expect(formatPressure(200, 'metric')).toBe('200 bar');
    expect(formatPressure(200, 'imperial')).toBe('2901 psi');
    expect(formatPressure(null, 'metric')).toBeNull();
  });

  it('formats weight per unit', () => {
    expect(formatWeight(10, 'metric')).toBe('10 kg');
    expect(formatWeight(10, 'imperial')).toBe('22 lb');
    expect(formatWeight(null, 'metric')).toBeNull();
  });
});
