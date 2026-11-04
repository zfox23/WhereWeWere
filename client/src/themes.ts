import {
  APPEARANCE_ENUM_KEYS,
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppearanceRangeKey,
} from 'wwp-shared';

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
  | 'mulberry'
  | 'blossom'
  | 'neonwave'
  | 'forest'
  | 'sandstone'
  | 'arctic'
  | 'coralreef'
  | 'mocha'
  | 'sunset'
  | 'matcha'
  | 'peach'
  | 'terracotta'
  | 'seafoam'
  | 'lilacmist'
  | 'nebula'
  | 'obsidiangold'
  | 'deepsea'
  | 'velvet'
  | 'mossstone'
  | 'contrastlight'
  | 'contrastdark'
  | 'springbloom'
  | 'midsummer'
  | 'harvest'
  | 'autumnember'
  | 'winterfrost'
  | 'midwinter'
  | 'spooky'
  | 'festive';
export type ThemePreference = 'system' | AppThemeId;
export type StoredThemePreference = ThemePreference | 'light' | 'dark';

type PaletteStep = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

export interface ThemeDefinition {
  id: AppThemeId;
  label: string;
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
  matcha: {
    id: 'matcha',
    label: 'Matcha',
    mode: 'light',
    palette: {
      '50': '244 249 238',
      '100': '230 242 219',
      '200': '208 229 188',
      '300': '179 212 149',
      '400': '146 188 107',
      '500': '114 161 72',
      '600': '81 127 38',
      '700': '64 107 27',
      '800': '51 89 22',
      '900': '39 71 18',
      '950': '23 45 10',
    },
    preview: ['242 250 233', '114 161 72', '64 107 27'],
    background: {
      start: '242 250 233',
      mid: '252 254 250',
      end: '223 247 229',
      glow: '146 188 107',
      glowSecondary: '204 183 102',
      foreground: '26 35 13',
    },
  },
  peach: {
    id: 'peach',
    label: 'Peach',
    mode: 'light',
    palette: {
      '50': '254 244 240',
      '100': '255 231 221',
      '200': '255 209 190',
      '300': '255 178 148',
      '400': '243 141 102',
      '500': '219 108 66',
      '600': '181 74 31',
      '700': '155 58 21',
      '800': '129 47 18',
      '900': '104 37 15',
      '950': '68 22 8',
    },
    preview: ['254 244 240', '219 108 66', '155 58 21'],
    background: {
      start: '254 244 240',
      mid: '254 253 253',
      end: '255 237 218',
      glow: '243 141 102',
      glowSecondary: '250 150 159',
      foreground: '47 25 15',
    },
  },
  terracotta: {
    id: 'terracotta',
    label: 'Terracotta',
    mode: 'light',
    palette: {
      '50': '255 244 241',
      '100': '255 231 224',
      '200': '254 209 196',
      '300': '248 180 162',
      '400': '232 147 125',
      '500': '207 116 93',
      '600': '170 83 62',
      '700': '145 67 49',
      '800': '121 54 41',
      '900': '97 43 32',
      '950': '63 26 19',
    },
    preview: ['254 245 238', '207 116 93', '145 67 49'],
    background: {
      start: '254 245 238',
      mid: '255 253 251',
      end: '249 239 219',
      glow: '232 147 125',
      glowSecondary: '223 173 114',
      foreground: '45 26 10',
    },
  },
  seafoam: {
    id: 'seafoam',
    label: 'Seafoam',
    mode: 'light',
    palette: {
      '50': '238 250 246',
      '100': '219 243 235',
      '200': '187 232 218',
      '300': '144 216 197',
      '400': '94 193 171',
      '500': '42 166 145',
      '600': '7 130 113',
      '700': '7 109 96',
      '800': '4 90 80',
      '900': '3 72 64',
      '950': '1 46 41',
    },
    preview: ['233 252 245', '42 166 145', '7 109 96'],
    background: {
      start: '233 252 245',
      mid: '250 255 253',
      end: '217 247 247',
      glow: '94 193 171',
      glowSecondary: '109 200 210',
      foreground: '6 37 29',
    },
  },
  lilacmist: {
    id: 'lilacmist',
    label: 'Lilac Mist',
    mode: 'light',
    palette: {
      '50': '249 245 255',
      '100': '241 232 254',
      '200': '227 212 251',
      '300': '209 187 245',
      '400': '184 156 230',
      '500': '156 127 207',
      '600': '122 94 172',
      '700': '102 78 147',
      '800': '83 64 123',
      '900': '65 51 99',
      '950': '41 32 64',
    },
    preview: ['249 245 255', '156 127 207', '102 78 147'],
    background: {
      start: '249 245 255',
      mid: '253 253 254',
      end: '252 234 249',
      glow: '184 156 230',
      glowSecondary: '219 161 213',
      foreground: '36 26 46',
    },
  },
  nebula: {
    id: 'nebula',
    label: 'Nebula',
    mode: 'dark',
    palette: {
      '50': '248 245 254',
      '100': '239 233 254',
      '200': '222 214 254',
      '300': '201 189 255',
      '400': '172 156 254',
      '500': '141 119 254',
      '600': '106 84 221',
      '700': '84 69 192',
      '800': '65 58 160',
      '900': '48 47 130',
      '950': '26 30 86',
    },
    preview: ['18 15 43', '141 119 254', '201 189 255'],
    background: {
      start: '8 5 28',
      mid: '18 15 43',
      end: '36 19 53',
      glow: '172 156 254',
      glowSecondary: '7 208 216',
      foreground: '240 241 252',
    },
  },
  obsidiangold: {
    id: 'obsidiangold',
    label: 'Obsidian Gold',
    mode: 'dark',
    palette: {
      '50': '253 246 234',
      '100': '249 235 211',
      '200': '243 216 174',
      '300': '235 192 125',
      '400': '218 160 70',
      '500': '193 130 2',
      '600': '152 99 0',
      '700': '129 82 1',
      '800': '108 67 2',
      '900': '87 52 2',
      '950': '57 32 0',
    },
    preview: ['22 19 16', '193 130 2', '235 192 125'],
    background: {
      start: '11 9 6',
      mid: '22 19 16',
      end: '31 29 23',
      glow: '218 160 70',
      glowSecondary: '236 166 107',
      foreground: '249 240 231',
    },
  },
  deepsea: {
    id: 'deepsea',
    label: 'Deep Sea',
    mode: 'dark',
    palette: {
      '50': '237 249 254',
      '100': '213 243 254',
      '200': '174 231 249',
      '300': '119 215 241',
      '400': '34 192 222',
      '500': '3 162 185',
      '600': '1 126 142',
      '700': '7 106 117',
      '800': '5 88 95',
      '900': '0 70 75',
      '950': '0 45 47',
    },
    preview: ['0 22 35', '3 162 185', '119 215 241'],
    background: {
      start: '0 11 19',
      mid: '0 22 35',
      end: '7 29 56',
      glow: '34 192 222',
      glowSecondary: '87 207 186',
      foreground: '233 244 251',
    },
  },
  velvet: {
    id: 'velvet',
    label: 'Velvet',
    mode: 'dark',
    palette: {
      '50': '255 244 245',
      '100': '254 230 233',
      '200': '255 206 214',
      '300': '255 172 190',
      '400': '250 127 161',
      '500': '225 92 136',
      '600': '186 56 106',
      '700': '158 42 91',
      '800': '131 34 77',
      '900': '105 27 62',
      '950': '68 15 40',
    },
    preview: ['36 9 21', '225 92 136', '255 172 190'],
    background: {
      start: '22 2 10',
      mid: '36 9 21',
      end: '51 15 20',
      glow: '250 127 161',
      glowSecondary: '241 147 211',
      foreground: '251 238 242',
    },
  },
  mossstone: {
    id: 'mossstone',
    label: 'Moss & Stone',
    mode: 'dark',
    palette: {
      '50': '243 249 241',
      '100': '229 241 225',
      '200': '206 228 199',
      '300': '178 211 166',
      '400': '147 186 129',
      '500': '118 158 95',
      '600': '87 125 62',
      '700': '73 104 47',
      '800': '60 86 37',
      '900': '48 68 28',
      '950': '30 43 15',
    },
    preview: ['20 20 14', '118 158 95', '178 211 166'],
    background: {
      start: '9 10 5',
      mid: '20 20 14',
      end: '26 30 23',
      glow: '147 186 129',
      glowSecondary: '199 183 124',
      foreground: '242 243 232',
    },
  },
  contrastlight: {
    id: 'contrastlight',
    label: 'High Contrast Light',
    mode: 'light',
    palette: {
      '50': '245 249 254',
      '100': '231 239 254',
      '200': '200 220 254',
      '300': '155 190 255',
      '400': '93 148 255',
      '500': '44 107 231',
      '600': '14 78 200',
      '700': '1 58 168',
      '800': '0 45 135',
      '900': '0 32 103',
      '950': '0 16 63',
    },
    preview: ['255 255 255', '44 107 231', '1 58 168'],
    background: {
      start: '255 255 255',
      mid: '255 255 255',
      end: '250 250 250',
      glow: '93 148 255',
      glowSecondary: '145 183 254',
      foreground: '0 0 0',
    },
  },
  contrastdark: {
    id: 'contrastdark',
    label: 'High Contrast Dark',
    mode: 'dark',
    palette: {
      '50': '244 249 255',
      '100': '227 240 254',
      '200': '192 222 255',
      '300': '137 195 254',
      '400': '57 156 247',
      '500': '1 119 204',
      '600': '2 93 161',
      '700': '2 73 129',
      '800': '0 57 103',
      '900': '1 42 77',
      '950': '0 23 46',
    },
    preview: ['0 0 0', '1 119 204', '137 195 254'],
    background: {
      start: '0 0 0',
      mid: '0 0 0',
      end: '10 10 10',
      glow: '57 156 247',
      glowSecondary: '7 208 216',
      foreground: '255 255 255',
    },
  },
  springbloom: {
    id: 'springbloom',
    label: 'Spring Bloom',
    mode: 'light',
    palette: {
      '50': '255 243 248',
      '100': '254 229 239',
      '200': '253 205 223',
      '300': '248 175 201',
      '400': '232 140 172',
      '500': '207 108 141',
      '600': '171 75 106',
      '700': '146 60 86',
      '800': '122 49 68',
      '900': '98 38 52',
      '950': '64 23 31',
    },
    preview: ['241 251 233', '207 108 141', '146 60 86'],
    background: {
      start: '241 251 233',
      mid: '252 254 250',
      end: '223 248 230',
      glow: '232 140 172',
      glowSecondary: '161 197 125',
      foreground: '25 35 14',
    },
  },
  midsummer: {
    id: 'midsummer',
    label: 'Midsummer',
    mode: 'light',
    palette: {
      '50': '239 249 254',
      '100': '217 241 254',
      '200': '180 228 254',
      '300': '131 211 253',
      '400': '76 185 240',
      '500': '6 156 216',
      '600': '5 121 170',
      '700': '0 101 145',
      '800': '3 83 121',
      '900': '0 66 99',
      '950': '0 42 65',
    },
    preview: ['255 246 225', '6 156 216', '0 101 145'],
    background: {
      start: '255 246 225',
      mid: '255 253 249',
      end: '238 245 203',
      glow: '76 185 240',
      glowSecondary: '211 180 94',
      foreground: '39 30 6',
    },
  },
  harvest: {
    id: 'harvest',
    label: 'Harvest',
    mode: 'light',
    palette: {
      '50': '254 245 237',
      '100': '255 232 213',
      '200': '252 212 179',
      '300': '247 184 134',
      '400': '232 151 87',
      '500': '208 118 46',
      '600': '172 84 1',
      '700': '147 68 1',
      '800': '124 54 1',
      '900': '100 42 5',
      '950': '65 25 4',
    },
    preview: ['254 246 231', '208 118 46', '147 68 1'],
    background: {
      start: '254 246 231',
      mid: '254 253 251',
      end: '244 243 205',
      glow: '232 151 87',
      glowSecondary: '246 157 134',
      foreground: '41 29 7',
    },
  },
  autumnember: {
    id: 'autumnember',
    label: 'Autumn Ember',
    mode: 'dark',
    palette: {
      '50': '254 245 241',
      '100': '254 231 222',
      '200': '254 209 192',
      '300': '254 178 153',
      '400': '249 137 104',
      '500': '225 102 72',
      '600': '187 66 43',
      '700': '160 51 35',
      '800': '133 41 32',
      '900': '107 31 27',
      '950': '70 18 17',
    },
    preview: ['32 14 8', '225 102 72', '254 178 153'],
    background: {
      start: '19 5 2',
      mid: '32 14 8',
      end: '42 24 9',
      glow: '249 137 104',
      glowSecondary: '226 174 77',
      foreground: '251 239 234',
    },
  },
  winterfrost: {
    id: 'winterfrost',
    label: 'Winter Frost',
    mode: 'light',
    palette: {
      '50': '241 248 253',
      '100': '224 239 251',
      '200': '198 224 246',
      '300': '165 205 238',
      '400': '130 178 221',
      '500': '98 150 197',
      '600': '68 116 162',
      '700': '55 96 139',
      '800': '46 79 115',
      '900': '37 62 93',
      '950': '23 39 60',
    },
    preview: ['237 249 255', '98 150 197', '55 96 139'],
    background: {
      start: '237 249 255',
      mid: '252 254 254',
      end: '230 242 254',
      glow: '130 178 221',
      glowSecondary: '126 198 201',
      foreground: '5 35 45',
    },
  },
  midwinter: {
    id: 'midwinter',
    label: 'Midwinter Night',
    mode: 'dark',
    palette: {
      '50': '241 248 255',
      '100': '225 238 254',
      '200': '200 223 250',
      '300': '168 203 244',
      '400': '133 176 229',
      '500': '102 147 205',
      '600': '71 113 169',
      '700': '58 94 145',
      '800': '48 77 120',
      '900': '39 61 97',
      '950': '24 38 63',
    },
    preview: ['5 20 39', '102 147 205', '168 203 244'],
    background: {
      start: '1 9 25',
      mid: '5 20 39',
      end: '22 26 53',
      glow: '133 176 229',
      glowSecondary: '119 200 195',
      foreground: '235 243 252',
    },
  },
  spooky: {
    id: 'spooky',
    label: 'Spooky',
    mode: 'dark',
    palette: {
      '50': '254 245 239',
      '100': '255 232 219',
      '200': '255 210 185',
      '300': '254 179 139',
      '400': '249 139 78',
      '500': '225 105 29',
      '600': '180 76 3',
      '700': '153 61 2',
      '800': '129 48 0',
      '900': '104 37 1',
      '950': '69 21 0',
    },
    preview: ['23 14 38', '225 105 29', '254 179 139'],
    background: {
      start: '12 5 25',
      mid: '23 14 38',
      end: '41 18 46',
      glow: '249 139 78',
      glowSecondary: '135 205 119',
      foreground: '243 240 251',
    },
  },
  festive: {
    id: 'festive',
    label: 'Festive',
    mode: 'dark',
    palette: {
      '50': '255 244 243',
      '100': '255 230 228',
      '200': '254 207 203',
      '300': '255 175 170',
      '400': '255 129 126',
      '500': '234 89 91',
      '600': '195 51 61',
      '700': '167 36 49',
      '800': '139 29 40',
      '900': '112 22 32',
      '950': '73 12 19',
    },
    preview: ['1 25 11', '234 89 91', '255 175 170'],
    background: {
      start: '0 13 4',
      mid: '1 25 11',
      end: '1 35 28',
      glow: '255 129 126',
      glowSecondary: '212 182 53',
      foreground: '234 245 237',
    },
  },
  blossom: {
    id: 'blossom',
    label: 'Blossom',
    mode: 'light',
    palette: {
      '50': '255 250 252',
      '100': '254 240 246',
      '200': '253 224 235',
      '300': '251 207 232',
      '400': '249 168 212',
      '500': '244 114 182',
      '600': '236 72 153',
      '700': '219 39 119',
      '800': '190 24 93',
      '900': '157 23 77',
      '950': '131 24 67',
    },
    preview: ['255 250 252', '244 114 182', '219 39 119'],
    background: {
      start: '255 250 252',
      mid: '255 255 255',
      end: '253 224 235',
      glow: '244 114 182',
      glowSecondary: '251 207 232',
      foreground: '80 7 36',
    },
  },
  neonwave: {
    id: 'neonwave',
    label: 'Neon Wave',
    mode: 'dark',
    palette: {
      '50': '245 255 252',
      '100': '207 250 254',
      '200': '129 230 217',
      '300': '34 211 238',
      '400': '59 130 246',
      '500': '168 85 247',
      '600': '236 72 153',
      '700': '251 191 36',
      '800': '255 0 110',
      '900': '0 255 164',
      '950': '0 0 0',
    },
    preview: ['0 0 0', '59 130 246', '251 191 36'],
    background: {
      start: '0 0 0',
      mid: '34 34 59',
      end: '34 211 238',
      glow: '59 130 246',
      glowSecondary: '251 191 36',
      foreground: '245 255 252',
    },
  },
  forest: {
    id: 'forest',
    label: 'Forest',
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
      '800': '34 49 34',
      '900': '17 34 17',
      '950': '8 17 8',
    },
    preview: ['8 17 8', '52 211 153', '16 185 129'],
    background: {
      start: '8 17 8',
      mid: '17 34 17',
      end: '34 49 34',
      glow: '52 211 153',
      glowSecondary: '110 231 183',
      foreground: '209 250 229',
    },
  },
  sandstone: {
    id: 'sandstone',
    label: 'Sandstone',
    mode: 'light',
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
    preview: ['255 251 235', '245 158 11', '180 83 9'],
    background: {
      start: '255 251 235',
      mid: '254 243 199',
      end: '253 230 138',
      glow: '251 191 36',
      glowSecondary: '252 211 77',
      foreground: '120 53 15',
    },
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic',
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
      mid: '224 242 254',
      end: '186 230 253',
      glow: '56 189 248',
      glowSecondary: '125 211 252',
      foreground: '12 74 110',
    },
  },
  coralreef: {
    id: 'coralreef',
    label: 'Coral Reef',
    mode: 'light',
    palette: {
      '50': '255 251 250',
      '100': '255 237 213',
      '200': '254 215 170',
      '300': '253 186 116',
      '400': '251 146 60',
      '500': '244 63 94',
      '600': '236 72 153',
      '700': '190 24 93',
      '800': '59 130 246',
      '900': '34 211 238',
      '950': '6 182 212',
    },
    preview: ['255 251 250', '244 63 94', '34 211 238'],
    background: {
      start: '255 251 250',
      mid: '254 215 170',
      end: '251 146 60',
      glow: '244 63 94',
      glowSecondary: '34 211 238',
      foreground: '59 130 246',
    },
  },
  mocha: {
    id: 'mocha',
    label: 'Mocha',
    mode: 'dark',
    palette: {
      '50': '245 222 179',
      '100': '222 184 135',
      '200': '210 180 140',
      '300': '188 143 143',
      '400': '160 82 45',
      '500': '139 69 19',
      '600': '101 67 33',
      '700': '70 44 20',
      '800': '44 34 30',
      '900': '25 20 20',
      '950': '15 10 10',
    },
    preview: ['15 10 10', '160 82 45', '139 69 19'],
    background: {
      start: '25 20 20',
      mid: '44 34 30',
      end: '70 44 20',
      glow: '160 82 45',
      glowSecondary: '188 143 143',
      foreground: '245 222 179',
    },
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset',
    mode: 'dark',
    palette: {
      '50': '255 244 229',
      '100': '255 224 178',
      '200': '255 204 128',
      '300': '255 183 77',
      '400': '255 167 38',
      '500': '255 152 0',
      '600': '251 140 0',
      '700': '245 124 0',
      '800': '239 108 0',
      '900': '230 81 0',
      '950': '191 54 12',
    },
    preview: ['255 244 229', '255 152 0', '230 81 0'],
    background: {
      start: '51 27 0',
      mid: '191 54 12',
      end: '255 152 0',
      glow: '255 167 38',
      glowSecondary: '255 204 128',
      foreground: '255 244 229',
    },
  },
  sunrise: {
    id: 'sunrise',
    label: 'Sunrise',
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
  THEME_DEFINITIONS.blossom,
  THEME_DEFINITIONS.sandstone,
  THEME_DEFINITIONS.arctic,
  THEME_DEFINITIONS.coralreef,
  THEME_DEFINITIONS.matcha,
  THEME_DEFINITIONS.peach,
  THEME_DEFINITIONS.terracotta,
  THEME_DEFINITIONS.seafoam,
  THEME_DEFINITIONS.lilacmist,
  THEME_DEFINITIONS.contrastlight,
] as const;


