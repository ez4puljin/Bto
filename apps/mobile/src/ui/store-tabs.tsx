import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, spacing, storeType } from '../theme/tokens';
import { Text } from './text';

/** Two or more full-width buttons switching a page's parts: «Мэдэгдэл», «Захиалга» (ADR-0166). */
export function StoreTabs<Key extends string>({
  tabs,
  selected,
  onSelect,
  label,
  style,
}: {
  tabs: readonly { key: Key; label: string }[];
  selected: Key;
  onSelect: (key: Key) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.tabs, style]}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === tab.key }}
          onPress={() => onSelect(tab.key)}
          style={[styles.button, selected === tab.key ? styles.on : styles.off]}
        >
          <Text style={storeType.tabButton} numberOfLines={1}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.md },
  button: {
    flex: 1,
    height: 38,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.primary },
  off: { backgroundColor: colors.placeholder },
});
