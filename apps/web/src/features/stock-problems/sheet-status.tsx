import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { SheetStatus } from './api';

const VARIANT = { OPEN: 'warning', APPROVED: 'success', CLOSED: 'secondary' } as const;

export function SheetStatusBadge({ status }: { status: SheetStatus }) {
  const { t } = useTranslation();
  return <Badge variant={VARIANT[status]}>{t(`stockProblems.sheet.status.${status}`)}</Badge>;
}
