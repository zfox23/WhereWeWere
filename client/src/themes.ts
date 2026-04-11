export type ThemeMode = 'light' | 'dark';

export type AppThemeId =
  | 'sunrise'
  | 'paper'
  | 'sprout'
  | 'lagoon'
  | 'lavender'
  | 'citrus'
  | 'midnight'
  | 'ocean'
  | 'ember'
  | 'aurora'
  | 'graphite'
  | 'mulberry';
export type ThemePreference = 'system' | AppThemeId;
export type StoredThemePreference = ThemePreference | 'light' | 'dark';

type PaletteStep = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

interface ThemeDefinition {
  id: AppThemeId;
  label: string;
  description: string;
  mode: ThemeMode;
  palette: Record<PaletteStep, string>;
  preview: [string, string, string];
  background: {
    start: string;
    mid: string;
    end: string;
    glow: string;
    glowSecondary: string;
    foreground: string;
  };
}

const PALETTE_STEPS: PaletteStep[] = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

export const DEFAULT_THEME_BY_MODE: Record<ThemeMode, AppThemeId> = {
  light: 'sunrise',
  dark: 'midnight',
};

export const SYSTEM_THEME_ID = 'system' as const;

export const THEME_DEFINITIONS: Record<AppThemeId, ThemeDefinition> = {
  sunrise: {
    id: 'sunrise',
    label: 'Sunrise',
    description: 'Warm citrus highlights with the existing bright, glassy feel.',
    mode: 'light',
    palette: {
      '50': '255 247 237',
      '100': '255 237 213',
      '200': '254 215 170',
      '300': '253 186 116',
      '400': '251 146 60',
      '500': '249 115 22',
      '600': '234 88 12',
      '700': '194 65 12',
      '800': '154 52 18',
      '900': '124 45 18',
      '950': '67 20 7',
    },
    preview: ['255 247 237', '251 146 60', '194 65 12'],
    background: {
      start: '255 247 237',
      mid: '255 255 255',
      end: '255 251 235',
      glow: '251 146 60',
      glowSecondary: '252 211 77',
      foreground: '17 24 39',
    },
  },
  paper: {
    id: 'paper',
    label: 'Paper',
    description: 'Soft rose accents on an airy editorial light surface.',
    mode: 'light',
    palette: {
      '50': '255 241 242',
      '100': '255 228 230',
      '200': '254 205 211',
      '300': '253 164 175',
      '400': '251 113 133',
      '500': '244 63 94',
      '600': '225 29 72',
      '700': '190 24 93',
      '800': '159 18 57',
      '900': '136 19 55',
      '950': '76 5 25',
    },
    preview: ['255 241 242', '244 63 94', '190 24 93'],
    background: {
      start: '255 241 242',
      mid: '255 251 251',
      end: '254 242 242',
      glow: '251 113 133',
      glowSecondary: '244 114 182',
      foreground: '24 24 27',
    },
  },
  sprout: {
    id: 'sprout',
    label: 'Sprout',
    description: 'Fresh greens with a cooler, botanical light background.',
    mode: 'light',
    palette: {
      '50': '236 253 245',
      '100': '209 250 229',
      '200': '167 243 208',
      '300': '110 231 183',
      '400': '52 211 153',
      '500': '16 185 129',
      '600': '5 150 105',
      '700': '4 120 87',
      '800': '6 95 70',
      '900': '6 78 59',
      '950': '2 44 34',
    },
    preview: ['236 253 245', '16 185 129', '4 120 87'],
    background: {
      start: '236 253 245',
      mid: '248 250 252',
      end: '240 253 250',
      glow: '52 211 153',
      glowSecondary: '45 212 191',
      foreground: '15 23 42',
    },
  },
  lagoon: {
    id: 'lagoon',
    label: 'Lagoon',
    description: 'Sea-glass blues with a breezy coastal light backdrop.',
    mode: 'light',
    palette: {
      '50': '240 249 255',
      '100': '224 242 254',
      '200': '186 230 253',
      '300': '125 211 252',
      '400': '56 189 248',
      '500': '14 165 233',
      '600': '2 132 199',
      '700': '3 105 161',
      '800': '7 89 133',
      '900': '12 74 110',
      '950': '8 47 73',
    },
    preview: ['240 249 255', '14 165 233', '3 105 161'],
    background: {
      start: '240 249 255',
      mid: '248 250 252',
      end: '236 254 255',
      glow: '56 189 248',
      glowSecondary: '34 211 238',
      foreground: '15 23 42',
    },
  },
  lavender: {
    id: 'lavender',
    label: 'Lavender',
    description: 'Gentle lilac accents with a pale studio-paper wash.',
    mode: 'light',
    palette: {
      '50': '250 245 255',
      '100': '243 232 255',
      '200': '233 213 255',
      '300': '216 180 254',
      '400': '192 132 252',
      '500': '168 85 247',
      '600': '147 51 234',
      '700': '126 34 206',
      '800': '107 33 168',
      '900': '88 28 135',
      '950': '59 7 100',
    },
    preview: ['250 245 255', '168 85 247', '126 34 206'],
    background: {
      start: '250 245 255',
      mid: '255 255 255',
      end: '245 243 255',
      glow: '192 132 252',
      glowSecondary: '244 114 182',
      foreground: '31 41 55',
    },
  },
  citrus: {
    id: 'citrus',
    label: 'Citrus',
    description: 'Lime and chartreuse energy on a bright spring surface.',
    mode: 'light',
    palette: {
      '50': '247 254 231',
      '100': '236 252 203',
      '200': '217 249 157',
      '300': '190 242 100',
      '400': '163 230 53',
      '500': '132 204 22',
      '600': '101 163 13',
      '700': '77 124 15',
      '800': '63 98 18',
      '900': '54 83 20',
      '950': '26 46 5',
    },
    preview: ['247 254 231', '132 204 22', '77 124 15'],
    background: {
      start: '254 252 232',
      mid: '255 255 255',
      end: '247 254 231',
      glow: '163 230 53',
      glowSecondary: '250 204 21',
      foreground: '30 41 59',
    },
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep indigo contrast with cool neon-leaning accents.',
    mode: 'dark',
    palette: {
      '50': '238 242 255',
      '100': '224 231 255',
      '200': '199 210 254',
      '300': '165 180 252',
      '400': '129 140 248',
      '500': '99 102 241',
      '600': '79 70 229',
      '700': '67 56 202',
      '800': '55 48 163',
      '900': '49 46 129',
      '950': '30 27 75',
    },
    preview: ['30 41 59', '99 102 241', '165 180 252'],
    background: {
      start: '2 6 23',
      mid: '15 23 42',
      end: '17 24 39',
      glow: '99 102 241',
      glowSecondary: '56 189 248',
      foreground: '243 244 246',
    },
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    description: 'Dark teal atmosphere with crisp cyan action colors.',
    mode: 'dark',
    palette: {
      '50': '236 254 255',
      '100': '207 250 254',
      '200': '165 243 252',
      '300': '103 232 249',
      '400': '34 211 238',
      '500': '6 182 212',
      '600': '8 145 178',
      '700': '14 116 144',
      '800': '21 94 117',
      '900': '22 78 99',
      '950': '8 47 73',
    },
    preview: ['15 23 42', '6 182 212', '103 232 249'],
    background: {
      start: '3 37 54',
      mid: '12 18 32',
      end: '17 24 39',
      glow: '34 211 238',
      glowSecondary: '45 212 191',
      foreground: '236 254 255',
    },
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    description: 'A darker furnace palette with copper and amber accents.',
    mode: 'dark',
    palette: {
      '50': '255 251 235',
      '100': '254 243 199',
      '200': '253 230 138',
      '300': '252 211 77',
      '400': '251 191 36',
      '500': '245 158 11',
      '600': '217 119 6',
      '700': '180 83 9',
      '800': '146 64 14',
      '900': '120 53 15',
      '950': '69 26 3',
    },
    preview: ['41 17 5', '245 158 11', '252 211 77'],
    background: {
      start: '41 17 5',
      mid: '28 25 23',
      end: '69 26 3',
      glow: '251 191 36',
      glowSecondary: '249 115 22',
      foreground: '255 251 235',
    },
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora',
    description: 'Emerald-to-violet highlights drifting across deep night tones.',
    mode: 'dark',
    palette: {
      '50': '236 253 245',
      '100': '209 250 229',
      '200': '167 243 208',
      '300': '110 231 183',
      '400': '52 211 153',
      '500': '16 185 129',
      '600': '5 150 105',
      '700': '4 120 87',
      '800': '6 95 70',
      '900': '6 78 59',
      '950': '2 44 34',
    },
    preview: ['17 24 39', '52 211 153', '196 181 253'],
    background: {
      start: '8 15 33',
      mid: '17 24 39',
      end: '28 25 53',
      glow: '52 211 153',
      glowSecondary: '196 181 253',
      foreground: '240 253 250',
    },
  },
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    description: 'Slate monochrome with restrained silver-blue highlights.',
    mode: 'dark',
    palette: {
      '50': '248 250 252',
      '100': '241 245 249',
      '200': '226 232 240',
      '300': '203 213 225',
      '400': '148 163 184',
      '500': '100 116 139',
      '600': '71 85 105',
      '700': '51 65 85',
      '800': '30 41 59',
      '900': '15 23 42',
      '950': '2 6 23',
    },
    preview: ['2 6 23', '100 116 139', '226 232 240'],
    background: {
      start: '3 7 18',
      mid: '17 24 39',
      end: '15 23 42',
      glow: '100 116 139',
      glowSecondary: '148 163 184',
      foreground: '248 250 252',
    },
  },
  mulberry: {
    id: 'mulberry',
    label: 'Mulberry',
    description: 'Plum and berry tones with a richer after-hours contrast.',
    mode: 'dark',
    palette: {
      '50': '253 244 255',
      '100': '250 232 255',
      '200': '245 208 254',
      '300': '240 171 252',
      '400': '232 121 249',
      '500': '217 70 239',
      '600': '192 38 211',
      '700': '162 28 175',
      '800': '134 25 143',
      '900': '112 26 117',
      '950': '74 4 78',
    },
    preview: ['58 12 58', '217 70 239', '244 114 182'],
    background: {
      start: '36 11 54',
      mid: '58 12 58',
      end: '17 24 39',
      glow: '217 70 239',
      glowSecondary: '244 114 182',
      foreground: '253 244 255',
    },
  },
};

