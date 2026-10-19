import { CircleAlert } from 'lucide-react-native';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type StyleProp,
  StyleSheet,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import type { AppProblem } from '../api/problem';
import { colors, fonts, radii, spacing, TOUCH, type } from '../theme/tokens';
import { useProblemText } from '../ui/kit';
import { Text, TextInput } from '../ui/text';
import { signInMessageOf } from './sign-in-problems';

/**
 * A row of the sign-in boards' grouped card (the Login and SetPassword boards, ADR-0079 #13): the
 * label in a fixed column, an optional prefix («+976»), the field, and a 44 px button after it
 * (the password's eye).
 */
export function FieldRow({
  label,
  labelWidth = 84,
  prefix,
  trailing,
  inputRef,
  ...props
}: Omit<TextInputProps, 'style'> & {
  label: string;
  labelWidth?: number;
  prefix?: string;
  trailing?: ReactNode;
  inputRef?: Ref<TextInput>;
}) {
  return (
    <View style={[styles.row, trailing ? styles.rowTrailing : null]}>
      <Text style={[type.row, { width: labelWidth }]} numberOfLines={1}>
        {label}
      </Text>
      {prefix ? <Text style={[type.field, styles.prefix]}>{prefix}</Text> : null}
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        cursorColor={colors.primary}
        selectionColor={colors.rangeFill}
        selectionHandleColor={colors.primary}
        {...props}
        // Android gives a password field a monospace face; the family is set on every render.
        style={[type.field, styles.input, { fontFamily: fonts.regular }]}
      />
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

/** The store's words for a failed sign-in, code or password call; the shared ones otherwise. */
export function useSignInProblemText() {
  const { t } = useTranslation();
  const shared = useProblemText();
  return (problem: AppProblem): string => {
    const message = signInMessageOf(problem);
    return message
      ? t(`mobile.customer.signIn.errors.${message.key}`, message.params)
      : shared(problem);
  };
}

/** A failed call's message in the kit's red box (as `ProblemText`), in the store's words. */
export function SignInProblem({
  problem,
  style,
}: {
  problem: AppProblem | null;
  style?: StyleProp<ViewStyle>;
}) {
  const text = useSignInProblemText();
  if (!problem) return null;
  return (
    <View accessibilityRole="alert" style={[styles.problem, style]}>
      <CircleAlert
        size={18}
        strokeWidth={2}
        color={colors.destructive}
        style={styles.problemIcon}
      />
      <Text style={[type.body, styles.problemText]}>{text(problem)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowTrailing: { paddingRight: spacing.xs },
  prefix: { color: colors.muted },
  input: { flex: 1, minWidth: 0, height: TOUCH, paddingVertical: 0, paddingHorizontal: 0 },
  trailing: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.destructiveSoft,
    borderRadius: radii.field,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  problemIcon: { marginTop: 0.5 },
  problemText: { flex: 1, color: colors.destructive },
});
