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