export const DARK_THEMES = [
  THEME_DEFINITIONS.midnight,
  THEME_DEFINITIONS.ocean,
  THEME_DEFINITIONS.ember,
  THEME_DEFINITIONS.aurora,
  THEME_DEFINITIONS.graphite,
  THEME_DEFINITIONS.mulberry,
  THEME_DEFINITIONS.neonwave,
  THEME_DEFINITIONS.forest,
  THEME_DEFINITIONS.mocha,
  THEME_DEFINITIONS.sunset,
  THEME_DEFINITIONS.nebula,
  THEME_DEFINITIONS.obsidiangold,
  THEME_DEFINITIONS.deepsea,
  THEME_DEFINITIONS.velvet,
  THEME_DEFINITIONS.mossstone,
  THEME_DEFINITIONS.contrastdark,
] as const;

// Picked by hand like any other theme (no automatic switching). Each still
// has a light/dark mode, so it can be a Follow System pairing.
export const SEASONAL_THEMES = [
  THEME_DEFINITIONS.springbloom,
  THEME_DEFINITIONS.midsummer,
  THEME_DEFINITIONS.harvest,
  THEME_DEFINITIONS.autumnember,
  THEME_DEFINITIONS.spooky,
  THEME_DEFINITIONS.winterfrost,
  THEME_DEFINITIONS.midwinter,
  THEME_DEFINITIONS.festive,
] as const;

