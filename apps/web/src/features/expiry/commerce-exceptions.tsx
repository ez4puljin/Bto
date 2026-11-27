import type { ExpiryExceptionView } from '@tugeel/shared/expiry';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { randomUuid } from '@/lib/uuid';
import { useAcknowledgeExpiryException, useExpiryExceptions } from './commerce-api';

/** Includes missing-provenance sales and returns, without depending on an expiry item link. */
export function ExpiryCommerceExceptions() {
  const { t } = useTranslation();
  const canRead = useHasPermission('inventory.costs.manage');
  const [open, setOpen] = useState(false);
  const list = useExpiryExceptions(canRead && open);
  if (!canRead) return null;
  return (
    <section className="mb-4 space-y-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('expiry.posExceptions.title')}
      </Button>
      {open ? (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{t('expiry.posExceptions.explanation')}</p>
          {list.error ? <ProblemAlert problem={problemFromError(list.error)} /> : null}
          {list.isPending ? <p>{t('common.loading')}</p> : null}
          {list.data?.pages
            .flatMap((page) => page.data)
            .map((row) => (
              <ExceptionRow key={`${row.origin}:${row.id}`} row={row} />
            ))}
          {list.data?.pages[0]?.data.length === 0 ? <p>{t('expiry.posExceptions.empty')}</p> : null}
          {list.hasNextPage ? (
            <Button
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
function ExceptionRow({ row }: { row: ExpiryExceptionView }) {
  const { t } = useTranslation();
  const canLiability = useHasPermission('expiry.liability.manage');
  const canPrices = useHasPermission('pricing.prices.manage');
  const mutation = useAcknowledgeExpiryException();
  const [note, setNote] = useState('');
  const [key] = useState(randomUuid);
  return (
    <article className="space-y-2 rounded-md border p-3">
      <p className="font-medium">
        {t('expiry.posExceptions.document', {
          operation: t(`expiry.posExceptions.${row.operation}`),
          id: row.documentId,
          line: row.lineId,
        })}
      </p>
      <p className="text-sm">
        {t('expiry.posExceptions.facts', {
          barcode: row.barcode,
          product: row.productId,
          warehouse: row.warehouseId,
          qty: formatQty(row.qtyBase),
          date: formatUbMinute(row.occurredAt),
        })}
      </p>
      {row.originalSaleId ? (
        <p className="text-sm">
          {t('expiry.posExceptions.original', { id: row.originalSaleId, line: row.originalLineId })}
        </p>
      ) : null}
      <p className="text-sm">{t('expiry.posExceptions.reason', { code: row.reason })}</p>
      <p
        className={
          row.operation === 'RETURN' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
        }
      >
        {t(`expiry.posExceptions.${row.financialEffect}`)}
      </p>
      {row.acknowledgedAt ? (
        <p className="text-sm">
          {t('expiry.posExceptions.acknowledged', {
            date: formatUbMinute(row.acknowledgedAt),
            note: row.acknowledgementNote,
          })}
        </p>
      ) : canLiability && canPrices ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ id: row.id, origin: row.origin, note: note.trim(), key });
          }}
        >
          <Textarea
            aria-label={t('expiry.posExceptions.note')}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
          {mutation.error ? <ProblemAlert problem={problemFromError(mutation.error)} /> : null}
          <Button type="submit" disabled={!note.trim() || mutation.isPending}>
            {t('expiry.posExceptions.acknowledge')}
          </Button>
        </form>
      ) : (
        <p className="text-sm">{t('expiry.posExceptions.unacknowledged')}</p>
      )}
    </article>
  );
}
