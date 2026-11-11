/**
 * Per-user appearance knobs (Settings > Display), stored as one JSONB object
 * in `user_settings.appearance`. The theme itself (palette) lives in its own
 * columns; everything else that styles the app is a key here.
 *
 * Shared so the server validates exactly what the client can send. To add a
 * knob: add it to APPEARANCE_SPEC, then handle it in the client's
 * applyAppearanceToRoot (client/src/themes.ts) and index.css.
 */

export const APPEARANCE_SPEC = {
  bgPattern: {
    values: [
      'dots', 'grid', 'crosshatch', 'topographic', 'linen',
      'waves', 'hexagons', 'terrazzo', 'grain', 'plaid', 'pinstripe', 'stars',
      'blueprint', 'constellations', 'contour', 'moroccan',
      // Drawn from the user's check-ins (location plugin, /place-patterns).
      'myplaces', 'streets',
      'none',
    ],
    default: 'dots',
  },
  /** Animated layer over the background (off under reduced motion). */
  bgMotion: {
    values: ['none', 'aurora', 'starfield', 'bokeh', 'grain', 'embers', 'mist', 'pulse', 'horizon'],
    default: 'none',
  },
  bgGradient: {
    values: ['soft', 'radial', 'flat'],
    default: 'soft',
  },
  /** Body + heading font pairing. */
  font: {
    values: ['classic', 'editorial', 'friendly', 'technical', 'journal', 'system', 'modern', 'artisan'],
    default: 'classic',
  },
  /** Scales the root font size, so rem-based text and spacing follow. */
  textSize: {
    values: ['s', 'm', 'l', 'xl'],
    default: 'm',
  },
  radius: {
    values: ['sharp', 'subtle', 'default', 'pillowy'],
    default: 'default',
  },
  /** How cards and panels are drawn. */
  surface: {
    values: ['frosted', 'solid', 'outlined', 'paper', 'luminous', 'tinted'],
    default: 'frosted',
  },
  blur: {
    values: ['off', 'light', 'default', 'heavy'],
    default: 'default',
  },
  shadow: {
    values: ['flat', 'soft', 'lifted'],
    default: 'soft',
  },
  /** Opaque panels and no backdrop blur, whatever the surface style. */
  reduceTransparency: {
    values: ['off', 'on'],
    default: 'off',
  },
  /** 'system' follows the OS setting; 'on' stops animations regardless. */
  reduceMotion: {
    values: ['system', 'on'],
    default: 'system',
  },
  /** Photo wallpaper behind the app (the image itself: GET /settings/wallpaper). */
  wallpaper: {
    values: ['off', 'on'],
    default: 'off',
  },
  /** Wallpaper blur in px. */
  wallpaperBlur: {
    min: 0,
    max: 30,
    default: 8,
  },
  /** How much the theme background washes over the wallpaper, in %. */
  wallpaperDim: {
    min: 0,
    max: 80,
    default: 35,
  },
  /** Recolor the wallpaper toward the theme's glow color. */
  wallpaperTint: {
    values: ['off', 'on'],
    default: 'off',
  },
  /**
   * Map tiles. standard/tinted/vintage are OpenStreetMap (tinted and vintage
   * are CSS filters); muted loads CARTO tiles and satellite Esri imagery.
   */
  mapStyle: {
    values: ['standard', 'tinted', 'vintage', 'muted', 'satellite'],
    default: 'standard',
  },
  /** Series colors for charts and track lines. */
  chartPalette: {
    values: ['classic', 'theme', 'vivid', 'pastel', 'colorblind', 'mono'],
    default: 'classic',
  },
} as const;

type AppearanceSpec = typeof APPEARANCE_SPEC;

export type AppearanceKey = keyof AppearanceSpec;

/** Knobs with a fixed list of values (exposed as html data-* attributes). */
export type AppearanceEnumKey = {
  [K in AppearanceKey]: AppearanceSpec[K] extends { values: readonly string[] } ? K : never;
}[AppearanceKey];

/** Knobs holding an integer in [min, max] (exposed as CSS variables). */
export type AppearanceRangeKey = Exclude<AppearanceKey, AppearanceEnumKey>;

export type Appearance = {
  [K in AppearanceKey]: AppearanceSpec[K] extends { values: readonly (infer V)[] } ? V : number;
};

export const APPEARANCE_KEYS = Object.keys(APPEARANCE_SPEC) as AppearanceKey[];

export function isAppearanceRangeKey(key: AppearanceKey): key is AppearanceRangeKey {
  return !('values' in APPEARANCE_SPEC[key]);
}

export const APPEARANCE_ENUM_KEYS = APPEARANCE_KEYS.filter(
  (key): key is AppearanceEnumKey => !isAppearanceRangeKey(key),
);
export const APPEARANCE_RANGE_KEYS = APPEARANCE_KEYS.filter(isAppearanceRangeKey);

export const DEFAULT_APPEARANCE: Appearance = Object.fromEntries(
  APPEARANCE_KEYS.map((key) => [key, APPEARANCE_SPEC[key].default]),
) as Appearance;

export function isAppearanceValue<K extends AppearanceKey>(key: K, value: unknown): value is Appearance[K] {
  const spec = APPEARANCE_SPEC[key] as { values?: readonly unknown[]; min?: number; max?: number };
  if (spec.values) return spec.values.includes(value);
  return typeof value === 'number' && Number.isInteger(value) && value >= spec.min! && value <= spec.max!;
}

function describeAllowed(key: AppearanceKey): string {
  const spec = APPEARANCE_SPEC[key] as { values?: readonly string[]; min?: number; max?: number };
  return spec.values ? `one of: ${spec.values.join(', ')}` : `an integer from ${spec.min} to ${spec.max}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strictly validate a partial update. Unknown keys and invalid values are
 * errors, so a typo in the client fails loudly instead of being stored.
 */
export function validateAppearancePatch(
  input: unknown,
): { ok: true; value: Partial<Appearance> } | { ok: false; error: string } {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'appearance must be an object' };
  }
  const value: Partial<Record<AppearanceKey, unknown>> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(APPEARANCE_SPEC, key)) {
      return { ok: false, error: `Unknown appearance setting "${key}"` };
    }
    const k = key as AppearanceKey;
    if (!isAppearanceValue(k, raw)) {
      return {
        ok: false,
        error: `appearance.${key} must be ${describeAllowed(k)}`,
      };
    }
    value[k] = raw;
  }
  return { ok: true, value: value as Partial<Appearance> };
}

/**
 * Leniently read a stored object (DB row, backup, localStorage): keep valid
 * values, drop unknown keys, fill gaps with defaults. Values from an older or
 * newer app version must never break rendering.
 */
export function normalizeAppearance(input: unknown): Appearance {
  const result: Record<string, unknown> = { ...DEFAULT_APPEARANCE };
  if (isPlainObject(input)) {
    for (const key of APPEARANCE_KEYS) {
      if (isAppearanceValue(key, input[key])) result[key] = input[key];
    }
  }
  return result as Appearance;
}

/** Only the valid known keys of a stored object, without defaults filled in. */
export function pickValidAppearance(input: unknown): Partial<Appearance> {
  const result: Record<string, unknown> = {};
  if (isPlainObject(input)) {
    for (const key of APPEARANCE_KEYS) {
      if (isAppearanceValue(key, input[key])) result[key] = input[key];
    }
  }
  return result as Partial<Appearance>;
}
