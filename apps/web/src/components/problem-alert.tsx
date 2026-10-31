import type { ProblemDetails } from '@tugeel/api-client';
import { useTranslation } from 'react-i18next';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatMnt } from '@/lib/money';

const CREDIT_KEYS = {
  HOLD: 'errors.CREDIT_BLOCKED_HOLD',
  OVERDUE: 'errors.CREDIT_BLOCKED_OVERDUE',
  LIMIT: 'errors.CREDIT_BLOCKED_LIMIT',
} as const;
const money = (value: unknown) => (typeof value === 'string' ? formatMnt(value) : '');

/**
 * The Mongolian message for an API error code (ADR-0011: `errors.<CODE>`). The credit refusal
 * (ADR-0060 #2) gets one line per reason with its amounts formatted. A validation refusal lists
 * its fields in Mongolian (`errors.fields.<path>.<constraint>`, the path without its indexes, else
 * `validation.<constraint>`, else the server's own words); a system error names its request id so
 * the owner can find it in the log. `onRetry` (a failed load, ADR-0113) adds «Дахин оролдох» at
 * the alert's end.
 */
export function ProblemAlert({
  problem,
  onRetry,
}: {
  problem: ProblemDetails | null | undefined;
  onRetry?: () => unknown;
}) {
  const { t, i18n } = useTranslation();
  if (!problem) return null;
  const params = problem.params ?? {};
  // Field texts are looked up by a path built at run time, outside the typed keys.
  const plain = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const fields = (problem.errors ?? []).map((error) => {
    const path = error.path.replace(/\.\d+(?=\.|$)/g, '');
    const own = `errors.fields.${path}.${error.constraint}`;
    if (i18n.exists(own)) return plain(own, { message: error.message });
    const generic = `validation.${error.constraint}`;
    if (i18n.exists(generic)) return `${path}: ${plain(generic)}`;
    return `${path}: ${error.message}`;
  });
  const requestId =
    problem.status >= 500 && problem.requestId
      ? t('errors.requestId', { id: problem.requestId.slice(0, 8) })
      : null;
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
        {requestId ? <span className="ml-1 font-mono text-xs opacity-80">{requestId}</span> : null}
        {fields.length > 0 ? (
          <ul className="mt-1 list-disc pl-5">
            {fields.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => void onRetry()}
          >
            {t('common.retry')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
