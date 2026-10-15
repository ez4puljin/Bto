import type { ProblemDetails } from '@tugeel/api-client';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatMnt } from '@/lib/money';

const CREDIT_KEYS = {
  HOLD: 'errors.CREDIT_BLOCKED_HOLD',
  OVERDUE: 'errors.CREDIT_BLOCKED_OVERDUE',
  LIMIT: 'errors.CREDIT_BLOCKED_LIMIT',
} as const;
const money = (value: unknown) => (typeof value === 'string' ? formatMnt(value) : '');

/**
 * The Mongolian message for an API error code (ADR-0011: `errors.<CODE>`). The credit refusal
 * (ADR-0060 #2) gets one line per reason with its amounts formatted.
 */
export function ProblemAlert({ problem }: { problem: ProblemDetails | null | undefined }) {
  const { t } = useTranslation();
  if (!problem) return null;
  const params = problem.params ?? {};
  const reason =
    problem.code === 'CREDIT_BLOCKED'
      ? (Object.keys(CREDIT_KEYS) as (keyof typeof CREDIT_KEYS)[]).find(
          (entry) => entry === params.reason,
        )
      : undefined;
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {reason
          ? t(CREDIT_KEYS[reason], {
              exposure: money(params.exposure),
              limit: money(params.limit),
              excess: money(params.excess),
              overdueAmount: money(params.overdueAmount),
              oldestDueDate: typeof params.oldestDueDate === 'string' ? params.oldestDueDate : '',
            })
          : t(`errors.${problem.code}`, params)}
      </AlertDescription>
    </Alert>
  );
}
