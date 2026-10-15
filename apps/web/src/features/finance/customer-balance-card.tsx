import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { Button } from '@/components/ui/button';
import { useCustomerBalance } from './api';
import { BalanceCard } from './customer-ledger-page';

/** «Тооцоо» on the customer page (ADR-0060 #11), for people who read finance. */
export function CustomerBalanceCard({ customerId }: { customerId: number }) {
  const { t } = useTranslation();
  const canRead = useHasPermission('finance.read');
  const balance = useCustomerBalance(customerId, canRead);
  if (!canRead || !balance.data) return null;
  return (
    <div className="space-y-2">
      <BalanceCard balance={balance.data} compact />
      <Button asChild variant="link" size="sm" className="px-0">
        <Link to={`/finance/customers/${customerId}`}>{t('finance.balances.openLedger')}</Link>
      </Button>
    </div>
  );
}
