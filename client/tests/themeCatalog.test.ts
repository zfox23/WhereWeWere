import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_BY_MODE,
  applyThemeToRoot,
  getResolvedThemeMode,
  normalizeThemePreference,
  resolveAppThemeId,
  resolveThemePreference,
} from '../src/themes';

describe('theme catalog', () => {
  it('maps legacy light and dark values to the default presets', () => {
    expect(normalizeThemePreference('light')).toBe(DEFAULT_THEME_BY_MODE.light);
    expect(normalizeThemePreference('dark')).toBe(DEFAULT_THEME_BY_MODE.dark);
  });

  it('resolves system mode to matching light and dark presets', () => {
    expect(resolveThemePreference('system', 'light')).toBe(DEFAULT_THEME_BY_MODE.light);
    expect(resolveThemePreference('system', 'dark')).toBe(DEFAULT_THEME_BY_MODE.dark);
    expect(resolveThemePreference('system', 'dark', { light: 'lagoon', dark: 'mulberry' })).toBe('mulberry');
    expect(getResolvedThemeMode(DEFAULT_THEME_BY_MODE.dark)).toBe('dark');
  });

  it('falls back when stored system theme ids are invalid', () => {
    expect(resolveAppThemeId('not-a-theme', DEFAULT_THEME_BY_MODE.light)).toBe(DEFAULT_THEME_BY_MODE.light);
  });

  it('applies palette variables to the document root', () => {
    const root = document.documentElement;

    applyThemeToRoot(root, 'ocean');

    expect(root.dataset.theme).toBe('ocean');
    expect(root.style.getPropertyValue('--color-primary-500')).toBe('6 182 212');
    expect(root.style.getPropertyValue('--app-glow')).toBe('34 211 238');
    expect(root.style.getPropertyValue('--app-glow-secondary')).toBe('45 212 191');
    expect(root.style.colorScheme).toBe('dark');
  });
});