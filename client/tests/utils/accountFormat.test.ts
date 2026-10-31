import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatRelative, generateTemporaryPassword } from '../../src/utils/accountFormat';

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge on macOS'],
    [null, 'Unknown device'],
  ])('%s → %s', (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it('formats recent times relatively', () => {
    expect(formatRelative('2026-10-30T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-30T11:00:00Z', now)).toBe('1 hour ago');
    expect(formatRelative('2026-10-27T12:00:00Z', now)).toBe('3 days ago');
    expect(formatRelative(null, now)).toBe('never');
  });
});

describe('generateTemporaryPassword', () => {
  it('meets the minimum length and varies', () => {
    const a = generateTemporaryPassword();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(generateTemporaryPassword()).not.toBe(a);
  });
});
