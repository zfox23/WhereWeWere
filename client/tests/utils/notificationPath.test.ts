import { describe, expect, it } from 'vitest';
import { safeNotificationPath } from '../../src/utils/notificationPath';

describe('safeNotificationPath', () => {
  it('keeps app-relative paths', () => {
    expect(safeNotificationPath('/mood-check-in')).toBe('/mood-check-in');
    expect(safeNotificationPath('/settings?tab=notifications')).toBe('/settings?tab=notifications');
  });

  it('sends anything off-origin or malformed to Home', () => {
    expect(safeNotificationPath('https://evil.example/')).toBe('/');
    expect(safeNotificationPath('//evil.example/')).toBe('/');
    expect(safeNotificationPath('/\\evil.example')).toBe('/');
    expect(safeNotificationPath('javascript:alert(1)')).toBe('/');
    expect(safeNotificationPath(undefined)).toBe('/');
    expect(safeNotificationPath(42)).toBe('/');
  });
});