export type ThemeGroupId = 'light' | 'dark' | 'seasonal';

export const THEME_GROUPS: ReadonlyArray<{ id: ThemeGroupId; label: string; themes: ReadonlyArray<ThemeDefinition> }> = [
  { id: 'light', label: 'Light', themes: LIGHT_THEMES },
  { id: 'dark', label: 'Dark', themes: DARK_THEMES },
  { id: 'seasonal', label: 'Seasonal', themes: SEASONAL_THEMES },
];

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

// ─── Background pattern & gradient ───────────────────────────────────────────

// Allowed values come from the shared appearance spec (also validated by the
// server); the option lists below add labels and previews.
export type BgPatternId = Appearance['bgPattern'];
export type BgGradientId = Appearance['bgGradient'];

export const DEFAULT_BG_PATTERN: BgPatternId = DEFAULT_APPEARANCE.bgPattern;
export const DEFAULT_BG_GRADIENT: BgGradientId = DEFAULT_APPEARANCE.bgGradient;

export interface BgPatternOption {
  id: BgPatternId;
  label: string;
  /** Shown under the label (only patterns that need explaining). */
  description?: string;
  // Preview style uses hardcoded colors (not CSS vars) for small swatches in Settings
  previewStyle: {
    backgroundImage: string;
    backgroundSize?: string;
  };
}

