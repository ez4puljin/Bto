import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii, spacing, type } from '../theme/tokens';

/** The MyOrders board's three numbers in one white card: «захиалга · батлагдсан дүн · ноорог». */
export function StatRow({
  items,
  onPress,
  label,
}: {
  items: readonly { value: string; label: string }[];
  /** Opens what the numbers count («Нүүр» opens the orders). */
  onPress?: () => void;
  label?: string;
}) {
  const content = items.map((item, index) => (
    <View key={item.label} style={[styles.stat, index > 0 && styles.divided]}>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {item.value}
      </Text>
      <Text style={type.caption}>{item.label}</Text>
    </View>
  ));
  if (!onPress) return <View style={styles.card}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  pressed: { backgroundColor: colors.accent },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  divided: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  value: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.foreground },
});
