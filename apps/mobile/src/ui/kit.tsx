import { isErrorCode } from '@tugeel/shared/errors';
import { CircleAlert } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './text';
import { type AppProblem, creditMessage } from '../api/problem';
import { colors, radii, spacing, type } from '../theme/tokens';

// What every screen shows when there is nothing yet, or when a call failed; the rest of the kit
// lives beside it in src/ui (ADR-0066).

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
      {hint ? <Text style={[type.body, styles.hint]}>{hint}</Text> : null}
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

/** A failed call's message in a red box with its alert sign, 12 px under what is above it. */
export function ProblemText({
  problem,
  style,
}: {
  problem: AppProblem | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const text = useProblemText();
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
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  center: { textAlign: 'center' },
  hint: { textAlign: 'center', color: colors.muted },
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
