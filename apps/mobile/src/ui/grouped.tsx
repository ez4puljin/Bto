import { Check, ChevronRight } from 'lucide-react-native';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { Text, TextInput } from './text';
import { colors, radii, spacing, type } from '../theme/tokens';

/** The white rounded group of the design's lists; rows are separated by inset hairlines. */
export function Group({
  children,
  inset = spacing.lg,
  style,
}: {
  children: ReactNode;
  /** Where a separator starts: 16, or 58 past a row's 30 px icon tile. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const rows = Children.toArray(children).filter((child) => isValidElement(child));
  return (
    <View style={[styles.group, style]}>
      {rows.map((row, index) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
          {index > 0 ? <Separator inset={inset} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function Separator({ inset = spacing.lg }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

/** A 30 px rounded square in a system tint with a white icon (the design's row icons). */
export function IconTile({ color, children }: { color: string; children: ReactNode }) {
  return <View style={[styles.tile, { backgroundColor: color }]}>{children}</View>;
}

/** The inset of a group whose rows carry an icon tile. */
export const ICON_INSET = spacing.lg + 30 + spacing.md;

/** A row with a label and a text field after it (the checkout's contact, a password). */
export function InputRow({
  label,
  labelWidth = 72,
  style,
  ...props
}: TextInputProps & { label: string; labelWidth?: number; style?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.inputRow}>
      <Text style={[type.row, { width: labelWidth }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={label}
        style={[type.row, styles.input, style]}
        {...props}
      />
    </View>
  );
}

/**
 * A row of a group: an icon tile, a title (and a line under it), a value, then a chevron when it
 * opens something or a check when it is the chosen one.
 */
export function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  chevron = onPress !== undefined,
  checked,
  destructive = false,
  accent = false,
  right,
  disabled = false,
  role,
  accessibilityLabel,
  minHeight = 48,
  titleStyle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  onPress?: () => void;
  chevron?: boolean;
  /** A radio or check row: true shows the check. */
  checked?: boolean;
  destructive?: boolean;
  /** An action in the accent colour («Нууц үг солих»). */
  accent?: boolean;
  right?: ReactNode;
  disabled?: boolean;
  role?: 'button' | 'radio' | 'checkbox' | 'link';
  accessibilityLabel?: string;
  minHeight?: number;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const content = (
    <>
      {icon}
      <View style={styles.text}>
        <Text
          style={[
            type.row,
            destructive && { color: colors.destructive },
            accent && { color: colors.primary },
            titleStyle,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={type.secondary} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[type.body, styles.value]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {checked ? <Check size={20} strokeWidth={2.6} color={colors.primary} /> : null}
      {chevron ? <ChevronRight size={16} strokeWidth={2.6} color={colors.input} /> : null}
    </>
  );
  const style = [styles.row, { minHeight }];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole={role === 'checkbox' ? 'checkbox' : role === 'radio' ? 'radio' : 'button'}
      accessibilityState={
        role === 'radio' || role === 'checkbox'
          ? { checked: checked === true, disabled }
          : { disabled }
      }
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  tile: {
    width: 30,
    height: 30,
    borderRadius: radii.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  text: { flex: 1, paddingVertical: 10, gap: 1 },
  value: { color: colors.muted, maxWidth: '55%', textAlign: 'right' },
  pressed: { backgroundColor: colors.accent },
  disabled: { opacity: 0.5 },
  inputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  input: { flex: 1, height: 44, paddingVertical: 0 },
});
