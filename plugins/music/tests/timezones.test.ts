import { describe, expect, it } from 'vitest';
import { timezoneAt, type TimezoneAnchor } from '../services/timezones';

const at = (iso: string, timezone: string): TimezoneAnchor => ({ at: Date.parse(iso), timezone });

const ANCHORS = [
  at('2024-01-01T00:00:00Z', 'America/Chicago'),
  at('2024-03-01T00:00:00Z', 'Pacific/Auckland'),
  at('2024-04-01T00:00:00Z', 'Europe/Paris'),
];

describe('timezoneAt', () => {
  it('uses the latest anchor at or before the moment', () => {
    expect(timezoneAt(ANCHORS, Date.parse('2024-02-15T12:00:00Z'), 'UTC')).toBe('America/Chicago');
    expect(timezoneAt(ANCHORS, Date.parse('2024-03-20T00:00:00Z'), 'UTC')).toBe('Pacific/Auckland');
    expect(timezoneAt(ANCHORS, Date.parse('2030-01-01T00:00:00Z'), 'UTC')).toBe('Europe/Paris');
  });

  it('treats an anchor as in effect from its own instant', () => {
    expect(timezoneAt(ANCHORS, Date.parse('2024-03-01T00:00:00Z'), 'UTC')).toBe('Pacific/Auckland');
    expect(timezoneAt(ANCHORS, Date.parse('2024-02-29T23:59:59Z'), 'UTC')).toBe('America/Chicago');
  });

  it('falls back before the first anchor and with no anchors', () => {
    expect(timezoneAt(ANCHORS, Date.parse('2023-12-31T23:59:59Z'), 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(timezoneAt([], Date.parse('2024-01-01T00:00:00Z'), 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});