export interface BgGradientOption {
  id: BgGradientId;
  label: string;
  description: string;
}

export const BG_PATTERN_OPTIONS: BgPatternOption[] = [
  {
    id: 'dots',
    label: 'Dots',
    previewStyle: {
      backgroundImage: [
        'radial-gradient(circle, rgba(0,0,0,0.18) 0.8px, transparent 0.8px)',
        'radial-gradient(circle, rgba(0,0,0,0.1) 0.55px, transparent 0.55px)',
      ].join(', '),
      backgroundSize: '8px 8px, 5px 5px',
    },
  },
  {
    id: 'grid',
    label: 'Grid',
    previewStyle: {
      backgroundImage: [
        'linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: '14px 14px, 14px 14px',
    },
  },
  {
    id: 'crosshatch',
    label: 'Crosshatch',
    previewStyle: {
      backgroundImage: [
        'repeating-linear-gradient(45deg, transparent 0px, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 6px)',
        'repeating-linear-gradient(-45deg, transparent 0px, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 6px)',
      ].join(', '),
    },
  },
  {
    id: 'topographic',
    label: 'Topographic',
    previewStyle: {
      backgroundImage: [
        'radial-gradient(circle, rgba(0,0,0,0.2) 1.5px, transparent 1.5px)',
        'radial-gradient(circle, rgba(0,0,0,0.08) 0.8px, transparent 0.8px)',
      ].join(', '),
      backgroundSize: '20px 20px, 10px 10px',
    },
  },
  {
    id: 'linen',
    label: 'Linen',
    previewStyle: {
      backgroundImage: [
        'repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(0,0,0,0.09) 3px, rgba(0,0,0,0.09) 4px)',
        'repeating-linear-gradient(90deg, transparent 0px, transparent 12px, rgba(0,0,0,0.03) 12px, rgba(0,0,0,0.03) 13px)',
      ].join(', '),
    },
  },
  {
    id: 'waves',
    label: 'Waves',
    previewStyle: {
      backgroundImage: [
        'radial-gradient(circle at 50% 100%, transparent 6px, rgba(0,0,0,0.16) 7px, transparent 8px)',
        'radial-gradient(circle at 0% 0%, transparent 6px, rgba(0,0,0,0.16) 7px, transparent 8px)',
        'radial-gradient(circle at 100% 0%, transparent 6px, rgba(0,0,0,0.16) 7px, transparent 8px)',
      ].join(', '),
      backgroundSize: '16px 8px, 16px 8px, 16px 8px',
    },
  },
  {
    id: 'hexagons',
    label: 'Hexagons',
    previewStyle: {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cpath fill='none' stroke='%23000' stroke-opacity='0.18' d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E")`,
      backgroundSize: '14px 24.5px',
    },
  },
  {
    id: 'terrazzo',
    label: 'Terrazzo',
    previewStyle: {
      backgroundImage: [
        'radial-gradient(ellipse 2.5px 1.5px at 20% 30%, rgba(251,146,60,0.6) 98%, transparent)',
        'radial-gradient(ellipse 1.5px 2.5px at 70% 60%, rgba(252,211,77,0.7) 98%, transparent)',
        'radial-gradient(circle 1.2px at 45% 80%, rgba(0,0,0,0.3) 98%, transparent)',
      ].join(', '),
      backgroundSize: '29px 27px, 21px 25px, 16px 18px',
    },
  },
  {
    id: 'grain',
    label: 'Paper Grain',
    previewStyle: {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0.2 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      backgroundSize: '140px 140px',
    },
  },
  {
    id: 'plaid',
    label: 'Plaid',
    previewStyle: {
      backgroundImage: [
        'repeating-linear-gradient(0deg, transparent 0 8px, rgba(251,146,60,0.18) 8px 11px, transparent 11px 18px)',
        'repeating-linear-gradient(90deg, transparent 0 8px, rgba(251,146,60,0.18) 8px 11px, transparent 11px 18px)',
      ].join(', '),
    },
  },
  {
    id: 'pinstripe',
    label: 'Pinstripe',
    previewStyle: {
      backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, rgba(0,0,0,0.12) 5px 6px)',
    },
  },
  {
    id: 'stars',
    label: 'Stars',
    previewStyle: {
      backgroundImage: [
        'radial-gradient(circle 0.8px at 20% 30%, rgba(0,0,0,0.45) 98%, transparent)',
        'radial-gradient(circle 1.2px at 70% 65%, rgba(251,146,60,0.7) 98%, transparent)',
        'radial-gradient(circle 0.6px at 45% 10%, rgba(0,0,0,0.35) 98%, transparent)',
      ].join(', '),
      backgroundSize: '27px 25px, 41px 37px, 17px 19px',
    },
  },
  {
    id: 'myplaces',
    label: 'My Places',
    description: 'Your most-visited spots, joined in the order you went',
    previewStyle: {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Cpath d='M8 30L26 12L44 22L63 8L84 26L104 14' fill='none' stroke='%23000' stroke-opacity='0.25'/%3E%3Cg fill='rgb(234,88,12)' fill-opacity='0.7'%3E%3Ccircle cx='8' cy='30' r='2'/%3E%3Ccircle cx='26' cy='12' r='3.2'/%3E%3Ccircle cx='44' cy='22' r='2.2'/%3E%3Ccircle cx='63' cy='8' r='4'/%3E%3Ccircle cx='84' cy='26' r='2.6'/%3E%3Ccircle cx='104' cy='14' r='2'/%3E%3C/g%3E%3C/svg%3E")`,
      backgroundSize: 'cover',
    },
  },
  {
    id: 'streets',
    label: 'Streets',
    description: 'The roads around your home area, from OpenStreetMap',
    previewStyle: {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='0.3' stroke-linecap='round'%3E%3Cpath stroke-width='2.5' d='M0 24C30 20 60 30 120 18'/%3E%3Cpath stroke-width='1.2' d='M20 0L28 40M56 0L50 40M88 0L96 40M0 8L120 6M0 36L120 33'/%3E%3C/g%3E%3C/svg%3E")`,
      backgroundSize: 'cover',
    },
  },
  {
    id: 'none',
    label: 'None',
    previewStyle: { backgroundImage: 'none' },
  },
];

