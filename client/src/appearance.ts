/**
 * Labels, previews and loaders for the appearance knobs in Settings > Display.
 * Allowed values come from the shared spec (wwp-shared appearance), which the
 * server also validates; the CSS for each knob lives in index.css under
 * html[data-<knob>="<value>"].
 */
import type { Appearance } from 'wwp-shared';

export interface AppearanceOption<V extends string> {
  id: V;
  label: string;
  description?: string;
}

export interface FontOption extends AppearanceOption<Appearance['font']> {
  /** CSS font-family stacks, for the picker's own sample text. */
  body: string;
  heading: string;
  headingWeight: number;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Lato with Bebas Neue headings',
    body: 'Lato, ui-sans-serif, system-ui, sans-serif',
    heading: '"Bebas Neue", Impact, ui-sans-serif, sans-serif',
    headingWeight: 400,
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Source Serif with Fraunces headings',
    body: '"Source Serif 4", Georgia, ui-serif, serif',
    heading: 'Fraunces, Georgia, ui-serif, serif',
    headingWeight: 700,
  },
  {
    id: 'friendly',
    label: 'Friendly',
    description: 'Rounded Nunito throughout',
    body: 'Nunito, ui-rounded, ui-sans-serif, system-ui, sans-serif',
    heading: 'Nunito, ui-rounded, ui-sans-serif, system-ui, sans-serif',
    headingWeight: 800,
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'IBM Plex Sans with Plex Mono headings',
    body: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    heading: '"IBM Plex Mono", ui-monospace, monospace',
    headingWeight: 600,
  },
  {
    id: 'journal',
    label: 'Journal',
    description: 'Lora with handwritten Caveat headings',
    body: 'Lora, Georgia, ui-serif, serif',
    heading: 'Caveat, "Segoe Print", cursive',
    headingWeight: 700,
  },
  {
    id: 'system',
    label: 'System',
    description: "Your device's own font, nothing to download",
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    heading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingWeight: 700,
  },
];

/**
 * Font files are only downloaded for the pairing in use. Classic's are
 * imported up front in main.tsx (it is the default and the login screen's).
 */
const FONT_LOADERS: Record<Appearance['font'], () => Promise<unknown>> = {
  classic: () => Promise.resolve(),
  system: () => Promise.resolve(),
  editorial: () => Promise.all([
    import('@fontsource/source-serif-4/400.css'),
    import('@fontsource/source-serif-4/400-italic.css'),
    import('@fontsource/source-serif-4/700.css'),
    import('@fontsource/fraunces/700.css'),
  ]),
  friendly: () => Promise.all([
    import('@fontsource/nunito/400.css'),
    import('@fontsource/nunito/400-italic.css'),
    import('@fontsource/nunito/700.css'),
    import('@fontsource/nunito/800.css'),
  ]),
  technical: () => Promise.all([
    import('@fontsource/ibm-plex-sans/400.css'),
    import('@fontsource/ibm-plex-sans/400-italic.css'),
    import('@fontsource/ibm-plex-sans/700.css'),
    import('@fontsource/ibm-plex-mono/600.css'),
  ]),
  journal: () => Promise.all([
    import('@fontsource/lora/400.css'),
    import('@fontsource/lora/400-italic.css'),
    import('@fontsource/lora/700.css'),
    import('@fontsource/caveat/700.css'),
  ]),
};

export function loadFontPairing(font: Appearance['font']): Promise<unknown> {
  return FONT_LOADERS[font]().catch(() => {
    // Offline or blocked: the fallback stacks in index.css still render.
  });
}

export const TEXT_SIZE_OPTIONS: AppearanceOption<Appearance['textSize']>[] = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Default' },
  { id: 'l', label: 'Large' },
  { id: 'xl', label: 'Extra large' },
];

export const RADIUS_OPTIONS: AppearanceOption<Appearance['radius']>[] = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'subtle', label: 'Subtle' },
  { id: 'default', label: 'Rounded' },
  { id: 'pillowy', label: 'Pillowy' },
];

export const SURFACE_OPTIONS: AppearanceOption<Appearance['surface']>[] = [
  { id: 'frosted', label: 'Frosted', description: 'Translucent glass over the background' },
  { id: 'solid', label: 'Solid', description: 'Opaque panels, crisp and calm' },
  { id: 'outlined', label: 'Outlined', description: 'Clear panels with a defined edge' },
  { id: 'paper', label: 'Paper', description: 'Warm, grainy, like a notebook page' },
];

