import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { Button } from '@/components/ui/button';
import { unwrap } from '@/lib/problem';
import { EbarimtStatusBadges } from './ebarimt-receipts-page';

/** The store edge asks the centre every 5 s (ADR-0185): the wait is followed closely. */
const WAIT_MS = 2_000;

/**
 * The e-Barimt receipt of an order just sold on a stage with «e-Barimt гаргах» (ADR-0185), where
 * the sale was made: it waits for the store PosAPI's answer and then offers the print (the
 * lottery and the QR code go on the first print only). A credit order has no receipt; a person
 * without `finance.read` is pointed to whoever holds it.
 */
export function SaleEbarimt({ orderNumber }: { orderNumber: string }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const canRead = useHasPermission('finance.read');
  const found = useQuery({
    queryKey: ['finance', 'ebarimt-receipts', 'order', orderNumber],
    enabled: canRead,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt/receipts', {
          params: { query: { q: orderNumber, limit: 5 } },
          signal,
        }),
      ).data.find((row) => row.orderNumber === orderNumber) ?? null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'SENDING' ? WAIT_MS : false;
    },
  });
  const receipt = found.data;
  const list = `/finance/ebarimt-receipts?q=${encodeURIComponent(orderNumber)}`;

  let body;
  if (!canRead) body = <Note>{t('sales.boards.ebarimtAfter.noRight')}</Note>;
  else if (found.isPending) body = <Note>{t('common.loading')}</Note>;
  else if (found.isError) body = <Note>{t('sales.boards.ebarimtAfter.unknown')}</Note>;
  else if (!receipt) body = <Note>{t('sales.boards.ebarimtAfter.none')}</Note>;
  else if (receipt.status === 'CONFIRMED')
    body = (
      <Button asChild>
        <a href={`/finance/ebarimt-receipts/${receipt.id}/print`} target="_blank" rel="noreferrer">
          <Printer />
          {receipt.printable
            ? t('sales.boards.ebarimtAfter.print')
            : t('sales.boards.ebarimtAfter.printCopy')}
        </a>
      </Button>
    );
  else
    body = (
      <>
        <EbarimtStatusBadges receipt={receipt} />
        <Note>
          {receipt.status === 'PENDING' || receipt.status === 'SENDING'
            ? t('sales.boards.ebarimtAfter.waiting')
            : t('sales.boards.ebarimtAfter.stuck')}
        </Note>
      </>
    );

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm font-medium">{t('sales.boards.ebarimtAfter.title')}</p>
      <div className="flex flex-wrap items-center gap-2">{body}</div>
      {canRead && receipt && receipt.status !== 'CONFIRMED' ? (
        <Link to={list} className="text-sm text-primary underline-offset-4 hover:underline">
          {t('finance.ebarimtReceipts.open')}
        </Link>
      ) : null}
    </div>
  );
}

function Note({ children }: { children: string }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}
