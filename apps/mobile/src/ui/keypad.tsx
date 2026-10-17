import { Delete } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, shadows, spacing, type } from '../theme/tokens';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The quantity keypad of the design (ProductKeypad): «Цуцлах» and «Болсон» on its bar, then 1–9,
 * 0 and ⌫; the system keyboard never opens, so it never covers the number.
 */
export function Keypad({
  onDigit,
  onDelete,
  onCancel,
  onDone,
  cancelLabel,
  doneLabel,
  deleteLabel,
}: {
  onDigit: (digit: string) => void;
  onDelete: () => void;
  onCancel: () => void;
  onDone: () => void;
  cancelLabel: string;
  doneLabel: string;
  deleteLabel: string;
}) {
  const insets = useSafeAreaInsets();
  const key = (digit: string) => (
    <Pressable
      key={digit}
      accessibilityRole="button"
      accessibilityLabel={digit}
      onPress={() => onDigit(digit)}
      style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
    >
      <Text style={styles.digit}>{digit}</Text>
    </Pressable>
  );
  return (
    <View>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          hitSlop={6}
          style={styles.barButton}
        >
          <Text style={styles.barText}>{cancelLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onDone} hitSlop={6} style={styles.barButton}>
          <Text style={[styles.barText, styles.done]}>{doneLabel}</Text>
        </Pressable>
      </View>
      <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
        {DIGITS.map(key)}
        <View style={styles.blank} />
        {key('0')}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={onDelete}
          style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
        >
          <Delete size={26} strokeWidth={1.8} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 46,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.keypadBar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barButton: { height: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  barText: { ...type.row, color: colors.primary },
  done: { fontFamily: fonts.semibold },
  tray: {
    backgroundColor: colors.keypadTray,
    paddingTop: 7,
    paddingHorizontal: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 7,
    columnGap: 6,
  },
  key: {
    width: '31.8%',
    flexGrow: 1,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.card,
    boxShadow: shadows.key,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.fill },
  digit: { ...type.title, fontFamily: fonts.regular, letterSpacing: 0 },
  blank: { width: '31.8%', flexGrow: 1, height: 50 },
  delete: {
    width: '31.8%',
    flexGrow: 1,
    height: 50,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePressed: { backgroundColor: colors.fieldFill },
});