export const LIGHT_THEMES = [
  THEME_DEFINITIONS.sunrise,
  THEME_DEFINITIONS.paper,
  THEME_DEFINITIONS.sprout,
  THEME_DEFINITIONS.lagoon,
  THEME_DEFINITIONS.lavender,
  THEME_DEFINITIONS.citrus,
] as const;

export const DARK_THEMES = [
  THEME_DEFINITIONS.midnight,
  THEME_DEFINITIONS.ocean,
  THEME_DEFINITIONS.ember,
  THEME_DEFINITIONS.aurora,
  THEME_DEFINITIONS.graphite,
  THEME_DEFINITIONS.mulberry,
] as const;

export const THEME_GROUPS = [
  { mode: 'light' as const, label: 'Light', themes: LIGHT_THEMES },
  { mode: 'dark' as const, label: 'Dark', themes: DARK_THEMES },
] as const;

export function getThemeDefinition(themeId: AppThemeId): ThemeDefinition {
  return THEME_DEFINITIONS[themeId];
}

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_DEFINITIONS, value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === SYSTEM_THEME_ID || isAppThemeId(value);
}

export function normalizeThemePreference(value: unknown): ThemePreference | null {
  if (value === SYSTEM_THEME_ID) return SYSTEM_THEME_ID;
  if (value === 'light') return DEFAULT_THEME_BY_MODE.light;
  if (value === 'dark') return DEFAULT_THEME_BY_MODE.dark;
  return isAppThemeId(value) ? value : null;
}

