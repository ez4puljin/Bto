import { ScanLine, Search } from 'lucide-react-native';
import type { Ref } from 'react';
import { Pressable, StyleSheet, type TextInputProps, View } from 'react-native';
import { colors, radii, spacing, TOUCH, type } from '../theme/tokens';
import { Text, TextInput } from '../ui/text';

/**
 * The white search field in the blue header of the warehouse pages (the TransferNew, Count and
 * Expiry boards): the glass, the text, and the scan icon inside the field on the right. Without
 * `onChangeText` the whole field is a button showing its placeholder (it opens a search page).
 */
export function HeaderSearch({
  inputRef,
  onScan,
  scanLabel,
  onPress,
  placeholder,
  ...props
}: TextInputProps & {
  inputRef?: Ref<TextInput>;
  onScan?: () => void;
  scanLabel?: string;
  /** The field as a button: a tap anywhere on the text opens the search. */
  onPress?: () => void;
}) {
  return (
    <View style={styles.pad}>
      <View style={styles.field}>
        <Search size={18} strokeWidth={2.2} color={colors.placeholder} />
        {onPress ? (
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={props.accessibilityLabel ?? placeholder}
            onPress={onPress}
            style={styles.button}
          >
            <Text style={[type.body, styles.placeholder]} numberOfLines={1}>
              {placeholder}
            </Text>
          </Pressable>
        ) : (
          <TextInput
            ref={inputRef}
            placeholder={placeholder}
            placeholderTextColor={colors.placeholder}
            autoCorrect={false}
            returnKeyType="search"
            style={[type.row, styles.input]}
            {...props}
          />
        )}
        {onScan ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scanLabel}
            onPress={onScan}
            hitSlop={{ top: 2, bottom: 2 }}
            style={({ pressed }) => [styles.scan, pressed && styles.faded]}
          >
            <ScanLine size={22} strokeWidth={1.9} color={colors.link} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  field: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.card,
  },
  input: { flex: 1, height: 40, paddingVertical: 0 },
  button: { flex: 1, height: 40, justifyContent: 'center' },
  placeholder: { color: colors.placeholder },
  scan: { width: TOUCH, height: 40, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.6 },
});
