import { Minus, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, TOUCH, type } from '../theme/tokens';
import { Text } from '../ui/text';
import { MAX_COPIES, MIN_COPIES } from './list';

/** «− 3 +»: the copies of one label line, 1–20. */
export function CopiesStepper({
  value,
  onChange,
  small = false,
}: {
  value: number;
  onChange: (value: number) => void;
  small?: boolean;
}) {
  const { t } = useTranslation();
  const side = small ? 34 : TOUCH;
  const button = (label: string, to: number, disabled: boolean, icon: 'minus' | 'plus') => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(to)}
      hitSlop={small ? 5 : 0}
      style={({ pressed }) => [
        styles.round,
        { width: side, height: side, borderRadius: side / 2 },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {icon === 'minus' ? (
        <Minus size={18} strokeWidth={2.4} color={colors.foreground} />
      ) : (
        <Plus size={18} strokeWidth={2.4} color={colors.foreground} />
      )}
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {button(t('mobile.labels.copiesLess'), value - 1, value <= MIN_COPIES, 'minus')}
      <Text
        accessibilityLabel={t('mobile.labels.copies')}
        style={[small ? type.rowStrong : type.heading, styles.value]}
      >
        {value}
      </Text>
      {button(t('mobile.labels.copiesMore'), value + 1, value >= MAX_COPIES, 'plus')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  round: { backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 32, textAlign: 'center' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
});
