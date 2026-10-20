import { ArrowLeftRight, Truck } from 'lucide-react';
import { useDeferredValue, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
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
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { AllocationDialog } from './allocation-dialog';
import {
  type PayableEntry,
  type SupplierBalance,
  useSupplierBalance,
  useSupplierBalances,
  useSupplierLedger,
} from './api';
import { DateRangeFilter } from './date-range-filter';

/**
 * «Нийлүүлэгчийн тооцоо» (F3, ADR-0091): every supplier with payables, largest owed first, with the
 * date of its oldest open bill; a row opens the supplier's ledger.
 */
export function SupplierBalancesPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const balances = useSupplierBalances({ q });
  const rows = balances.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader title={t('finance.payables.title')} />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('finance.payables.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(balances.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.supplier')}</TableHead>
              <TableHead className="text-right">{t('finance.payables.owed')}</TableHead>
              <TableHead className="text-right">{t('finance.payables.oldestBill')}</TableHead>
              <TableHead aria-hidden className="w-9 pl-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.isPending ? <SkeletonRows columns={4} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.supplierId} to={`/finance/suppliers/${row.supplierId}`}>
                <TruncateCell text={`${row.name} · ${row.code}`} fill className="min-w-44">
                  <Link
                    to={`/finance/suppliers/${row.supplierId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="ml-2 font-mono text-muted-foreground">{row.code}</span>
                </TruncateCell>
                <TableCell className="text-right font-mono">{formatTugrik(row.balance)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {row.oldestBillDate ?? ''}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!balances.isPending && rows.length === 0 ? (
          <EmptyState icon={Truck} title={t('finance.payables.empty')} />
        ) : null}
        <LoadMore query={balances} />
      </ListCard>
    </div>
  );
}

/**
 * One supplier's payables (F3, ADR-0091): what the company owes, then the ledger newest first
 * (receipts' bills and their price corrections, returns, manual entries) with what is owed after
 * each line; «Тулгалт хийх» pairs a payment or a return with the open bills (`?allocate=1`).
 * Payments are manual journal entries (owner, 2026-10-20), which the card says.
 */
export function SupplierLedgerPage() {
  const { t } = useTranslation();
  const supplierId = Number.parseInt(useParams().id ?? '', 10);
  const canRecord = useHasPermission('finance.payments.record');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const allocating = params.get('allocate') === '1';
  const balance = useSupplierBalance(supplierId);
  const ledger = useSupplierLedger(supplierId, { from, to });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];
  const summary = balance.data;

  const crumbs = [{ label: t('finance.payables.title'), to: '/finance/suppliers' }];
  const loadProblem = problemFromError(balance.error);
  if (loadProblem || !summary) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('finance.payables.ledgerTitle')} crumbs={crumbs} />
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
            <Link
              className="text-link underline-offset-2 hover:underline"
              to={`/partners/suppliers/${supplierId}`}
            >
              {t('finance.payables.supplierInfo')}
            </Link>
          </>
        }
        actions={
          canRecord ? (
            <Button variant="outline" onClick={() => setParam('allocate', '1')}>
              <ArrowLeftRight />
              {t('finance.allocations.action')}
            </Button>
          ) : null
        }
      />
      <PayableCard balance={summary} />
      <section aria-label={t('finance.payables.ledgerTitle')} className="space-y-3">
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
                <TableHead className="text-right">{t('finance.payables.owedAfter')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.isPending ? <SkeletonRows columns={6} /> : null}
              {rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono">{entry.entryDate}</TableCell>
                  <TableCell>{t(`finance.apKinds.${entry.kind}`)}</TableCell>
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
            <EmptyState title={t('finance.payables.ledgerEmpty')} />
          ) : null}
          <LoadMore query={ledger} />
        </ListCard>
      </section>
      <AllocationDialog
        open={canRecord && allocating}
        party={{ kind: 'supplier', id: summary.supplierId }}
        onClose={() => setParam('allocate', null)}
      />
    </div>
  );
}

/** What the company owes the supplier, the oldest open bill, and how a payment is recorded. */
function PayableCard({ balance }: { balance: SupplierBalance }) {
  const { t } = useTranslation();
  const titleId = useId();
  const prepaid = balance.balance.startsWith('-');
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t('finance.payables.card')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t('finance.payables.owed')}</dt>
            <dd className="truncate font-mono text-[15px] font-semibold">
              {formatTugrik(balance.balance)}
            </dd>
            {prepaid ? (
              <dd className="text-xs text-muted-foreground">{t('finance.payables.prepaid')}</dd>
            ) : null}
          </div>
          <div className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t('finance.payables.oldestBill')}</dt>
            <dd className="truncate font-mono text-[15px] font-semibold">
              {balance.oldestBillDate ?? '—'}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{t('finance.payables.howToPay')}</p>
      </CardContent>
    </Card>
  );
}

function DocumentLink({ entry }: { entry: PayableEntry }) {
  const to =
    entry.docType === 'RECEIPT'
      ? `/inventory/receipts/${entry.docId}`
      : entry.docType === 'ISSUE'
        ? `/inventory/issues/${entry.docId}`
        : `/finance/journal?entry=${entry.docId}`;
  return (
    <Link className="text-link underline-offset-2 hover:underline" to={to}>
      {entry.docNumber}
    </Link>
  );
}
