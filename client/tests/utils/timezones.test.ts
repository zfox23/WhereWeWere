import { describe, expect, it } from 'vitest';
import { TIMEZONE_IDS, isValidTimezoneId } from '../../src/utils/timezones';

describe('timezones', () => {
  it('includes well-known IANA identifiers', () => {
    expect(TIMEZONE_IDS).toContain('America/New_York');
    expect(TIMEZONE_IDS).toContain('Etc/GMT-2');
    expect(TIMEZONE_IDS).toContain('UTC');
    expect(TIMEZONE_IDS).toContain('Europe/London');
  });

  it('has no duplicates', () => {
    expect(new Set(TIMEZONE_IDS).size).toBe(TIMEZONE_IDS.length);
  });

  it('validates identifiers', () => {
    expect(isValidTimezoneId('America/New_York')).toBe(true);
    expect(isValidTimezoneId('Etc/GMT+5')).toBe(true);
    expect(isValidTimezoneId('Not/AZone')).toBe(false);
    expect(isValidTimezoneId('')).toBe(false);
    expect(isValidTimezoneId(null)).toBe(false);
    expect(isValidTimezoneId(undefined)).toBe(false);
  });
});
