import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNominatimRateLimiter, waitForNominatimSlot } from '../services/nominatim';

describe('Nominatim rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNominatimRateLimiter();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces concurrent callers one slot apart', async () => {
    const fired: number[] = [];
    const t0 = Date.now();
    const callers = [0, 1, 2].map(async () => {
      await waitForNominatimSlot();
      fired.push(Date.now() - t0);
    });
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(callers);
    expect(fired).toEqual([0, 1100, 2200]);
  });

  it('does not delay a lone caller after a quiet period', async () => {
    await waitForNominatimSlot();
    await vi.advanceTimersByTimeAsync(5000);
    const t0 = Date.now();
    await waitForNominatimSlot();
    expect(Date.now() - t0).toBe(0);
  });
});
