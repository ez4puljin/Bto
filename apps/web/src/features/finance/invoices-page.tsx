import { SETTLEMENTS } from '@tugeel/shared/finance';
import { FileText } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { DateRangeFilter } from './date-range-filter';
import { type Settlement, useInvoices } from './api';
import { SettlementBadge } from './badges';
import { InvoicePanel } from './invoice-panel';

const isSettlement = (value: string | null): value is Settlement =>
  SETTLEMENTS.some((entry) => entry === value);

/** The list's columns (ADR-0119): number, two dates, the customer, two amounts, the status. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'date', kind: 'date' },
  { key: 'dueDate', kind: 'date' },
  { key: 'customer', kind: 'text', weight: 3, min: 14 },
  { key: 'total', kind: 'money', width: 10 },
  { key: 'open', kind: 'money', width: 10 },
  { key: 'status', kind: 'status', width: 11 },
  { key: 'chevron', kind: 'chevron' },
];

/**
 * Invoices (ADR-0060 #11): the sale issues them; the accountant searches by number, order or
 * customer, filters by settlement, overdue and dates, and opens one in the panel (`?invoice=`).
 */
export function InvoicesPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const settlementParam = params.get('settlement');
  const settlement = isSettlement(settlementParam) ? settlementParam : undefined;
  const status = settlementParam === 'VOID' ? ('VOID' as const) : undefined;
  const overdue = params.get('overdue') === '1' ? true : undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('invoice') ?? '', 10);
  const invoices = useInvoices({ q, settlement, status, overdue, from, to });
  const rows = invoices.data?.pages.flatMap((page) => page.data) ?? [];
  const total = invoices.data?.pages[0]?.total ?? null;

  return (
    <div>
      <PageHeader
        title={t('finance.invoices.title')}
        meta={total !== null ? t('finance.invoices.count', { count: total }) : undefined}
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('finance.invoices.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.status')}
          value={settlementParam ?? ''}
          onChange={(event) => setParam('settlement', event.target.value)}
        >
          <option value="">{t('finance.invoices.allSettlements')}</option>
          {SETTLEMENTS.map((value) => (
            <option key={value} value={value}>
              {t(`finance.settlements.${value}`)}
            </option>
          ))}
          <option value="VOID">{t('finance.invoices.voidOnly')}</option>
        </NativeSelect>
        <FilterToggle
          label={t('finance.invoices.overdueOnly')}
          checked={overdue === true}
          onCheckedChange={(checked) => setParam('overdue', checked ? '1' : undefined)}
        />
        <DateRangeFilter
          label={t('finance.fields.date')}
          fromLabel={t('finance.fields.from')}
          toLabel={t('finance.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(invoices.error)} onRetry={invoices.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.number')}</TableHead>
              <TableHead>{t('finance.fields.date')}</TableHead>
              <TableHead>{t('finance.fields.dueDate')}</TableHead>
              <TableHead>{t('finance.fields.customer')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.total')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.open')}</TableHead>
              <TableHead>{t('finance.fields.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((invoice) => {
              // The number is the row's link for the keyboard; a click anywhere opens the panel.
              const href = hrefWithParam(params, 'invoice', String(invoice.id));
              return (
                <LinkRow key={invoice.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {invoice.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">{invoice.invoiceDate}</TableCell>
                  <TableCell className="font-mono">{invoice.dueDate}</TableCell>
                  <TruncateCell text={invoice.customerName} />
                  <TableCell className="text-right font-mono">
                    {formatTugrik(invoice.total)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(invoice.openAmount)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <SettlementBadge
                        settlement={invoice.settlement}
                        status={invoice.status}
                        overdue={invoice.overdue}
                      />
                    </span>
                  </TableCell>
                </LinkRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!invoices.isPending && rows.length === 0 ? (
          <EmptyState icon={FileText} title={t('finance.invoices.empty')} />
        ) : null}
        <LoadMore query={invoices} />
      </ListCard>
      <InvoicePanel
        invoiceId={openId > 0 ? openId : null}
        onClose={() => setParam('invoice', null)}
      />
    </div>
  );
}
