import { Decimal } from '@tugeel/shared/money';
import { BadgePercent, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  RowAction,
  RowActions,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PeekLink, type RecordPeek } from '@/features/reports/books/record-peek';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import {
  type CustomerVatTotals,
  type Invoice,
  useCustomerCounterAccount,
  useCustomerVatTotals,
  useInvoices,
  type VatTotalsSide,
} from './api';
import { DateRangeFilter } from './date-range-filter';
import { counterAccountLabel } from './vat-waiver';
import {
  CounterAccountDialog,
  VatWaiverDialog,
  VatWaiverReverseDialog,
} from './vat-waiver-dialogs';

const VAT_FILTERS = ['all', 'takes', 'waived'] as const;
type VatFilter = (typeof VAT_FILTERS)[number];
const isVatFilter = (value: string | null): value is VatFilter =>
  VAT_FILTERS.some((own) => own === value);

/**
 * The sales' columns (ADR-0119). The receipt and the open amount leave first on a narrow table:
 * the invoice's own panel shows both, and what the row is read for — the date, the number, the
 * total, whether VAT is taken and the discount — stays.
 */
const columnsOf = (actions: boolean): readonly ColumnSpec[] => [
  { key: 'date', kind: 'date' },
  { key: 'invoice', kind: 'number' },
  { key: 'total', kind: 'money' },
  { key: 'vat', kind: 'money', drop: 2 },
  { key: 'open', kind: 'money', drop: 1 },
  { key: 'ebarimt', kind: 'text', weight: 1, min: 8, drop: 1 },
  { key: 'state', kind: 'status', width: 6.5 },
  { key: 'discount', kind: 'money' },
  ...(actions ? [{ key: 'actions', kind: 'actions', width: 3.5 } as const] : []),
];

const sum = (a: string, b: string): string => new Decimal(a).plus(b).toFixed(2);

/** The totals of the filter in view: one side, or both added up. */
function sideOf(totals: CustomerVatTotals, filter: VatFilter): VatTotalsSide {
  if (filter === 'takes') return totals.takesVat;
  if (filter === 'waived') return totals.waived;
  const { takesVat: a, waived: b } = totals;
  return {
    count: a.count + b.count,
    total: sum(a.total, b.total),
    vatTotal: sum(a.vatTotal, b.vatTotal),
    openAmount: sum(a.openAmount, b.openAmount),
    waiverAmount: sum(a.waiverAmount, b.waiverAmount),
  };
}

/**
 * «Борлуулалт» of one customer (ADR-0240): the issued invoices of a date range, filtered by
 * whether the customer takes the VAT receipt, with the totals of the filter in view. A holder of
 * `finance.vat_waiver.manage` waives a sale's VAT receipt from its row, or takes that back.
 */
