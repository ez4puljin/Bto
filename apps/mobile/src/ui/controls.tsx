import { ChevronDown, Search, X } from 'lucide-react-native';
import type { ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { Text, TextInput } from './text';
import { colors, fonts, radii, shadows, spacing, TOUCH, type } from '../theme/tokens';

/** The grey 40 px search field with its glass. */
export function SearchField({
  inputRef,
  style,
  ...props
}: TextInputProps & { inputRef?: Ref<TextInput>; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.search, style]}>
      <Search size={18} strokeWidth={2.2} color={colors.muted} />
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        returnKeyType="search"
        style={[type.row, styles.searchInput]}
        {...props}
      />
    </View>
  );
}

/** A segmented control: the chosen part a white raised pill on the grey track. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  height = 40,
  small = false,
  label,
}: {
  options: readonly { value: T; label: string; dot?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  height?: number;
  /** Smaller labels (three sorts in a sheet). */
  small?: boolean;
  label?: string;
}) {
  const inner = height - 6;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              { height: inner, borderRadius: inner / 2 },
              on && styles.segmentOn,
            ]}
          >
            {option.dot ? <View style={[styles.dot, { backgroundColor: option.dot }]} /> : null}
            <Text
              numberOfLines={1}
              style={[
                small ? styles.segmentTextSmall : styles.segmentText,
                { fontFamily: on ? fonts.semibold : fonts.medium },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The iOS switch: green when on. */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={6}
      style={[styles.switch, { backgroundColor: value ? colors.tint.green : colors.switchOff }]}
    >
      <View style={[styles.knob, { left: value ? 22 : 2 }]} />
    </Pressable>
  );
}

type PillVariant = 'primary' | 'soft' | 'white' | 'destructive';

/** The 50 px rounded buttons: «Сагсанд нэмэх», «Захиалга илгээх». */
export function PillButton({
  title,
  onPress,
  icon,
  trailing,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingTitle,
  height = 50,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  icon?: ReactNode;
  trailing?: ReactNode;
  variant?: PillVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Shown beside the spinner while loading («Шалгаж байна…»); otherwise the spinner alone. */
  loadingTitle?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const palette = PILLS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: pressed ? palette.pressed : palette.fill,
        },
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <>
          <ActivityIndicator color={palette.text} />
          {loadingTitle ? (
            <Text numberOfLines={1} style={[styles.pillText, { color: palette.text }]}>
              {loadingTitle}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {icon}
          <Text numberOfLines={1} style={[styles.pillText, { color: palette.text }]}>
            {title}
          </Text>
          {trailing}
        </>
      )}
    </Pressable>
  );
}

const PILLS: Record<PillVariant, { fill: string; pressed: string; text: string }> = {
  primary: { fill: colors.primary, pressed: colors.primaryPressed, text: colors.primaryForeground },
  soft: { fill: colors.secondary, pressed: colors.fill, text: colors.secondaryForeground },
  white: { fill: colors.card, pressed: colors.accent, text: colors.primary },
  destructive: { fill: colors.card, pressed: colors.destructiveSoft, text: colors.destructive },
};

/** A red (or accent) count on a button's corner; nothing for 0. */
export function CountBadge({
  count,
  tone = 'red',
  ring = colors.card,
  style,
}: {
  count: number;
  tone?: 'red' | 'accent';
  /** The colour of the ring that cuts it from the button (the page behind). */
  ring?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (count <= 0) return null;
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: ring,
          backgroundColor: tone === 'red' ? colors.destructive : colors.primary,
        },
        style,
      ]}
    >
      <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

/** A 44 px round white button floating over the page (scanner, filter, bell, back, cart). */
export function CircleButton({
  icon,
  onPress,
  label,
  badge = 0,
  badgeTone = 'red',
  badgeRing,
  style,
}: {
  icon: ReactNode;
  onPress: () => void;
  label: string;
  badge?: number;
  badgeTone?: 'red' | 'accent';
  badgeRing?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.circle, pressed && styles.circlePressed, style]}
    >
      {icon}
      <CountBadge
        count={badge}
        tone={badgeTone}
        {...(badgeRing ? { ring: badgeRing } : {})}
        style={styles.circleBadge}
      />
    </Pressable>
  );
}

/** A grey chip of the shop's chip row: «Ангилал ⌄», «⇅ Шинэ эхэндээ». */
export function MenuChip({
  label,
  onPress,
  icon,
  chevron = false,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, chevron && styles.chipChevron]}
    >
      {icon}
      <Text style={styles.chipText}>{label}</Text>
      {chevron ? <ChevronDown size={14} strokeWidth={2.4} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** A chosen filter as a blue chip with its ×. */
export function ActiveChip({
  label,
  onPress,
  onRemove,
  removeLabel,
}: {
  label: string;
  onPress: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <View style={styles.activeChip}>
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text style={styles.activeChipText} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        onPress={onRemove}
        hitSlop={6}
        style={styles.activeChipX}
      >
        <X size={14} strokeWidth={2.6} color={colors.link} />
      </Pressable>
    </View>
  );
}

/** A choice chip: grey, or the accent when chosen (categories, presets). */
export function ChoiceChip({
  label,
  selected,
  onPress,
  onWhite = false,
  compact = false,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** On the grey canvas the idle chip is white; on a white card it is grey. */
  onWhite?: boolean;
  /** The 32 px chips of a page (the orders' days); 34 px in a sheet. */
  compact?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        compact && styles.choiceCompact,
        { backgroundColor: selected ? colors.primary : onWhite ? colors.canvas : colors.card },
      ]}
    >
      {icon}
      <Text
        style={[
          styles.choiceText,
          compact && styles.choiceTextCompact,
          selected
            ? { color: colors.primaryForeground, fontFamily: fonts.semibold }
            : { color: colors.foreground, fontFamily: fonts.medium },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.fieldFill,
  },
  searchInput: { flex: 1, paddingVertical: 0 },
  track: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    backgroundColor: colors.fieldFill,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentOn: { backgroundColor: colors.card, boxShadow: shadows.segment },
  segmentText: type.body,
  segmentTextSmall: { ...type.chip },
  dot: { width: 8, height: 8, borderRadius: 4 },
  switch: { width: 51, height: 31, borderRadius: 16 },
  knob: {
    position: 'absolute',
    top: 2,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: colors.card,
    boxShadow: shadows.knob,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: 22,
  },
  pillText: type.button,
  disabled: { opacity: 0.45 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: type.badge,
  circle: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.floatingFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineSoft,
    boxShadow: shadows.floating,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circlePressed: { backgroundColor: colors.accent },
  circleBadge: { position: 'absolute', top: -3, right: -3 },
  chip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.canvas,
  },
  chipChevron: { gap: spacing.xs, paddingRight: 10 },
  chipText: type.chip,
  activeChip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: 16,
    backgroundColor: colors.secondary,
    maxWidth: 240,
  },
  activeChipText: { ...type.chip, fontFamily: fonts.semibold, color: colors.link },
  activeChipX: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choice: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 17,
  },
  choiceCompact: { height: 32, borderRadius: 16 },
  choiceText: type.body,
  choiceTextCompact: type.chip,
});
