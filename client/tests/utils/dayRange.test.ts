import { describe, it, expect } from 'vitest';
import { zonedDayBounds } from '../../src/utils/dayRange';

describe('zonedDayBounds', () => {
  it('covers the local day, not the UTC day', () => {
    const b = zonedDayBounds('2024-07-04', 'America/New_York');
    expect(b.startIso).toBe('2024-07-04T04:00:00.000Z');
    expect(b.endIso).toBe('2024-07-05T03:59:59.999Z');
    expect(b.startOffset).toBe('-04:00');
    expect(b.endOffset).toBe('-04:00');
  });

  it('uses the winter offset in winter', () => {
    const b = zonedDayBounds('2024-01-15', 'America/New_York');
    expect(b.startIso).toBe('2024-01-15T05:00:00.000Z');
    expect(b.startOffset).toBe('-05:00');
  });

  it('handles a DST transition day', () => {
    const b = zonedDayBounds('2024-03-10', 'America/New_York');
    expect(b.startOffset).toBe('-05:00');
    expect(b.endOffset).toBe('-04:00');
    expect(b.endIso).toBe('2024-03-11T03:59:59.999Z');
  });

  it('handles fractional offsets', () => {
    const b = zonedDayBounds('2024-05-01', 'Asia/Kolkata');
    expect(b.startIso).toBe('2024-04-30T18:30:00.000Z');
    expect(b.startOffset).toBe('+05:30');
  });
});
