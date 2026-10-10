import type { ProblemDetails } from '@tugeel/api-client';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** The Mongolian message for an API error code (ADR-0011: `errors.<CODE>`). */
export function ProblemAlert({ problem }: { problem: ProblemDetails | null | undefined }) {
  const { t } = useTranslation();
  if (!problem) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{t(`errors.${problem.code}`, problem.params ?? {})}</AlertDescription>
    </Alert>
  );
}
