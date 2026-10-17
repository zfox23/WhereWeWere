import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeGetItem, safeSetItem } from '../../src/utils/storage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safe storage', () => {
  it('round-trips a value', () => {
    safeSetItem('k', 'v');
    expect(safeGetItem('k')).toBe('v');
  });

  it('returns null / swallows errors when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(safeGetItem('k')).toBeNull();
    expect(() => safeSetItem('k', 'v')).not.toThrow();
  });
});