export function resolveAppThemeId(value: unknown, fallback: AppThemeId): AppThemeId {
  return isAppThemeId(value) ? value : fallback;
}

export function resolveThemePreference(
  theme: ThemePreference,
  systemTheme: ThemeMode,
  systemThemeSelection: Record<ThemeMode, AppThemeId> = DEFAULT_THEME_BY_MODE
): AppThemeId {
  if (theme === SYSTEM_THEME_ID) {
    return systemThemeSelection[systemTheme];
  }
  return theme;
}

export function getResolvedThemeMode(themeId: AppThemeId): ThemeMode {
  return THEME_DEFINITIONS[themeId].mode;
}

export function applyThemeToRoot(root: HTMLElement, themeId: AppThemeId) {
  const theme = getThemeDefinition(themeId);

  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;

  for (const step of PALETTE_STEPS) {
    root.style.setProperty(`--color-primary-${step}`, theme.palette[step]);
  }

  root.style.setProperty('--app-bg-start', theme.background.start);
  root.style.setProperty('--app-bg-mid', theme.background.mid);
  root.style.setProperty('--app-bg-end', theme.background.end);
  root.style.setProperty('--app-glow', theme.background.glow);
  root.style.setProperty('--app-glow-secondary', theme.background.glowSecondary);
  root.style.setProperty('--app-fg', theme.background.foreground);
}