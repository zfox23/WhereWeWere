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
    values: ['dots', 'grid', 'crosshatch', 'topographic', 'linen', 'none'],
    default: 'dots',
  },
  bgGradient: {
    values: ['soft', 'radial', 'flat'],
    default: 'soft',
  },
  /** Body + heading font pairing. */
  font: {
    values: ['classic', 'editorial', 'friendly', 'technical', 'journal', 'system'],
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
    values: ['frosted', 'solid', 'outlined', 'paper'],
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
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_SPEC;

export type Appearance = {
  [K in AppearanceKey]: (typeof APPEARANCE_SPEC)[K]['values'][number];
};

export const APPEARANCE_KEYS = Object.keys(APPEARANCE_SPEC) as AppearanceKey[];

export const DEFAULT_APPEARANCE: Appearance = Object.fromEntries(
  APPEARANCE_KEYS.map((key) => [key, APPEARANCE_SPEC[key].default]),
) as Appearance;

export function isAppearanceValue<K extends AppearanceKey>(key: K, value: unknown): value is Appearance[K] {
  return (APPEARANCE_SPEC[key].values as readonly unknown[]).includes(value);
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
        error: `appearance.${key} must be one of: ${APPEARANCE_SPEC[k].values.join(', ')}`,
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
