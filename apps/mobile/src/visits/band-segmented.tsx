import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, radii, shadows, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';

/**
 * A segmented control in a page's blue header band (the boards' `seg onblue`): a translucent
 * track, the chosen part white with blue words.
 */
export function BandSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.track}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 5, bottom: 5 }}
            style={[styles.part, on && styles.partOn]}
          >
            <Text style={[type.chip, on ? styles.textOn : styles.text]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.onPrimaryHairline,
  },
  part: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 9,
  },
  partOn: { backgroundColor: colors.card, boxShadow: shadows.segment },
  text: { color: colors.primaryForeground },
  textOn: { fontFamily: fonts.semibold, color: colors.link },
});
