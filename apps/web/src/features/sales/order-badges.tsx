import type { OrderStatus, PaymentMethod } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'CANCELLED'
      ? 'outline'
      : status === 'DRAFT'
        ? 'secondary'
        : status === 'CONFIRMED'
          ? 'default'
          : 'success';
  return <Badge variant={variant}>{t(`sales.statuses.${status}`)}</Badge>;
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
