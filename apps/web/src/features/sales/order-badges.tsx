import type { OrderStatus, PaymentMethod, PickStatus } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

const PICK_VARIANTS = {
  OPEN: 'outline',
  PICKING: 'warning',
  DONE: 'success',
} as const satisfies Record<PickStatus, string>;

/** A part's status as a badge in its tone: not started, being picked (by whom), picked (by whom). */
export function PickStatusBadge({
  part,
}: {
  part: { status: PickStatus; pickerName: string | null };
}) {
  const { t } = useTranslation();
  return (
    <Badge variant={PICK_VARIANTS[part.status]}>
      {part.status === 'OPEN'
        ? t('sales.pick.status.OPEN')
        : t(`sales.pick.status.${part.status}`, { name: part.pickerName ?? '' })}
    </Badge>
  );
}

/**
 * docs/ui.md status colours: a draft grey, the order on its way blue, a pending approval orange
 * (it waits for someone), a failed delivery red, done green, cancelled an outline.
 */
const STATUS_VARIANTS = {
  DRAFT: 'secondary',
  SUBMITTED: 'default',
  APPROVAL_PENDING: 'warning',
  CONFIRMED: 'default',
  PICKING: 'default',
  PACKED: 'default',
  DISPATCHED: 'default',
  DELIVERED: 'success',
  DELIVERY_FAILED: 'destructive',
  INVOICED: 'success',
  CLOSED: 'success',
  CANCELLED: 'outline',
} as const satisfies Record<OrderStatus, string>;

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANTS[status]}>{t(`sales.statuses.${status}`)}</Badge>;
}

const PAYMENT_VARIANTS = {
  CREDIT: 'warning',
  CASH: 'success',
  BANK_TRANSFER: 'default',
} as const satisfies Record<PaymentMethod, string>;

/**
 * The order's label (ADR-0058): how it is paid, «Зээл» in orange and «Бэлнээр» in green, square so
 * it never reads as the round status pill beside it.
 */
export function PaymentLabel({ method }: { method: PaymentMethod }) {
  const { t } = useTranslation();
  return (
    <Badge variant={PAYMENT_VARIANTS[method]} className="rounded-md">
      {t(`sales.paymentMethods.${method}`)}
    </Badge>
  );
}
