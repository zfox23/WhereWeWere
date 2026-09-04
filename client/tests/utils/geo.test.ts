import { describe, expect, it } from 'vitest';
import { formatDuration, haversineDistance } from '../../src/utils/geo';

describe('haversineDistance', () => {
  it('returns zero for identical coordinates', () => {
    const distance = haversineDistance(37.7749, -122.4194, 37.7749, -122.4194);
    expect(distance).toBe(0);
  });

  it('returns distance in expected range for known nearby points', () => {
    const distance = haversineDistance(37.7749, -122.4194, 37.7849, -122.4094);
    expect(distance).toBeGreaterThan(1300);
    expect(distance).toBeLessThan(1500);
  });
});

describe('formatDuration', () => {
  it('uses shorthand labels', () => {
    expect(formatDuration(0)).toBe('0');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(15 * 60)).toBe('15m');
    expect(formatDuration(60 * 60)).toBe('1h');
    expect(formatDuration(90 * 60)).toBe('1h 30m');
    expect(formatDuration(3 * 60 * 60 + 5 * 60)).toBe('3h 5m');
  });
});