export function CustomerSalesTab({
  customerId,
  onOpen,
}: {
  customerId: number;
  /** Opens a document over the page, as the ledger's rows do. */
  onOpen: (peek: RecordPeek) => void;
}) {
  const { t } = useTranslation();
  const canWaive = useHasPermission('finance.vat_waiver.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const vatParam = params.get('vat');
  const filter: VatFilter = isVatFilter(vatParam) ? vatParam : 'all';
  const [waiving, setWaiving] = useState<Invoice | null>(null);
  const [reversing, setReversing] = useState<Invoice | null>(null);
  const invoices = useInvoices({
    customerId,
    status: 'ISSUED',
    from,
    to,
    ...(filter === 'all' ? {} : { vatWaived: filter === 'waived' }),
  });
  const totals = useCustomerVatTotals(customerId, { from, to });
  const rows = invoices.data?.pages.flatMap((page) => page.data) ?? [];
  const columns = columnsOf(canWaive);

  return (
    <section aria-label={t('finance.vatWaiver.salesLabel')} className="space-y-3">
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
        <SegmentedControl
          name={t('finance.vatWaiver.filter.label')}
          options={VAT_FILTERS}
          value={filter}
          label={(value) => t(`finance.vatWaiver.filter.${value}`)}
          onChange={(value) => setParam('vat', value === 'all' ? null : value)}
        />
      </FilterBar>
      <SalesTotals
        side={totals.data ? sideOf(totals.data, filter) : undefined}
        problem={problemFromError(totals.error)}
        onRetry={totals.refetch}
      />
      <ProblemAlert problem={problemFromError(invoices.error)} onRetry={invoices.refetch} />
      <ListCard scroll>
        <ListTable columns={columns}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.vatWaiver.columns.date')}</TableHead>
              <TableHead>{t('finance.vatWaiver.columns.invoice')}</TableHead>
              <TableHead className="text-right">{t('finance.vatWaiver.columns.total')}</TableHead>
              <TableHead className="text-right">{t('finance.vatWaiver.columns.vat')}</TableHead>
              <TableHead className="text-right">{t('finance.vatWaiver.columns.open')}</TableHead>
              <TableHead>{t('finance.vatWaiver.columns.ebarimt')}</TableHead>
              <TableHead>{t('finance.vatWaiver.columns.state')}</TableHead>
              <TableHead className="text-right">
                {t('finance.vatWaiver.columns.discount')}
              </TableHead>
              {canWaive ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.isPending ? <SkeletonRows columns={columns.length} /> : null}
            {rows.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-mono">{invoice.invoiceDate}</TableCell>
                <TableCell className="font-mono">
                  <PeekLink peek={{ kind: 'invoice', id: invoice.id }} onOpen={onOpen}>
                    {invoice.number}
                  </PeekLink>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatTugrik(invoice.total)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatTugrik(invoice.vatTotal)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatTugrik(invoice.openAmount)}
                </TableCell>
                <TableCell>
                  {invoice.receipt ? (
                    `${t(`finance.ebarimtReceipts.types.${invoice.receipt.receiptType}`)} · ${t(`finance.ebarimtReceipts.statuses.${invoice.receipt.status}`)}`
                  ) : (
                    <span className="text-muted-foreground">
                      {t('finance.vatWaiver.noReceipt')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {invoice.vatWaiver ? (
                    <Badge variant="warning">{t('finance.vatWaiver.waived')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('finance.vatWaiver.takes')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {invoice.vatWaiver ? formatTugrik(invoice.vatWaiver.amount) : ''}
                </TableCell>
                {canWaive ? (
                  <RowActions>
                    {invoice.vatWaiver ? (
                      <RowAction
                        label={t('finance.vatWaiver.rowReverse', { number: invoice.number })}
                        icon={Undo2}
                        onClick={() => setReversing(invoice)}
                      />
                    ) : (
                      <RowAction
                        label={t('finance.vatWaiver.rowAction', { number: invoice.number })}
                        icon={BadgePercent}
                        onClick={() => setWaiving(invoice)}
                      />
                    )}
                  </RowActions>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!invoices.isPending && rows.length === 0 ? (
          <EmptyState
            title={t('finance.vatWaiver.empty')}
            {...(filter === 'all' && !from && !to
              ? {}
              : {
                  onClearFilters: () => {
                    setParam('vat', null);
                    setParam('from', null);
                    setParam('to', null);
                  },
                })}
          />
        ) : null}
        <LoadMore query={invoices} />
      </ListCard>
      {waiving ? <VatWaiverDialog invoice={waiving} onClose={() => setWaiving(null)} /> : null}
      {reversing ? (
        <VatWaiverReverseDialog invoice={reversing} onClose={() => setReversing(null)} />
      ) : null}
    </section>
  );
}

/** The filter's totals as a strip of figures over the list (the ledger's strip, ADR-0216). */
function SalesTotals({
  side,
  problem,
  onRetry,
}: {
  side: VatTotalsSide | undefined;
  problem: ReturnType<typeof problemFromError>;
  onRetry: () => unknown;
}) {
  const { t } = useTranslation();
  if (problem) return <ProblemAlert problem={problem} onRetry={onRetry} />;
  const cells: [string, string | undefined][] = [
    [t('finance.vatWaiver.totals.count'), side && formatCount(side.count)],
    [t('finance.vatWaiver.totals.total'), side && formatTugrik(side.total)],
    [t('finance.vatWaiver.totals.vat'), side && formatTugrik(side.vatTotal)],
    [t('finance.vatWaiver.totals.open'), side && formatTugrik(side.openAmount)],
    [t('finance.vatWaiver.totals.discount'), side && formatTugrik(side.waiverAmount)],
  ];
  return (
    <section aria-label={t('finance.vatWaiver.totals.label')} className="@container">
      <dl className="grid grid-cols-2 gap-2 @xl:grid-cols-3 @4xl:grid-cols-5">
        {cells.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-lg border border-border bg-card px-3 py-2 shadow-card"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono text-[0.9375rem] font-medium">{value ?? '…'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * «Харилцсан данс» under the customer's «Тооцоо» card (ADR-0240): what a VAT waiver of this
 * customer debits, for everyone who reads finance; «Солих» for `finance.settings.manage`.
 */
export function CounterAccountRow({ customer }: { customer: { id: number; name: string } }) {
  const { t } = useTranslation();
  const plain = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const canManage = useHasPermission('finance.settings.manage');
  const account = useCustomerCounterAccount(customer.id);
  const [editing, setEditing] = useState(false);
  const problem = problemFromError(account.error);
  if (problem) return <ProblemAlert problem={problem} onRetry={account.refetch} />;
  return (
    <section
      aria-label={t('finance.vatWaiver.counterAccount.label')}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm shadow-card"
    >
      <span className="text-muted-foreground">{t('finance.vatWaiver.counterAccount.label')}</span>
      <span className="font-medium">{counterAccountLabel(account.data, plain)}</span>
      <span className="text-xs text-muted-foreground">
        {t('finance.vatWaiver.counterAccount.hint')}
      </span>
      {canManage && account.data ? (
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          aria-label={t('finance.vatWaiver.counterAccount.changeLabel')}
          onClick={() => setEditing(true)}
        >
          <Pencil />
          {t('finance.vatWaiver.counterAccount.change')}
        </Button>
      ) : null}
      {editing && account.data ? (
        <CounterAccountDialog
          customer={customer}
          current={account.data}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </section>
  );
}
