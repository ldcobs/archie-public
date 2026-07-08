// Design token layer — single source of truth for all visual values.
// CSS variables in globals.css are derived from these constants.
// Components should reference CSS vars at runtime; use these constants
// only when CSS vars are not available (e.g. SVG fill, canvas).

export const color = {
  // Backgrounds
  bg:           '#080c10',
  surface:      '#0d1117',
  surfaceHover: 'rgba(255,255,255,0.025)',
  surfaceActive:'rgba(0,212,255,0.04)',

  // Borders
  border:       '#1a2332',
  borderSubtle: 'rgba(255,255,255,0.06)',

  // Brand / accent
  accent:       '#00d4ff',
  accentDim:    'rgba(0,212,255,0.15)',
  accentGlow:   'rgba(0,212,255,0.30)',

  // Semantic
  green:        '#39d353',
  greenDim:     'rgba(57,211,83,0.12)',
  greenGlow:    'rgba(57,211,83,0.30)',

  red:          '#ff4444',
  redDim:       'rgba(255,68,68,0.12)',

  yellow:       '#f0e050',
  yellowDim:    'rgba(240,224,80,0.12)',

  amber:        '#f0a500',
  amberDim:     'rgba(240,165,0,0.12)',

  purple:       '#bd93f9',
  purpleDim:    'rgba(189,147,249,0.12)',

  // Text
  text:         '#c9d1d9',
  textBright:   '#dce8f7',
  textDim:      'rgba(180,195,215,0.50)',
  textFaint:    'rgba(180,195,215,0.25)',
  muted:        '#4a5568',
} as const;

export const radius = {
  xs:  3,
  sm:  4,
  md:  6,
  lg:  8,
  xl:  10,
  xxl: 14,
} as const;

export const space = {
  1:  4,
  2:  8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
} as const;

export const font = {
  size: {
    xxs:  8,
    xs:   9,
    sm:  10,
    md:  11,
    base:12,
    lg:  13,
    xl:  14,
  },
  weight: {
    normal:  400,
    medium:  500,
    semibold:600,
    bold:    700,
    black:   800,
  },
} as const;

// ── Theme types (shared, no React dependency) ────────────────────────────────
// The ThemeProvider/useTheme hook lives in theme-client.tsx to keep this file
// importable from Node server routes (e.g. api/backup/route.ts) which only need
// the design tokens above.

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'archie-theme';
