import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';

/**
 * The segmented control in the blue header band (the Picking board): a translucent track, the
 * chosen part white with the link colour.
 */
export function HeaderSegments<T extends string>({
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
    <View style={styles.pad}>
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
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text
                numberOfLines={1}
                style={[
                  type.chip,
                  on
                    ? { color: colors.link, fontFamily: fonts.semibold }
                    : { color: colors.primaryForeground },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
  },
  segment: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentOn: { backgroundColor: colors.card },
});
