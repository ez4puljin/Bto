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
  /** The open tab of the tab bar. */
  tabActive: 'rgba(118,118,128,0.13)',
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

/** The boards' type scale: 17 for rows, 13 for section headers and notes, 34 for page titles. */
export const type = {
  largeTitle: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: -0.6,
    color: colors.foreground,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    color: colors.foreground,
  },
  title2: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: colors.foreground,
  },
  title3: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.foreground },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.foreground },
  row: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 22, color: colors.foreground },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.foreground },
  bodyStrong: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.foreground,
  },
  secondary: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  sectionHeader: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  tab: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12 },
} as const;

/** The boards' shadows (React Native's boxShadow, the New Architecture). */
export const shadows = {
  floating: '0 1px 2px rgba(0,0,0,0.05), 0 6px 18px rgba(0,0,0,0.08)',
  tabBar: '0 10px 34px rgba(0,0,0,0.14)',
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
