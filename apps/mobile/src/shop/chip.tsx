import { type LucideIcon, X } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, type } from '../theme/tokens';
import { Text } from '../ui/text';

/**
 * A chip of the row under a staff page's header (the boards' `chip`): white with a hairline edge, blue for
 * «Шүүлтүүр» when filters are on, soft blue with its × for a chosen filter.
 */
export function Chip({
  label,
  tone = 'plain',
  icon: Icon,
  trailing: Trailing,
  onPress,
  onRemove,
  removeLabel,
  accessibilityLabel,
}: {
  label: string;
  tone?: 'plain' | 'primary' | 'chosen';
  icon?: LucideIcon;
  trailing?: LucideIcon;
  onPress: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  accessibilityLabel?: string;
}) {
  const ink =
    tone === 'primary' ? colors.primaryForeground : tone === 'chosen' ? colors.link : colors.label2;
  return (
    <View
      style={[
        styles.chip,
        tone === 'primary' && styles.chipPrimary,
        tone === 'chosen' && styles.chipChosen,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        hitSlop={{ top: 4, bottom: 4 }}
        style={[styles.chipLabel, onRemove ? styles.chipLabelRemovable : null]}
      >
        {Icon ? <Icon size={15} strokeWidth={2.2} color={ink} /> : null}
        <Text
          style={[type.chip, { color: ink }, tone !== 'plain' && styles.chipStrong]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {Trailing ? <Trailing size={15} strokeWidth={2.2} color={colors.muted} /> : null}
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          onPress={onRemove}
          hitSlop={6}
          style={styles.chipX}
        >
          <X size={15} strokeWidth={2.4} color={ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    maxWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipPrimary: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipChosen: { borderColor: colors.secondary, backgroundColor: colors.secondary },
  chipLabel: {
    flexShrink: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  chipLabelRemovable: { paddingRight: 2 },
  chipStrong: { fontFamily: fonts.semibold },
  chipX: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
});
