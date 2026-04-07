import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../../src/utils/geo';

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
