import { isErrorCode } from '@tugeel/shared/errors';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
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

export function ProblemText({ problem }: { problem: AppProblem | null | undefined }) {
  const text = useProblemText();
  if (!problem) return null;
  return (
    <View accessibilityRole="alert" style={styles.problem}>
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
    marginTop: spacing.md,
    backgroundColor: colors.destructiveSoft,
    borderRadius: radii.field,
    padding: spacing.md,
  },
  problemText: { color: colors.destructive },
});
