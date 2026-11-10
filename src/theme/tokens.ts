/**
 * Design tokens ported from Cherry Studio's mobile app.
 *
 * Source of truth: cherry-studio-app/packages/design-tokens/src/styles/{native.css,tokens/colors/vercel.css}
 * (Vercel Brand Guidelines / Geist palette), parsed and converted from `oklch()` to
 * sRGB because React Native's color parser does not accept oklch().
 *
 * Do not re-tune these values by eye: they are the ones the reference app renders.
 * If Cherry changes a token, re-run the conversion rather than guessing a neighbour.
 */

export type ThemeColors = { [K in keyof typeof light]: string };

/** Light theme: the app's default surface is #f5f5f5, cards float white on it. */
export const light = {
  background: '#f5f5f5',
  'background-subtle': '#fafafa',
  foreground: '#171717',
  'foreground-tertiary': '#7d7d7d',
  'foreground-disabled': '#7d7d7d',
  card: '#ffffff',
  'card-foreground': '#171717',
  popover: '#ffffff',
  'popover-foreground': '#171717',
  primary: '#107d32',
  'primary-foreground': '#ffffff',
  secondary: 'rgba(0,0,0,0.050)',
  'secondary-foreground': '#171717',
  muted: 'rgba(0,0,0,0.050)',
  'muted-foreground': '#4d4d4d',
  accent: 'rgba(0,0,0,0.050)',
  'accent-foreground': '#171717',
  destructive: '#fc0035',
  'destructive-foreground': '#ffffff',
  border: 'rgba(0,0,0,0.081)',
  'border-subtle': 'rgba(0,0,0,0.050)',
  'border-strong': 'rgba(0,0,0,0.210)',
  input: 'rgba(0,0,0,0.081)',
  ring: 'rgba(16,125,50,0.400)',
  sidebar: '#fafafa',
  'sidebar-foreground': '#171717',
  'sidebar-accent': '#f2f2f2',
  'sidebar-accent-foreground': '#171717',
  'sidebar-border': 'rgba(0,0,0,0.081)',
  'sidebar-primary': '#171717',
  'sidebar-primary-foreground': '#ffffff',
  'chat-user': 'rgba(0,0,0,0.050)',
  'chat-background': '#f9f9f9',
  brand: '#ff5757',
  'code-block': '#f2f2f2',
  'inline-code': 'rgba(0,0,0,0.050)',
  success: '#107d32',
  warning: '#aa4d00',
  error: '#fc0035',
  info: '#006bff',
  link: '#005ff2',
  scrim: 'rgba(0,0,0,0.400)',
} as const;

/** Dark theme: page background is pure black, cards lift to #1a1a1a. */
export const dark: ThemeColors = {
  background: '#000000',
  'background-subtle': '#000000',
  foreground: '#ededed',
  'foreground-tertiary': '#7d7d7d',
  'foreground-disabled': '#7d7d7d',
  card: '#1a1a1a',
  'card-foreground': '#ededed',
  popover: '#1a1a1a',
  'popover-foreground': '#ededed',
  primary: '#00ca50',
  'primary-foreground': '#000000',
  secondary: 'rgba(255,255,255,0.070)',
  'secondary-foreground': '#ededed',
  muted: 'rgba(255,255,255,0.070)',
  'muted-foreground': '#a0a0a0',
  accent: 'rgba(255,255,255,0.070)',
  'accent-foreground': '#ededed',
  destructive: '#f13242',
  'destructive-foreground': '#ffffff',
  border: 'rgba(255,255,255,0.090)',
  'border-subtle': 'rgba(255,255,255,0.070)',
  'border-strong': 'rgba(255,255,255,0.240)',
  input: 'rgba(255,255,255,0.090)',
  ring: 'rgba(0,202,80,0.400)',
  sidebar: '#1a1a1a',
  'sidebar-foreground': '#ededed',
  'sidebar-accent': '#1f1f1f',
  'sidebar-accent-foreground': '#ededed',
  'sidebar-border': 'rgba(255,255,255,0.090)',
  'sidebar-primary': '#ededed',
  'sidebar-primary-foreground': '#000000',
  'chat-user': 'rgba(255,255,255,0.070)',
  'chat-background': '#000000',
  brand: '#ff5757',
  'code-block': '#1a1a1a',
  'inline-code': 'rgba(255,255,255,0.070)',
  success: '#00ca50',
  warning: '#ff9300',
  error: '#f13242',
  info: '#006efe',
  link: '#47a8ff',
  scrim: 'rgba(0,0,0,0.400)',
};

/**
 * Type scale in Cherry's "accessibility step 0" snapshot
 * (cherry-studio-app/src/frontend/styles/global.css `@theme static`).
 */
export const fontSize = {
  xs: { size: 13, lineHeight: 18 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 26 },
  '2xl': { size: 24, lineHeight: 32 },
  '3xl': { size: 32, lineHeight: 40 },
} as const;

/** Tailwind v4 radii derived from `--radius: 0.5rem` (8pt base). */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  /** The user-message bubble is authored as an arbitrary 18pt, not on the scale. */
  bubble: 18,
  full: 9999,
} as const;

/** Sidebar geometry (cherry-studio-app/src/frontend/utils/constants.ts `appSidebar`). */
export const sidebarMetrics = {
  maxWidth: 400,
  /** Chat strip left visible beside the open drawer; tap it to close. */
  sceneRevealWidth: 64,
  /** Finger travel before the open/close swipe commits. */
  swipeActivationDistance: 20,
  dockHeight: 44,
  dockMinInset: 16,
  headerRowHeight: 40,
  headerGapY: 8,
  recentSessionLimit: 10,
} as const;

/** Message list (cherry-studio-app/src/frontend/components/Message/list/messageListLayout.ts). */
export const messageMetrics = {
  listTopPadding: 12,
  /** User bubble: 88% width, 18pt radius, 16/10 padding. */
  userBubbleMaxWidth: '88%',
  userBubblePaddingX: 16,
  userBubblePaddingY: 10,
} as const;