import { AGING_BUCKETS } from '@tugeel/shared/finance';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EmptyState, FilterBar, ListCard, LoadMore, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { AllocationDialog } from './allocation-dialog';
import { DateRangeFilter } from './date-range-filter';
import {
  type CustomerBalance,
  type LedgerEntry,
  useCustomerBalance,
  useCustomerLedger,
} from './api';
import { PaymentDialog } from './payment-dialog';

/**
 * One customer's receivables (ADR-0060 #4): the balance with its aging and credit terms, then the
 * ledger newest first with the balance after each entry; «Төлбөр бүртгэх» starts a payment for
 * this customer (`?new=1`), «Тулгалт хийх» pairs its open credits with its invoices by hand
 * (`?allocate=1`, ADR-0090).
 */
export function CustomerLedgerPage() {
  const { t } = useTranslation();
  const customerId = Number.parseInt(useParams().id ?? '', 10);
  const canRecord = useHasPermission('finance.payments.record');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [creating, setCreating] = useCreateParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const allocating = params.get('allocate') === '1';
  const balance = useCustomerBalance(customerId);
  const ledger = useCustomerLedger(customerId, { from, to });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];
  const summary = balance.data;

  const crumbs = [{ label: t('finance.balances.title'), to: '/finance/customers' }];
  // Loading or refused, the page keeps its header and breadcrumb.
  const loadProblem = problemFromError(balance.error);
  if (loadProblem || !summary) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('finance.balances.ledgerTitle')} crumbs={crumbs} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={summary.name}
        crumbs={crumbs}
        meta={
          <>
            <span className="font-mono">{summary.code}</span>
            {summary.creditHold ? (
              <Badge variant="destructive">{t('finance.balances.hold')}</Badge>
            ) : null}
            <Link
              className="text-link underline-offset-2 hover:underline"
              to={`/partners/customers/${customerId}`}
            >
              {t('partners.customer.info')}
            </Link>
          </>
        }
        actions={
          canRecord ? (
            <>
              <Button variant="outline" onClick={() => setParam('allocate', '1')}>
                <ArrowLeftRight />
                {t('finance.allocations.action')}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t('finance.actions.record')}
              </Button>
            </>
          ) : null
        }
      />
      <BalanceCard balance={summary} />
      <section aria-label={t('finance.balances.ledgerTitle')} className="space-y-3">
        <FilterBar>
          <DateRangeFilter
            label={t('finance.fields.date')}
            fromLabel={t('finance.fields.from')}
            toLabel={t('finance.fields.to')}
            from={from}
            to={to}
            onFrom={(value) => setParam('from', value)}
            onTo={(value) => setParam('to', value)}
          />
          {ledger.data?.pages[0] && from ? (
            <span className="text-sm text-muted-foreground">
              {t('finance.fields.opening')}:{' '}
              <span className="font-mono">{formatMnt(ledger.data.pages[0].opening)}</span>
            </span>
          ) : null}
        </FilterBar>
        <ProblemAlert problem={problemFromError(ledger.error)} />
        <ListCard scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.date')}</TableHead>
                <TableHead>{t('finance.fields.kind')}</TableHead>
                <TableHead>{t('finance.balances.document')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.balanceAfter')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.isPending ? <SkeletonRows columns={6} /> : null}
              {rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono">{entry.entryDate}</TableCell>
                  <TableCell>{t(`finance.arKinds.${entry.kind}`)}</TableCell>
                  <TableCell className="font-mono">
                    <DocumentLink entry={entry} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {entry.debit === '0.00' ? '' : formatMnt(entry.debit)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {entry.credit === '0.00' ? '' : formatMnt(entry.credit)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(entry.balanceAfter)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!ledger.isPending && rows.length === 0 ? (
            <EmptyState title={t('finance.balances.ledgerEmpty')} />
          ) : null}
          <LoadMore query={ledger} />
        </ListCard>
      </section>
      <PaymentDialog
        open={creating}
        customer={{ id: summary.customerId, code: summary.code, name: summary.name }}
        onClose={() => setCreating(false)}
        onRecorded={() => setCreating(false)}
      />
      <AllocationDialog
        open={canRecord && allocating}
        customerId={summary.customerId}
        onClose={() => setParam('allocate', null)}
      />
    </div>
  );
}

/**
 * «Тооцоо» (ADR-0060 #4): the balance, the open invoices, the overdue amount and the credit limit
 * as tiles, the aging as a row of smaller ones (ADR-0066: the ledger starts near the top). Tiles
 * wrap by the card's own width, so a side column of the customer page keeps them readable;
 * `compact` (the customer page, whose Credit card shows the limit) leaves the limit and the aging out.
 */
export function BalanceCard({
  balance,
  compact,
  action,
}: {
  balance: CustomerBalance;
  compact?: boolean;
  /** A link in the card's header (the customer page's «Дэвтэр харах»). */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const tiles: { label: string; value: string; hint?: string; danger?: boolean }[] = [
    {
      label: t('finance.fields.balance'),
      value: formatTugrik(balance.balance),
      ...(balance.balance.startsWith('-') ? { hint: t('finance.balances.advance') } : {}),
    },
    { label: t('finance.balances.openInvoices'), value: String(balance.openInvoices) },
    {
      label: t('finance.fields.overdue'),
      value: formatTugrik(balance.overdueAmount),
      danger: balance.overdueAmount !== '0.00',
      ...(balance.oldestDueDate
        ? { hint: `${t('finance.balances.oldestDue')}: ${balance.oldestDueDate}` }
        : {}),
    },
    ...(compact
      ? []
      : [
          {
            label: t('finance.balances.creditLimit'),
            value:
              balance.creditLimit === null
                ? t('finance.balances.noLimit')
                : formatTugrik(balance.creditLimit),
          },
        ]),
  ];
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t('finance.balances.card')}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="@container flex flex-col gap-3">
        <dl
          className={cn('grid grid-cols-2 gap-2', compact ? '@sm:grid-cols-3' : '@2xl:grid-cols-4')}
        >
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0 rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{tile.label}</dt>
              <dd
                className={cn(
                  'truncate font-mono text-[15px] font-semibold',
                  tile.danger && 'text-destructive',
                )}
              >
                {tile.value}
              </dd>
              {tile.hint ? <dd className="text-xs text-muted-foreground">{tile.hint}</dd> : null}
            </div>
          ))}
        </dl>
        {compact ? null : (
          <div role="group" className="flex flex-col gap-1.5" aria-labelledby={`${titleId}-aging`}>
            <h3
              id={`${titleId}-aging`}
              className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {t('finance.balances.aging')}
            </h3>
            <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
              {AGING_BUCKETS.map((bucket) => (
                <div key={bucket} className="min-w-0 rounded-lg bg-fill/60 px-3 py-1.5">
                  <dt className="text-xs text-muted-foreground">{t(`finance.aging.${bucket}`)}</dt>
                  <dd className="truncate font-mono text-sm">
                    {formatTugrik(balance.aging[bucket])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentLink({ entry }: { entry: LedgerEntry }) {
  const to =
    entry.docType === 'INVOICE'
      ? `/finance/invoices?invoice=${entry.docId}`
      : entry.docType === 'PAYMENT'
        ? `/finance/payments?payment=${entry.docId}`
        : entry.docType === 'JOURNAL'
          ? `/finance/journal?entry=${entry.docId}`
          : null;
  return to ? (
    <Link className="text-link underline-offset-2 hover:underline" to={to}>
      {entry.docNumber}
    </Link>
  ) : (
    <span>{entry.docNumber}</span>
  );
}
