import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { Text } from './text';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../theme/tokens';

/**
 * A page of the design (ADR-0066): the grey canvas, or white for the shop and a product; the safe
 * area at the top (the floating tab bar keeps the bottom).
 */
export function Page({
  children,
  white = false,
  edges = ['top'],
  style,
}: {
  children?: ReactNode;
  white?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.page, { backgroundColor: white ? colors.card : colors.canvas }, style]}
    >
      {children}
    </SafeAreaView>
  );
}

/** «‹ Профайл»: the accent chevron and the page it goes back to. */
export function BackLink({ label, onPress }: { label?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.back}
    >
      <ChevronLeft size={24} strokeWidth={2.4} color={colors.primary} />
      {label ? <Text style={[type.row, styles.backText]}>{label}</Text> : null}
    </Pressable>
  );
}

/** The 44 px bar over a page: «‹ Профайл» on the left, an action on the right. */
export function NavBar({
  back,
  onBack,
  title,
  right,
  style,
}: {
  back?: string;
  onBack?: () => void;
  title?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.barSide}>
        {onBack ? <BackLink {...(back ? { label: back } : {})} onPress={onBack} /> : null}
      </View>
      {title ? (
        <Text style={type.heading} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.barSide, styles.barRight]}>{right}</View>
    </View>
  );
}

/** A text button for a bar or a sheet's header: «Бүгдийг уншсан», «Болсон», «Цэвэрлэх». */
export function BarButton({
  title,
  onPress,
  disabled = false,
  strong = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.barButton}
    >
      <Text
        style={[
          type.row,
          { color: disabled ? colors.muted : colors.primary },
          strong && styles.strong,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function LargeTitle({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text accessibilityRole="header" style={[type.largeTitle, style]}>
      {children}
    </Text>
  );
}

/** «Бүртгэл», «Төлбөр»: 12 px, semibold, grey, over a group. */
export function SectionHeader({
  children,
  right,
  style,
}: {
  children: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      <Text accessibilityRole="header" style={[type.sectionHeader, styles.grow]}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A section's title in black with an optional link on the right: «Шинэ бараа … Бүгд». */
export function SectionTitle({
  children,
  action,
  onAction,
  style,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionTitle, style]}>
      <Text accessibilityRole="header" style={[type.sectionTitle, styles.grow]} numberOfLines={1}>
        {children}
      </Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={[type.bodyStrong, styles.action]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A note under a group. */
export function FootNote({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <Text style={[type.secondary, styles.footNote, center && styles.center]}>{children}</Text>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  barSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  barRight: { justifyContent: 'flex-end', gap: spacing.md },
  back: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -8 },
  backText: { color: colors.primary },
  barButton: { height: 44, justifyContent: 'center' },
  strong: { fontFamily: type.heading.fontFamily },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: 10,
    marginHorizontal: spacing.xs,
  },
  action: { color: colors.primary },
  grow: { flex: 1 },
  footNote: { marginTop: 10, marginHorizontal: spacing.xs },
  center: { textAlign: 'center' },
});