export type BgMotionId = Appearance['bgMotion'];

export const BG_MOTION_OPTIONS: { id: BgMotionId; label: string; description: string }[] = [
  { id: 'none', label: 'Still', description: 'No animation' },
  { id: 'aurora', label: 'Aurora', description: 'Slow drifting bands of light' },
  { id: 'starfield', label: 'Starfield', description: 'Twinkling stars drifting by' },
  { id: 'bokeh', label: 'Bokeh', description: 'Soft out-of-focus lights' },
  { id: 'grain', label: 'Film Grain', description: 'Flickering analog texture' },
];

export const BG_GRADIENT_OPTIONS: BgGradientOption[] = [
  { id: 'soft', label: 'Soft', description: 'Diagonal wash with corner bloom' },
  { id: 'radial', label: 'Radial', description: 'Top-centered light source' },
  { id: 'flat', label: 'Flat', description: 'Subtle edge tints only' },
];

// Fixed preview gradients for Settings UI (warm neutral tones, no CSS vars)
export const BG_GRADIENT_PREVIEWS: Record<BgGradientId, string> = {
  soft: [
    'radial-gradient(circle at 5% 10%, rgba(251,146,60,0.28), transparent 55%)',
    'linear-gradient(135deg, rgb(255,247,237), rgb(255,255,255) 48%, rgb(255,251,235))',
  ].join(', '),
  radial: [
    'radial-gradient(ellipse 110% 70% at 50% 0%, rgba(251,146,60,0.3), transparent)',
    'radial-gradient(ellipse 70% 50% at 90% 95%, rgba(252,211,77,0.15), transparent)',
    'radial-gradient(circle at 50% 40%, rgb(255,247,237), rgb(255,255,255) 55%, rgb(255,251,235))',
  ].join(', '),
  flat: 'linear-gradient(175deg, rgb(255,247,237), rgb(255,255,255) 40%, rgb(255,251,235))',
};

