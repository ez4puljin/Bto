import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { EbarimtStatus, SaleKind, ShiftStatus, VoidReason } from './api';

/** Open (blue), closed (amber: the cash waits for the accountant), handed over (green). */
export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={status === 'HANDED_OVER' ? 'success' : status === 'CLOSED' ? 'warning' : 'default'}
    >
      {t(`pos.shiftStatuses.${status}`)}
    </Badge>
  );
}

export function SaleKindBadge({ kind }: { kind: SaleKind }) {
  const { t } = useTranslation();
  return (
    <Badge variant={kind === 'RETURN' ? 'warning' : 'outline'}>{t(`pos.saleKinds.${kind}`)}</Badge>
  );
}

/** The e-Barimt receipt's state as the edge reported it; grey until receipts exist (ADR-0065). */
export function EbarimtBadge({ status }: { status: EbarimtStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'CONFIRMED'
      ? 'success'
      : status === 'ERROR' || status === 'INDETERMINATE'
        ? 'destructive'
        : status === 'NONE'
          ? 'secondary'
          : 'warning';
  return <Badge variant={variant}>{t(`pos.ebarimtStatuses.${status}`)}</Badge>;
}

/** Why goods left a till's cart (ADR-0104): a whole cart cancelled reads amber. */
export function VoidReasonBadge({ reason }: { reason: VoidReason }) {
  const { t } = useTranslation();
  return (
    <Badge variant={reason === 'CART_CANCELLED' ? 'warning' : 'outline'}>
      {t(`pos.voidReasons.${reason}`)}
    </Badge>
  );
}

export function ActiveBadge({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'ACTIVE' ? 'success' : 'secondary'}>
      {t(`pos.statuses.${status}`)}
    </Badge>
  );
}
