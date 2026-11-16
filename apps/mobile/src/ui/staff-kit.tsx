import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../theme/tokens';
import { Text } from './text';

// The pieces the staff app's boards of 2026-11-16 repeat on every screen: a white card, a tinted
// note, a status pill, a progress bar, a stat tile and the bar that holds a page's main button.

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad' | 'violet' | 'dark';

/** A tone's soft background and its text colour. */
export const TONES: Record<Tone, { background: string; text: string }> = {
  neutral: { background: colors.fill, text: colors.foreground },
  info: { background: colors.secondary, text: colors.link },
  ok: { background: colors.successSoft, text: colors.success },
  warn: { background: colors.warningSoft, text: colors.warning },
  bad: { background: colors.destructiveSoft, text: colors.destructive },
  violet: { background: colors.violetSoft, text: colors.violet },
  dark: { background: colors.blocked, text: colors.primaryForeground },
};

/** A white card on the canvas: radius 18, a faint shadow, 16 px inside (0 with `flush`). */
export function Card({
  children,
  flush = false,
  onPress,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  flush?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const base = [styles.card, flush && styles.flush, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [...base, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

/** A status pill: 24 px, a soft tone, an optional 13 px icon before the word. */
export function Pill({
  label,
  tone = 'neutral',
  icon: Icon,
  style,
}: {
  label: string;
  tone?: Tone;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }, style]}>
      {Icon ? <Icon size={13} strokeWidth={2.2} color={palette.text} /> : null}
      <Text style={[styles.pillText, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A tinted note with its icon: what a screen says about itself (a hint, a warning, a refusal). */
export function Notice({
  icon: Icon,
  tone = 'info',
  children,
  right,
  style,
}: {
  icon?: LucideIcon;
  tone?: Exclude<Tone, 'dark' | 'neutral'>;
  children: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = TONES[tone];
  // A warning's sentence is the darker `warningText`, as on the product page's note.
  const text =
    tone === 'warn' ? colors.warningText : tone === 'info' ? colors.foreground : palette.text;
  return (
    <View style={[styles.notice, { backgroundColor: palette.background }, style]}>
      {Icon ? (
        <Icon size={18} strokeWidth={2} color={palette.text} style={styles.noticeIcon} />
      ) : null}
      <Text style={[type.body, styles.noticeText, { color: text }]}>{children}</Text>
      {right}
    </View>
  );
}

/** An 8 px progress bar; `value` runs from 0 to 1. */
export function ProgressBar({
  value,
  color = colors.primary,
  style,
}: {
  value: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const share = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
      style={[styles.track, style]}
    >
      <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

/** One number over its caption in a small white tile; three sit in a row with `flex: 1`. */
export function StatTile({
  value,
  label,
  color,
  style,
}: {
  value: string;
  label: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.stat, style]}>
      <Text
        style={[styles.statValue, color ? { color } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={type.secondary} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** A row of stat tiles, 10 px apart. */
export function StatTiles({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.stats, style]}>{children}</View>;
}

/**
 * The bar under a page that holds its main button(s): nearly white, a hairline over it, 12 px
 * above and the phone's bottom inset below. It is the last child of the page, never absolute.
 */
export function FooterBar({
  children,
  column = false,
  style,
}: {
  children: ReactNode;
  /** Stack the children (a note over a button) instead of setting them side by side. */
  column?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        column && styles.footerColumn,
        { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The side padding and the gap between blocks of a staff page's scroll content. */
export const PAGE = { padding: spacing.lg, gap: spacing.lg } as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    boxShadow: shadows.card,
  },
  flush: { padding: 0, overflow: 'hidden' },
  pressed: { backgroundColor: colors.accent },
  pill: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: radii.field,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  noticeIcon: { marginTop: 0.5 },
  noticeText: { flex: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  statValue: { ...type.title3, ...tabular },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
  },
  footerColumn: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
});
