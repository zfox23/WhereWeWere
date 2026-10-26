import { describe, expect, it } from 'vitest';
import { utcToZonedLocalValue, zonedLocalToIso } from '../ui/zoned';

describe('zoned wall-clock times', () => {
  it.each([
    ['2024-05-01T12:00:00Z', 'America/Chicago', '2024-05-01T07:00'],
    ['2024-01-15T12:00:00Z', 'America/Chicago', '2024-01-15T06:00'], // standard time
    ['2024-05-01T12:00:00Z', 'Pacific/Auckland', '2024-05-02T00:00'], // the next day there
    ['2024-05-01T12:00:00Z', 'UTC', '2024-05-01T12:00'],
    ['2024-05-01T12:30:00Z', 'Asia/Kolkata', '2024-05-01T18:00'], // a half-hour offset
  ])('%s in %s reads %s, and back', (iso, zone, local) => {
    expect(utcToZonedLocalValue(iso, zone)).toBe(local);
    expect(zonedLocalToIso(local, zone)).toBe(new Date(iso).toISOString().replace(/:\d\d\.000Z$/, ':00.000Z'));
  });

  it('reads a time in a zone other than the device\'s', () => {
    expect(zonedLocalToIso('2024-07-04T21:15', 'Europe/Paris')).toBe('2024-07-04T19:15:00.000Z');
    expect(zonedLocalToIso('2024-07-04T21:15', 'America/Los_Angeles')).toBe('2024-07-05T04:15:00.000Z');
  });

  it('refuses what is not a local time', () => {
    expect(zonedLocalToIso('', 'UTC')).toBeNull();
    expect(zonedLocalToIso('tomorrow', 'UTC')).toBeNull();
  });
});
