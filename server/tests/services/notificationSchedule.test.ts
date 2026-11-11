import { describe, expect, it } from 'vitest';
import { dailyTimeOccurrences, validateDailyTimes } from 'wwp-shared';

const iso = (ms: number[]) => ms.map((m) => new Date(m).toISOString());
const at = (s: string) => Date.parse(s);

describe('dailyTimeOccurrences', () => {
  it('returns the occurrence inside the (since, now] window, in the zone', () => {
    // 09:00 in New York (EST, UTC-5) on 2026-01-15 is 14:00Z.
    const due = dailyTimeOccurrences(['09:00'], 'America/New_York', at('2026-01-15T13:59:00Z'), at('2026-01-15T14:00:00Z'));
    expect(iso(due)).toEqual(['2026-01-15T14:00:00.000Z']);
  });

  it('excludes the window start and anything outside it', () => {
    expect(dailyTimeOccurrences(['09:00'], 'America/New_York', at('2026-01-15T14:00:00Z'), at('2026-01-15T14:01:00Z'))).toEqual([]);
    expect(dailyTimeOccurrences(['09:00'], 'America/New_York', at('2026-01-15T12:00:00Z'), at('2026-01-15T13:59:59Z'))).toEqual([]);
  });

  it('handles a window spanning local midnight and several times', () => {
    const due = dailyTimeOccurrences(
      ['23:50', '00:05', '12:00'],
      'Europe/Berlin',
      at('2026-01-15T22:40:00Z'), // 23:40 Berlin
      at('2026-01-15T23:10:00Z'), // 00:10 next day
    );
    expect(iso(due)).toEqual(['2026-01-15T22:50:00.000Z', '2026-01-15T23:05:00.000Z']);
  });

  it('returns nothing for no times or an empty window', () => {
    expect(dailyTimeOccurrences([], 'UTC', 0, 10_000_000)).toEqual([]);
    expect(dailyTimeOccurrences(['09:00'], 'UTC', 10, 10)).toEqual([]);
  });

  it('fires a time skipped by spring-forward once, at the shifted instant', () => {
    // 2026-03-08: New York clocks jump 02:00 -> 03:00 (07:00Z).
    const due = dailyTimeOccurrences(['02:30'], 'America/New_York', at('2026-03-08T05:00:00Z'), at('2026-03-08T09:00:00Z'));
    expect(due).toHaveLength(1);
  });

  it('fires a time repeated by fall-back exactly once', () => {
    // 2026-11-01: New York 01:30 happens twice (05:30Z EDT and 06:30Z EST).
    const due = dailyTimeOccurrences(['01:30'], 'America/New_York', at('2026-11-01T04:00:00Z'), at('2026-11-01T08:00:00Z'));
    expect(due).toHaveLength(1);
  });

  it('works for zones far from UTC', () => {
    // 08:00 in Kiritimati (UTC+14) on 2026-01-15 is 18:00Z on the 14th.
    const due = dailyTimeOccurrences(['08:00'], 'Pacific/Kiritimati', at('2026-01-14T17:59:00Z'), at('2026-01-14T18:00:00Z'));
    expect(iso(due)).toEqual(['2026-01-14T18:00:00.000Z']);
  });

  it('gives one occurrence per day over several days', () => {
    const due = dailyTimeOccurrences(['09:00'], 'UTC', at('2026-01-01T00:00:00Z'), at('2026-01-04T00:00:00Z'));
    expect(due).toHaveLength(3);
  });
});

describe('validateDailyTimes', () => {
  it('accepts unique HH:MM times', () => {
    expect(validateDailyTimes([])).toBeNull();
    expect(validateDailyTimes(['00:00', '09:30', '23:59'])).toBeNull();
  });

  it('rejects bad shapes, bad times, duplicates and too many', () => {
    expect(validateDailyTimes('09:00')).toMatch(/list/);
    expect(validateDailyTimes(['9:00'])).toMatch(/Invalid/);
    expect(validateDailyTimes(['24:00'])).toMatch(/Invalid/);
    expect(validateDailyTimes(['09:60'])).toMatch(/Invalid/);
    expect(validateDailyTimes([900])).toMatch(/Invalid/);
    expect(validateDailyTimes(['09:00', '09:00'])).toMatch(/Duplicate/);
    expect(validateDailyTimes(['01:00', '02:00', '03:00'], 2)).toMatch(/At most 2/);
  });
});
