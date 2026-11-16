import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';

/**
 * A section's label over its card or strip in the staff app (the boards' `sec`): upper case, grey,
 * with «Бүгд» on the right when it opens a list. The whole line is the link, and its hit slop
 * makes up the 44 px the line itself does not draw.
 */
export function SectionHeading({
  title,
  subtitle,
  onPress,
  label,
  style,
}: {
  title: string;
  /** Joined after the title: «Урамшуулал · 11/30 хүртэл». */
  subtitle?: string | null;
  onPress?: () => void;
  /** What a screen reader says for the link. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const text = (
    <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
      {subtitle ? `${title} · ${subtitle}` : title}
    </Text>
  );
  if (!onPress) return <View style={[styles.heading, style]}>{text}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 8 }}
      style={({ pressed }) => [styles.heading, pressed && styles.pressed, style]}
    >
      {text}
      <Text style={styles.all}>{t('mobile.home.seeAll')}</Text>
    </Pressable>
  );
}

/** The side a staff page's blocks keep from the screen's edge. */
export const SIDE = spacing.lg;

const styles = StyleSheet.create({
  heading: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: SIDE + spacing.xs,
    marginBottom: -spacing.sm,
  },
  pressed: { opacity: 0.6 },
  title: {
    ...type.sectionHeader,
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  all: { ...type.chip, fontFamily: fonts.medium, color: colors.link },
});
