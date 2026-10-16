import { isErrorCode } from '@tugeel/shared/errors';
import type { OrderStatus, PaymentMethod } from '@tugeel/shared/sales';
import { Minus, Plus } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type AppProblem, creditMessage } from '../api/problem';
import { formatMnt } from '../format/format';
import { colors, radii, spacing, TOUCH, type } from '../theme/tokens';

/** A screen: the canvas colour and the safe area at the top (tabs keep the bottom). */
export function Screen({
  children,
  style,
  bottom = false,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  bottom?: boolean;
}) {
  return (
    <SafeAreaView edges={bottom ? ['top', 'bottom'] : ['top']} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={type.title}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={[type.caption, styles.section]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = BUTTONS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.pressed : palette.background },
        palette.border ? { borderWidth: 1, borderColor: palette.border } : null,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <View style={styles.buttonInner}>
          {icon}
          <Text style={[type.bodyStrong, { color: palette.text }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const BUTTONS: Record<
  ButtonVariant,
  { background: string; pressed: string; text: string; border?: string }
> = {
  primary: {
    background: colors.primary,
    pressed: colors.primaryPressed,
    text: colors.primaryForeground,
  },
  secondary: {
    background: colors.secondary,
    pressed: colors.fill,
    text: colors.secondaryForeground,
  },
  ghost: { background: 'transparent', pressed: colors.accent, text: colors.link },
  danger: {
    background: colors.card,
    pressed: colors.destructiveSoft,
    text: colors.destructive,
    border: colors.border,
  },
};

export function TextField({
  label,
  style,
  ...props
}: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={type.caption}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[type.secondary, styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** − n + for a whole quantity; 0 hides the minus. */
export function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const { t } = useTranslation();
  if (value === 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobile.cart.addOne', { unit: label })}
        onPress={() => onChange(1)}
        style={styles.addButton}
      >
        <Plus size={16} color={colors.primaryForeground} />
        <Text style={[type.caption, styles.addText]}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobile.cart.less', { unit: label })}
        onPress={() => onChange(value - 1)}
        style={styles.stepButton}
      >
        <Minus size={18} color={colors.primary} />
      </Pressable>
      <Text style={[type.bodyStrong, styles.stepValue]}>{`${value} ${label}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobile.cart.more', { unit: label })}
        onPress={() => onChange(value + 1)}
        style={styles.stepButton}
      >
        <Plus size={18} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const STATUS_COLORS: Partial<Record<OrderStatus, { background: string; text: string }>> = {
  DRAFT: { background: colors.fill, text: colors.muted },
  CONFIRMED: { background: colors.secondary, text: colors.secondaryForeground },
  CANCELLED: { background: colors.destructiveSoft, text: colors.destructive },
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const palette = STATUS_COLORS[status] ?? { background: colors.successSoft, text: colors.success };
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[type.caption, { color: palette.text }]}>{t(`sales.statuses.${status}`)}</Text>
    </View>
  );
}

const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  CASH: colors.success,
  BANK_TRANSFER: colors.primary,
  CREDIT: colors.warning,
};

/** The payment as each order's label (ADR-0058 #8): a small coloured square and its name. */
export function PaymentLabel({ method }: { method: PaymentMethod }) {
  const { t } = useTranslation();
  return (
    <View style={styles.payment}>
      <View style={[styles.paymentDot, { backgroundColor: PAYMENT_COLORS[method] }]} />
      <Text style={type.caption}>{t(`sales.paymentMethods.${method}`)}</Text>
    </View>
  );
}

/** «12,500₮» from a whole-MNT string; «—» without one. */
export function Money({
  value,
  style,
}: {
  value: string | null | undefined;
  style?: StyleProp<TextStyle>;
}) {
  const { t } = useTranslation();
  return (
    <Text style={[type.bodyStrong, styles.tabular, style]}>
      {value === null || value === undefined
        ? t('common.none')
        : t('pricing.money', { amount: formatMnt(value) })}
    </Text>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={[type.heading, styles.center]}>{title}</Text>
      {hint ? <Text style={[type.secondary, styles.center]}>{hint}</Text> : null}
    </View>
  );
}

/** The Mongolian message of a failed call: no answer, the credit refusal, or the error code. */
export function useProblemText() {
  const { t } = useTranslation();
  return (problem: AppProblem): string => {
    if (problem.code === 'NETWORK') return t('mobile.errors.network');
    const credit = creditMessage(problem);
    if (credit) return t(credit.key, credit.params);
    if (isErrorCode(problem.code)) return t(`errors.${problem.code}`, problem.params ?? {});
    return t('errors.unexpected');
  };
}

export function ProblemText({ problem }: { problem: AppProblem | null | undefined }) {
  const text = useProblemText();
  if (!problem) return null;
  return (
    <View style={styles.problem}>
      <Text style={[type.body, { color: colors.destructive }]}>{text(problem)}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  section: { textTransform: 'uppercase', marginTop: spacing.md },
  button: {
    minHeight: TOUCH,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  field: { gap: spacing.xs },
  input: {
    ...type.body,
    minHeight: TOUCH,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.foreground },
  chipTextSelected: { color: colors.primaryForeground },
  addButton: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addText: { color: colors.primaryForeground },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.secondary,
  },
  stepButton: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  payment: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  paymentDot: { width: 10, height: 10, borderRadius: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  center: { textAlign: 'center' },
  problem: {
    backgroundColor: colors.destructiveSoft,
    borderRadius: radii.control,
    padding: spacing.md,
  },
});