export const BLUR_OPTIONS: AppearanceOption<Appearance['blur']>[] = [
  { id: 'off', label: 'Off' },
  { id: 'light', label: 'Light' },
  { id: 'default', label: 'Default' },
  { id: 'heavy', label: 'Heavy' },
];

export const SHADOW_OPTIONS: AppearanceOption<Appearance['shadow']>[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'soft', label: 'Soft' },
  { id: 'lifted', label: 'Lifted' },
];

export function labelFor<V extends string>(options: AppearanceOption<V>[], id: V): string {
  return options.find((o) => o.id === id)?.label ?? id;
}

/** True when animations should stop: the in-app toggle or the OS setting. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'on') {
    return true;
  }
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── Map style ───────────────────────────────────────────────────────────────

export interface MapStyleOption extends AppearanceOption<Appearance['mapStyle']> {
  /** Third-party tile host, shown so the user knows where tiles come from. */
  provider?: string;
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  { id: 'standard', label: 'Standard', description: 'OpenStreetMap as drawn' },
  { id: 'tinted', label: 'Theme-tinted', description: 'Recolored to your theme; dark with dark themes' },
  { id: 'vintage', label: 'Vintage', description: 'Warm, faded, like an old atlas' },
  { id: 'muted', label: 'Muted', description: 'Quiet light or dark basemap', provider: 'CARTO' },
  { id: 'satellite', label: 'Satellite', description: 'Aerial imagery', provider: 'Esri' },
];

// ─── Chart palette ───────────────────────────────────────────────────────────
//
// Eight series colors per palette. Slots carry meaning where charts have it:
// 0 primary (temperature), 1 cool (rain, speed), 2 green (elevation),
// 3 warm red (heart rate), 4 sun, 5–7 extras.

export const CHART_PALETTE_OPTIONS: AppearanceOption<Appearance['chartPalette']>[] = [
  { id: 'classic', label: 'Classic', description: 'The original colors' },
  { id: 'theme', label: 'Theme', description: 'Led by your theme’s accent' },
  { id: 'vivid', label: 'Vivid', description: 'Bold and saturated' },
  { id: 'pastel', label: 'Pastel', description: 'Soft and light' },
  { id: 'colorblind', label: 'Colorblind-safe', description: 'Okabe–Ito, distinct for all color vision' },
  { id: 'mono', label: 'Monochrome', description: 'Shades of your accent' },
];

interface ThemeColors {
  mode: 'light' | 'dark';
  palette: Record<string, string>;
  background: { glow: string; glowSecondary: string };
}

const CLASSIC = {
  light: ['#ea580c', '#2563eb', '#10b981', '#f43f5e', '#d97706', '#8b5cf6', '#06b6d4', '#84cc16'],
  dark: ['#ea580c', '#3b82f6', '#10b981', '#f43f5e', '#fbbf24', '#a78bfa', '#22d3ee', '#a3e635'],
};

function hex(rgb: string): string {
  return `#${rgb.split(' ').map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/** The palette's eight series colors (hex) for a theme. */
export function chartColors(palette: Appearance['chartPalette'], theme: ThemeColors): string[] {
  const dark = theme.mode === 'dark';
  const p = (step: string) => hex(theme.palette[step]);
  const classic = dark ? CLASSIC.dark : CLASSIC.light;
  switch (palette) {
    case 'theme':
      return [
        p(dark ? '400' : '600'),
        hex(theme.background.glowSecondary),
        p(dark ? '200' : '800'),
        ...classic.slice(3),
      ];
    case 'vivid':
      return ['#ff3d00', '#2979ff', '#00c853', '#ff1744', '#ffc400', '#d500f9', '#00b8d4', '#64dd17'];
    case 'pastel':
      return ['#f4a582', '#92c5de', '#a6dba0', '#f1b6da', '#fdd49e', '#c2a5cf', '#9edae5', '#d9ef8b'];
    case 'colorblind':
      return ['#e69f00', dark ? '#56b4e9' : '#0072b2', '#009e73', '#d55e00', '#f0e442', '#cc79a7', dark ? '#0072b2' : '#56b4e9', dark ? '#ffffff' : '#000000'];
    case 'mono':
      return dark
        ? [p('400'), p('200'), p('600'), p('300'), p('100'), p('500'), p('700'), p('50')]
        : [p('600'), p('400'), p('800'), p('500'), p('300'), p('700'), p('900'), p('200')];
    case 'classic':
    default:
      return classic;
  }
}
