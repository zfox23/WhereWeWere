import { describe, it, expect } from 'vitest';
import { mapWithConcurrency, parseCheckinIdList, MAX_CHECKIN_ID_BATCH } from '../../src/services/batching';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseCheckinIdList', () => {
  it('keeps valid UUIDs, drops junk and duplicates, lowercases', () => {
    expect(parseCheckinIdList(`${A},nope,${B},${A.toUpperCase()}, ,`)).toEqual([A, B]);
  });

  it('returns [] for a missing or non-string value', () => {
    expect(parseCheckinIdList(undefined)).toEqual([]);
    expect(parseCheckinIdList(['x'])).toEqual([]);
  });

  it('caps the batch size', () => {
    const many = Array.from({ length: MAX_CHECKIN_ID_BATCH + 50 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    ).join(',');
    expect(parseCheckinIdList(many)).toHaveLength(MAX_CHECKIN_ID_BATCH);
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves result order', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
