import { describe, expect, it } from 'vitest';
import { APPEARANCE_SPEC } from 'wwp-shared';
import { CHART_PALETTE_OPTIONS, MAP_STYLE_OPTIONS, chartColors } from '../src/appearance';
import { THEME_DEFINITIONS, applyThemeToRoot, rgbHue } from '../src/themes';
import { tileSource } from '../../plugins/location/ui/ThemedTileLayer';

const hexColor = /^#[0-9a-f]{6}$/;

describe('chart palettes', () => {
  it('offers exactly the palettes the server accepts', () => {
    expect(CHART_PALETTE_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.chartPalette.values]);
  });

  it('keeps the original chart colors as Classic', () => {
    const light = chartColors('classic', THEME_DEFINITIONS.sunrise);
    expect(light.slice(0, 5)).toEqual(['#ea580c', '#2563eb', '#10b981', '#f43f5e', '#d97706']);
    const dark = chartColors('classic', THEME_DEFINITIONS.midnight);
    expect(dark[1]).toBe('#3b82f6');
    expect(dark[4]).toBe('#fbbf24');
  });

  it('gives eight hex colors for every palette and theme', () => {
    for (const option of CHART_PALETTE_OPTIONS) {
      for (const theme of Object.values(THEME_DEFINITIONS)) {
        const colors = chartColors(option.id, theme);
        expect(colors, `${option.id}/${theme.id}`).toHaveLength(8);
        for (const c of colors) expect(c).toMatch(hexColor);
      }
    }
  });

  it('follows the theme for Theme and Monochrome', () => {
    expect(chartColors('theme', THEME_DEFINITIONS.matcha)).not.toEqual(chartColors('theme', THEME_DEFINITIONS.velvet));
    expect(chartColors('mono', THEME_DEFINITIONS.sunrise)[0]).toBe('#ea580c'); // sunrise primary-600
  });
});

describe('map styles', () => {
  it('offers exactly the styles the server accepts', () => {
    expect(MAP_STYLE_OPTIONS.map((o) => o.id)).toEqual([...APPEARANCE_SPEC.mapStyle.values]);
  });

  it('uses OpenStreetMap (CORS, cacheable) for the filter styles', () => {
    for (const style of ['standard', 'tinted', 'vintage'] as const) {
      const source = tileSource(style, 'dark');
      expect(source.url).toContain('tile.openstreetmap.org');
      expect(source.cors).toBe(true);
    }
  });

  it('credits third-party providers and picks the basemap for the mode', () => {
    expect(tileSource('muted', 'dark').url).toContain('dark_all');
    expect(tileSource('muted', 'light').url).toContain('light_all');
    expect(tileSource('muted', 'light').credit).toBe(true);
    expect(tileSource('satellite', 'light').url).toContain('World_Imagery');
    expect(tileSource('satellite', 'light').credit).toBe(true);
    // Every provider is named in the picker.
    expect(MAP_STYLE_OPTIONS.filter((o) => o.provider).map((o) => o.id)).toEqual(['muted', 'satellite']);
  });

  it('sets the tinted-map hue from the theme glow', () => {
    expect(Math.round(rgbHue('255 0 0'))).toBe(0);
    expect(Math.round(rgbHue('0 0 255'))).toBe(240);
    applyThemeToRoot(document.documentElement, 'ocean');
    const expected = `${Math.round(rgbHue(THEME_DEFINITIONS.ocean.background.glow) - 35)}deg`;
    expect(document.documentElement.style.getPropertyValue('--app-map-hue')).toBe(expected);
  });
});