/** Numeric knobs become CSS variables on <html> (value → CSS value). */
export const APPEARANCE_CSS_VARS: Record<AppearanceRangeKey, { name: string; format: (value: number) => string }> = {
  wallpaperBlur: { name: '--app-wallpaper-blur', format: (v) => `${v}px` },
  wallpaperDim: { name: '--app-wallpaper-dim', format: (v) => String(v / 100) },
};

/**
 * Expose appearance knobs on <html> for index.css: list knobs as data
 * attributes (bgPattern → data-bg-pattern), numeric ones as CSS variables.
 * The pre-paint script in index.html restores both from the theme snapshot
 * (attributes from `attrs`, variables as part of the inline style).
 */
export function applyAppearanceToRoot(root: HTMLElement, appearance: Appearance) {
  for (const key of APPEARANCE_ENUM_KEYS) {
    root.dataset[key] = String(appearance[key]);
  }
  for (const [key, cssVar] of Object.entries(APPEARANCE_CSS_VARS) as [AppearanceRangeKey, { name: string; format: (v: number) => string }][]) {
    root.style.setProperty(cssVar.name, cssVar.format(appearance[key]));
  }
}

/** The data-* attributes applyAppearanceToRoot manages, for the snapshot. */
export function readAppearanceAttrs(root: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of APPEARANCE_ENUM_KEYS) {
    const value = root.dataset[key];
    if (value) attrs[key] = value;
  }
  return attrs;
}

/** Hue in degrees (0–360) of an "r g b" color string. */
export function rgbHue(rgb: string): number {
  const [r, g, b] = rgb.split(' ').map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
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
  // Theme-tinted map tiles: sepia (hue ≈ 35°) rotated to the glow's hue.
  root.style.setProperty('--app-map-hue', `${Math.round(rgbHue(theme.background.glow) - 35)}deg`);
}