import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { Invoice, JournalSource, Payment, Settlement } from './api';

/** How far an invoice is paid: open (amber), partly (blue), paid (green); voided grey. */
export function SettlementBadge({
  settlement,
  status,
  overdue,
}: {
  settlement: Settlement;
  status: Invoice['status'];
  overdue?: boolean;
}) {
  const { t } = useTranslation();
  if (status === 'VOID') {
    return <Badge variant="secondary">{t('finance.invoiceStatuses.VOID')}</Badge>;
  }
  return (
    <>
      <Badge
        variant={
          settlement === 'PAID' ? 'success' : settlement === 'PARTIAL' ? 'default' : 'warning'
        }
      >
        {t(`finance.settlements.${settlement}`)}
      </Badge>
      {overdue ? <Badge variant="destructive">{t('finance.fields.overdue')}</Badge> : null}
    </>
  );
}

export function PaymentStatusBadge({ status }: { status: Payment['status'] }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'POSTED' ? 'success' : 'secondary'}>
      {t(`finance.paymentStatuses.${status}`)}
    </Badge>
  );
}

export function PaymentKindBadge({ kind }: { kind: Payment['kind'] }) {
  const { t } = useTranslation();
  const out = kind === 'CUSTOMER_REFUND' || kind === 'OTHER_OUT';
  return <Badge variant={out ? 'warning' : 'outline'}>{t(`finance.paymentKinds.${kind}`)}</Badge>;
}

export function SourceBadge({ source }: { source: JournalSource }) {
  const { t } = useTranslation();
  return (
    <Badge variant={source === 'MANUAL' || source === 'OPENING' ? 'default' : 'outline'}>
      {t(`finance.sources.${source}`)}
    </Badge>
  );
}
