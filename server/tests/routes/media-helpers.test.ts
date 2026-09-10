import { describe, expect, it } from 'vitest';
import { toIntOrNull } from '../../src/routes/media';

describe('toIntOrNull (book numeric coercion)', () => {
  it('passes through valid numbers, rounding floats', () => {
    expect(toIntOrNull(42)).toBe(42);
    expect(toIntOrNull(41.6)).toBe(42);
    expect(toIntOrNull(0)).toBe(0);
  });

  it('coerces numeric strings, rounding floats', () => {
    expect(toIntOrNull('42')).toBe(42);
    expect(toIntOrNull('41.6')).toBe(42);
    expect(toIntOrNull(' 7 ')).toBe(7);
  });

  it('returns null for non-finite values (NaN, Infinity)', () => {
    expect(toIntOrNull(NaN)).toBeNull();
    expect(toIntOrNull(Infinity)).toBeNull();
    expect(toIntOrNull('abc')).toBeNull();
    expect(toIntOrNull('1.2.3')).toBeNull();
  });

  it('returns null for empty or non-numeric strings', () => {
    expect(toIntOrNull('')).toBeNull();
    expect(toIntOrNull('   ')).toBeNull();
    expect(toIntOrNull(undefined)).toBeNull();
  });

  it('passes negative numbers through unchanged (DB CHECK >= 0 is the final guard)', () => {
    // Note: unlike the backup.ts variant, this helper does not reject
    // negatives; the CHECK constraint on the page/series columns is.
    expect(toIntOrNull(-5)).toBe(-5);
    expect(toIntOrNull('-5')).toBe(-5);
  });
});
