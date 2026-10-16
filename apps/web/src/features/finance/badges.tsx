import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { Invoice, JournalSource, Payment, Settlement } from './api';

/**
 * How far an invoice is paid (docs/ui.md status colours): open amber (it waits for money), partly
 * blue, paid green; a voided one is an outline, like anything cancelled.
 */
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
    return <Badge variant="outline">{t('finance.invoiceStatuses.VOID')}</Badge>;
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

/** A voucher: posted green, voided an outline. */
export function PaymentStatusBadge({ status }: { status: Payment['status'] }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'POSTED' ? 'success' : 'outline'}>
      {t(`finance.paymentStatuses.${status}`)}
    </Badge>
  );
}

/**
 * What a voucher is: a fact, never a warning (orange means "needs attention"): money going out is a
 * grey pill, money coming in an outline.
 */
export function PaymentKindBadge({ kind }: { kind: Payment['kind'] }) {
  const { t } = useTranslation();
  const out = kind === 'CUSTOMER_REFUND' || kind === 'OTHER_OUT';
  return <Badge variant={out ? 'secondary' : 'outline'}>{t(`finance.paymentKinds.${kind}`)}</Badge>;
}

export function SourceBadge({ source }: { source: JournalSource }) {
  const { t } = useTranslation();
  return (
    <Badge variant={source === 'MANUAL' || source === 'OPENING' ? 'default' : 'outline'}>
      {t(`finance.sources.${source}`)}
    </Badge>
  );
}
