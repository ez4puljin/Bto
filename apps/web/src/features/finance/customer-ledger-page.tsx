import { AGING_BUCKETS } from '@tugeel/shared/finance';
import { Plus } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { FieldList } from '@/components/detail';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useCreateParam } from '@/lib/use-create-param';
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
 * this customer (`?new=1`).
 */
export function CustomerLedgerPage() {
  const { t } = useTranslation();
  const customerId = Number.parseInt(useParams().id ?? '', 10);
  const canRecord = useHasPermission('finance.payments.record');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useCreateParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const balance = useCustomerBalance(customerId);
  const ledger = useCustomerLedger(customerId, { from, to });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];
  const summary = balance.data;

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const loadProblem = problemFromError(balance.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!summary) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={summary.name}
        crumbs={[{ label: t('finance.balances.title'), to: '/finance/customers' }]}
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
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('finance.actions.record')}
            </Button>
          ) : null
        }
      />
      <BalanceCard balance={summary} />
      <section aria-label={t('finance.balances.ledgerTitle')} className="space-y-3">
        <FilterBar>
          <DateFilter
            label={t('finance.fields.from')}
            value={from}
            onChange={(value) => setParam('from', value)}
          />
          <DateFilter
            label={t('finance.fields.to')}
            value={to}
            onChange={(value) => setParam('to', value)}
          />
          {ledger.data?.pages[0] && from ? (
            <span className="text-sm text-muted-foreground">
              {t('finance.fields.opening')}:{' '}
              <span className="font-mono">{formatMnt(ledger.data.pages[0].opening)}</span>
            </span>
          ) : null}
        </FilterBar>
        <ProblemAlert problem={problemFromError(ledger.error)} />
        <ListCard>
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
    </div>
  );
}

/** The balance, the overdue amount, the aging and the credit terms of a customer. */
export function BalanceCard({ balance, compact }: { balance: CustomerBalance; compact?: boolean }) {
  const { t } = useTranslation();
  const titleId = useId();
  const items = [
    {
      label: t('finance.fields.balance'),
      value: <span className="font-mono">{formatMnt(balance.balance)}</span>,
      hint: balance.balance.startsWith('-') ? t('finance.balances.advance') : undefined,
    },
    { label: t('finance.balances.openInvoices'), value: String(balance.openInvoices) },
    {
      label: t('finance.fields.overdue'),
      value: (
        <span className={balance.overdueAmount === '0.00' ? '' : 'font-mono text-destructive'}>
          {formatMnt(balance.overdueAmount)}
        </span>
      ),
      hint: balance.oldestDueDate
        ? `${t('finance.balances.oldestDue')}: ${balance.oldestDueDate}`
        : undefined,
    },
    {
      label: t('finance.balances.creditLimit'),
      value:
        balance.creditLimit === null
          ? t('finance.balances.noLimit')
          : formatMnt(balance.creditLimit),
    },
    ...(compact
      ? []
      : [
          {
            label: t('finance.balances.aging'),
            value: (
              <span className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm">
                {AGING_BUCKETS.map((bucket) => (
                  <span key={bucket}>
                    <span className="text-muted-foreground">{t(`finance.aging.${bucket}`)}: </span>
                    {formatMnt(balance.aging[bucket])}
                  </span>
                ))}
              </span>
            ),
          },
        ]),
  ];
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t('finance.balances.card')}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldList items={items} />
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
