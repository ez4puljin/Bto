// Bto's design tokens for the phone: the web's values from apps/web/src/index.css (ADR-0042,
// docs/ui.md §1) and the rep app's design boards (ADR-0066), light theme only. Screens use these
// names, never colour literals.
export const colors = {
  canvas: '#F2F2F7',
  card: '#FFFFFF',
  foreground: '#1D1D1F',
  muted: '#6E6E73',
  /** Secondary text on a grey chip. */
  label2: '#3A3A3C',
  primary: '#0071E3',
  primaryPressed: '#0066CC',
  primaryForeground: '#FFFFFF',
  link: '#0066CC',
  secondary: '#E8F0FB',
  secondaryForeground: '#0066CC',
  accent: '#F0F0F5',
  fill: '#E8E8ED',
  border: '#E5E5EA',
  input: '#C7C7CC',
  success: '#1E7B34',
  successSoft: '#E3F5E7',
  warning: '#B25000',
  warningSoft: '#FFF1DE',
  /** Text on the orange note under a quantity beyond the stock. */
  warningText: '#8A3F00',
  /** A promotion notice's eyebrow on its warm picture. */
  promoText: '#B4400B',
  destructive: '#D70015',
  destructiveSoft: '#FDE7E8',
  infoSoft: '#E8F0FB',
  violet: '#4B3FC9',
  violetSoft: '#EFEDFD',
  cancelled: '#C00012',
  /** The search field, segmented controls and the stepper's track. */
  fieldFill: 'rgba(118,118,128,0.12)',
  /** The switch's track when off. */
  switchOff: 'rgba(120,120,128,0.16)',
  /** A sheet's round close button. */
  closeFill: 'rgba(118,118,128,0.14)',
  /** Behind a product picture. */
  imageFill: '#F5F5F7',
  /** A dot of a pager that is not the current page. */
  dotIdle: '#D1D1D6',
  /** The tinted range of a calendar. */
  rangeFill: 'rgba(0,113,227,0.12)',
  /** The quantity keypad: its bar and the tray under the keys. */
  keypadBar: '#F6F6F8',
  keypadTray: '#D1D4DA',
  backdrop: 'rgba(0,0,0,0.32)',
  /** Behind the «sent» card. */
  dimFill: 'rgba(0,0,0,0.25)',
  popupBackdrop: 'rgba(0,0,0,0.45)',
  /** Bars over content: no blur on Android, so nearly opaque. */
  barFill: 'rgba(255,255,255,0.96)',
  sheetBarFill: 'rgba(242,242,247,0.96)',
  floatingFill: 'rgba(255,255,255,0.92)',
  /** A round button over a picture. */
  glassFill: 'rgba(255,255,255,0.86)',
  /** Placeholders of text fields. */
  placeholder: '#8E8E93',
  /** A text field's box (solid, so its idle border can match it). */
  field: '#EFEFF0',
  /** Text and lines on the blue month card. */
  onPrimaryMuted: 'rgba(255,255,255,0.72)',
  onPrimaryHairline: 'rgba(255,255,255,0.22)',
  /** Pager dots over a picture, on a dark capsule. */
  dotOnImage: '#FFFFFF',
  dotOnImageIdle: 'rgba(255,255,255,0.55)',
  pagerCapsule: 'rgba(0,0,0,0.24)',
  hairline: 'rgba(0,0,0,0.08)',
  hairlineSoft: 'rgba(0,0,0,0.06)',
  hairlineStrong: 'rgba(0,0,0,0.15)',
  /** The system tints of icon tiles, dots and avatars. */
  tint: {
    blue: '#0A84FF',
    indigo: '#5E5CE6',
    green: '#34C759',
    orange: '#FF9500',
    amber: '#FF9F0A',
    red: '#FF3B30',
    pink: '#FF2D55',
    rose: '#FF375F',
    teal: '#30B0C7',
    cyan: '#64D2FF',
    purple: '#BF5AF2',
    brown: '#AC8E68',
    gray: '#8E8E93',
  },
} as const;

/** Avatar colours in turn (a supplier's initial, ADR-0066). */
export const AVATAR_TINTS = [
  colors.tint.blue,
  colors.tint.teal,
  colors.tint.indigo,
  colors.tint.amber,
  colors.tint.green,
  colors.tint.rose,
  colors.tint.purple,
  colors.tint.brown,
  colors.tint.cyan,
] as const;

