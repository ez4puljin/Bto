import { CircleAlert, Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, type Ref, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { Text, TextInput } from './text';
import { colors, fonts, radii, TOUCH, type } from '../theme/tokens';

/**
 * A labelled text field of the sign-in boards (ADR-0066): the label above a 52 px grey box with a
 * leading icon; white with a blue border while focused, a red one with the message under it on an
 * error. `trailing` holds a 44 px button (clear, show the password, a spinner).
 */
export function TextField({
  label,
  icon: Icon,
  error,
  hint,
  trailing,
  inputRef,
  style,
  onFocus,
  onBlur,
  ...props
}: Omit<TextInputProps, 'style'> & {
  label: string;
  icon?: LucideIcon;
  /** Shown in red under the box; it wins over `hint`. */
  error?: string | null;
  /** A grey line under the box («Шалгаж байна…»). */
  hint?: string | null;
  trailing?: ReactNode;
  inputRef?: Ref<TextInput>;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  const failed = Boolean(error);
  return (
    <View style={style}>
      <Text style={[type.label, styles.label]}>{label}</Text>
      <View
        style={[
          styles.box,
          (focused || failed) && styles.boxActive,
          focused && styles.boxFocused,
          failed && styles.boxFailed,
        ]}
      >
        {Icon ? (
          <Icon size={18} strokeWidth={2} color={focused ? colors.primary : colors.muted} />
        ) : null}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          placeholderTextColor={colors.placeholder}
          cursorColor={colors.primary}
          selectionColor={colors.rangeFill}
          selectionHandleColor={colors.primary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
          // The family is set on every render: Android gives a password field a monospace face,
          // and showing it again must keep Inter (React Native 0.86 keeps it, older ones did not).
          style={[type.field, styles.input, { fontFamily: fonts.regular }]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {failed ? (
        <View accessibilityRole="alert" style={styles.message}>
          <CircleAlert
            size={14}
            strokeWidth={2.2}
            color={colors.destructive}
            style={styles.errorIcon}
          />
          <Text style={[type.secondary, styles.error]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={[type.secondary, styles.hint]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** The eye in a password field's trailing slot: «Нууц үг харуулах» / «Нууц үг нуух». */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const Glyph = shown ? EyeOff : Eye;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shown ? t('mobile.login.hidePassword') : t('mobile.login.showPassword')}
      onPress={onToggle}
      style={styles.button}
    >
      <Glyph size={20} strokeWidth={2} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 6 },
  box: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radii.field,
    borderWidth: 1.5,
    borderColor: colors.field,
    backgroundColor: colors.field,
  },
  boxActive: { backgroundColor: colors.card },
  boxFocused: { borderColor: colors.primary },
  boxFailed: { borderColor: colors.destructive },
  input: { flex: 1, alignSelf: 'stretch', paddingVertical: 0, paddingHorizontal: 0 },
  trailing: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  button: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  message: { marginTop: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  errorIcon: { marginTop: 1 },
  error: { flexShrink: 1, color: colors.destructive },
  hint: { marginTop: 6 },
});
