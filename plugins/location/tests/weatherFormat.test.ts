import { describe, expect, it } from 'vitest';
import { describeWeather, formatClock, formatPrecip, formatTemp, formatWind } from '../ui/weatherFormat';

describe('weather formatting', () => {
  it('converts temperature, wind and precipitation for imperial', () => {
    expect(formatTemp(0, 'imperial')).toBe('32°');
    expect(formatTemp(21.4, 'metric')).toBe('21°');
    expect(formatWind(100, 'imperial')).toBe('62 mph');
    expect(formatPrecip(25.4, 'imperial')).toBe('1.00 in');
    expect(formatPrecip(4.24, 'metric')).toBe('4.2 mm');
    expect(formatTemp(null, 'metric')).toBe('–');
  });
  it('maps WMO codes to labels', () => {
    expect(describeWeather(0).label).toBe('Sunny');
    expect(describeWeather(63).label).toBe('Rain');
    expect(describeWeather(73).label).toBe('Snow');
    expect(describeWeather(95).label).toBe('Thunderstorm');
    expect(describeWeather(null).label).toBe('Unknown');
  });
  it('formats local clock times', () => {
    expect(formatClock('2025-06-01T05:12')).toBe('5:12 AM');
    expect(formatClock('2025-06-01T21:03')).toBe('9:03 PM');
    expect(formatClock('2025-06-01T00:00')).toBe('12:00 AM');
  });
});