export const radii = {
  control: 10,
  field: 12,
  /** Inset grouped lists and cards. */
  card: 18,
  /** A product picture in the grid. */
  tile: 22,
  /** The product page's picture. */
  hero: 28,
  /** A sheet's top corners. */
  sheet: 30,
  /** A 30 px tinted icon square. */
  iconTile: 8,
  pill: 999,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Inter embedded at build time (expo-font plugin); Android names a face after its file. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/**
 * The type scale (the owner, 2026-10-17: «Text жоохон том»): the boards' iPhone sizes made about
 * 12–15% smaller for Inter on Android (rows 15, titles 28, notes 12), the phone's font scaling
 * capped at 1.15 by `src/ui/text.tsx`, and Android's extra font padding off. Every text size in
 * the app comes from here.
 */
const face = (
  family: string,
  fontSize: number,
  lineHeight: number,
  letterSpacing = 0,
  color: string = colors.foreground,
) =>
  ({
    fontFamily: family,
    fontSize,
    lineHeight,
    letterSpacing,
    color,
    includeFontPadding: false,
  }) as const;

export const type = {
  /** A notice's discount, «20%». */
  jumbo: face(fonts.bold, 56, 62, -1.5),
  /** The quantity typed on the keypad. */
  hero: face(fonts.bold, 40, 46, -1),
  /** The month's total on the home card. */
  display: face(fonts.bold, 32, 38, -0.8),
  largeTitle: face(fonts.bold, 28, 34, -0.5),
  title: face(fonts.bold, 24, 30, -0.4),
  title2: face(fonts.bold, 22, 28, -0.3),
  title3: face(fonts.bold, 19, 24, -0.2),
  /** «Bto» next to the logo. */
  wordmark: face(fonts.bold, 22, 26, -0.6),
  /** A section's title with a «Бүгд» link (the home's strips). */
  sectionTitle: face(fonts.bold, 17, 22, -0.2),
  heading: face(fonts.semibold, 16, 21, -0.1),
  row: face(fonts.regular, 15, 20, -0.1),
  rowStrong: face(fonts.semibold, 15, 20, -0.1),
  /** Text typed into a field. */
  field: face(fonts.regular, 16, 20),
  button: face(fonts.semibold, 16, 20, -0.1),
  body: face(fonts.regular, 14, 19),
  bodyStrong: face(fonts.semibold, 14, 19),
  chip: face(fonts.medium, 13, 18),
  /** A field's label above its box. */
  label: face(fonts.semibold, 13, 16, 0, colors.label2),
  secondary: face(fonts.regular, 12, 16, 0, colors.muted),
  sectionHeader: face(fonts.semibold, 12, 16, 0.1, colors.muted),
  caption: face(fonts.regular, 11, 14, 0.1, colors.muted),
  badge: face(fonts.bold, 10, 12, 0, colors.primaryForeground),
  tab: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12, includeFontPadding: false },
} as const;

/** Numbers that line up in columns (money, counts). */
export const tabular = { fontVariant: ['tabular-nums' as const] };

/** The boards' shadows (React Native's boxShadow, the New Architecture). */
export const shadows = {
  floating: '0 1px 2px rgba(0,0,0,0.05), 0 6px 18px rgba(0,0,0,0.08)',
  tabBar: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.10)',
  /** The logo tile. */
  brand: '0 6px 16px rgba(0,113,227,0.28)',
  /** The blue month card on the home. */
  accentCard: '0 6px 18px rgba(0,113,227,0.22)',
  /** A pager capsule over a picture. */
  capsule: '0 1px 3px rgba(0,0,0,0.18)',
  addButton: '0 2px 10px rgba(0,0,0,0.14)',
  segment: '0 3px 8px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)',
  stepper: '0 1px 3px rgba(0,0,0,0.1)',
  hero: '0 4px 14px rgba(0,0,0,0.1)',
  knob: '0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.06)',
  popup: '0 20px 60px rgba(0,0,0,0.25)',
  toast: '0 10px 30px rgba(0,0,0,0.14)',
  key: '0 1px 0 rgba(0,0,0,0.3)',
} as const;

export const TOUCH = 44;
