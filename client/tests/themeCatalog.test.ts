import { describe, expect, it } from 'vitest';

import {
  APPEARANCE_SPEC,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  validateAppearancePatch,
} from 'wwp-shared';
import {
  BG_GRADIENT_OPTIONS,
  BG_PATTERN_OPTIONS,
  DEFAULT_THEME_BY_MODE,
  THEME_DEFINITIONS,
  THEME_GROUPS,
  applyAppearanceToRoot,
  readAppearanceAttrs,
  type AppThemeId,
  applyThemeToRoot,
  getResolvedThemeMode,
  normalizeThemePreference,
  resolveAppThemeId,
  resolveThemePreference,
} from '../src/themes';
import {
  BLUR_OPTIONS,
  FONT_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  SURFACE_OPTIONS,
  TEXT_SIZE_OPTIONS,
  prefersReducedMotion,
} from '../src/appearance';

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
describe('theme catalog completeness', () => {
  const ids = Object.keys(THEME_DEFINITIONS) as AppThemeId[];
  const rgb = /^\d{1,3} \d{1,3} \d{1,3}$/;

  it('defines every palette step and background color for every theme', () => {
    for (const id of ids) {
      const def = THEME_DEFINITIONS[id];
      expect(def.id).toBe(id);
      expect(['light', 'dark']).toContain(def.mode);
      for (const step of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const) {
        expect(def.palette[step], `${id} ${step}`).toMatch(rgb);
      }
      for (const value of [...def.preview, ...Object.values(def.background)]) {
        expect(value, id).toMatch(rgb);
      }
    }
  });

  it('keeps theme ids within the 20-character theme columns', () => {
    for (const id of ids) expect(id.length, id).toBeLessThanOrEqual(20);
  });

  it('lists every theme in exactly one picker group', () => {
    const grouped = THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id));
    expect([...grouped].sort()).toEqual([...ids].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('keeps light and dark groups to their mode', () => {
    for (const group of THEME_GROUPS) {
      if (group.id === 'seasonal') continue;
      for (const t of group.themes) expect(t.mode, t.id).toBe(group.id);
    }
  });

  it('lets seasonal themes act as Follow System pairings', () => {
    expect(resolveThemePreference('system', 'dark', { light: 'springbloom', dark: 'midwinter' })).toBe('midwinter');
    expect(resolveThemePreference('system', 'light', { light: 'springbloom', dark: 'midwinter' })).toBe('springbloom');
  });
});

describe('appearance', () => {
  it('offers a labelled option for exactly the values the server accepts', () => {
    expect(BG_PATTERN_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.bgPattern.values]);
    expect(BG_GRADIENT_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.bgGradient.values]);
  });

  it('offers a labelled option for every typography and surface value', () => {
    expect(FONT_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.font.values]);
    expect(TEXT_SIZE_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.textSize.values]);
    expect(RADIUS_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.radius.values]);
    expect(SURFACE_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.surface.values]);
    expect(BLUR_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.blur.values]);
    expect(SHADOW_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.shadow.values]);
  });

  it('honours the in-app reduce motion switch', () => {
    const root = document.documentElement;
    applyAppearanceToRoot(root, { ...DEFAULT_APPEARANCE, reduceMotion: 'on' });
    expect(prefersReducedMotion()).toBe(true);
    applyAppearanceToRoot(root, DEFAULT_APPEARANCE);
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it('applies each knob as a data attribute and reads them back', () => {
    const root = document.documentElement;
    applyAppearanceToRoot(root, { ...DEFAULT_APPEARANCE, bgPattern: 'grid', bgGradient: 'flat' });
    expect(root.getAttribute('data-bg-pattern')).toBe('grid');
    expect(root.getAttribute('data-bg-gradient')).toBe('flat');
    expect(root.getAttribute('data-text-size')).toBe('m');
    expect(readAppearanceAttrs(root)).toEqual({ ...DEFAULT_APPEARANCE, bgPattern: 'grid', bgGradient: 'flat' });
  });

  it('rejects unknown keys and values in an update', () => {
    expect(validateAppearancePatch({ bgPattern: 'grid' })).toEqual({ ok: true, value: { bgPattern: 'grid' } });
    expect(validateAppearancePatch({ bgPattern: 'plaid-ish' }).ok).toBe(false);
    expect(validateAppearancePatch({ sparkles: true }).ok).toBe(false);
    expect(validateAppearancePatch(['grid']).ok).toBe(false);
  });

  it('reads stored values leniently, filling defaults', () => {
    expect(normalizeAppearance({ bgPattern: 'linen', bgGradient: 'nope', extra: 1 })).toEqual({
      ...DEFAULT_APPEARANCE,
      bgPattern: 'linen',
    });
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
});
