// Bto's design tokens for the phone (ADR-0042, docs/ui.md §1): the web's values from
// apps/web/src/index.css, light theme only. Screens use these names, never colour literals.
export const colors = {
  canvas: '#F2F2F7',
  card: '#FFFFFF',
  foreground: '#1D1D1F',
  muted: '#6E6E73',
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
  destructive: '#D70015',
  destructiveSoft: '#FDE7E8',
  infoSoft: '#E8F0FB',
} as const;

export const radii = { control: 10, card: 12, sheet: 16, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Inter embedded at build time (expo-font plugin); Android names a face after its file. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Phone sizes: body 15, secondary 13, captions 12, titles 28; touch targets at least 44. */
export const type = {
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.foreground },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.foreground },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.foreground },
  bodyStrong: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.foreground,
  },
  secondary: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: colors.muted },
} as const;

export const TOUCH = 44;
