import { AGING_BUCKETS } from '@tugeel/shared/finance';
import { Landmark } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
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
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useCustomerBalances } from './api';

/**
 * Who owes what (ADR-0060 #4): every customer with a ledger, largest balance first, with the open
 * invoices, the overdue amount and the aging; a row opens the customer's ledger. The aging buckets
 * are plain figures under one «Насжилт (₮)» header, so the table fits a laptop (ADR-0066).
 */
/** A header of two lines beside the aging group (rows of numbers below it stay narrow). */
const WRAPPING_HEAD = 'text-right whitespace-normal';

/** One entry per leaf column (ADR-0119): the customer, three figures, the aging, group, limit. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'customer', kind: 'text', weight: 3, min: 14 },
  { key: 'balance', kind: 'money', width: 10 },
  { key: 'openInvoices', kind: 'count' },
  { key: 'overdue', kind: 'money', width: 10 },
  ...AGING_BUCKETS.map((bucket): ColumnSpec => ({ key: bucket, kind: 'money' })),
  { key: 'settlementGroup', kind: 'text', weight: 1 },
  { key: 'creditLimit', kind: 'money', width: 10 },
  { key: 'chevron', kind: 'chevron' },
];

export function CustomerBalancesPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const overdue = params.get('overdue') === '1' ? true : undefined;
  const balances = useCustomerBalances({ q, overdue });
  const rows = balances.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader title={t('finance.balances.title')} />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('finance.balances.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <FilterToggle
          label={t('finance.balances.overdueOnly')}
          checked={overdue === true}
          onCheckedChange={(checked) => setParam('overdue', checked ? '1' : undefined)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(balances.error)} onRetry={balances.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>{t('finance.fields.customer')}</TableHead>
              <TableHead rowSpan={2} className={WRAPPING_HEAD}>
                {t('finance.fields.balance')}
              </TableHead>
              <TableHead rowSpan={2} className={WRAPPING_HEAD}>
                {t('finance.balances.openInvoices')}
              </TableHead>
              <TableHead rowSpan={2} className={WRAPPING_HEAD}>
                {t('finance.fields.overdue')}
              </TableHead>
              <TableHead colSpan={AGING_BUCKETS.length} className="h-7 text-center">
                {t('finance.balances.agingGroup')}
              </TableHead>
              <TableHead rowSpan={2} className={WRAPPING_HEAD}>
                {t('partners.settlement.group')}
              </TableHead>
              <TableHead rowSpan={2} className={WRAPPING_HEAD}>
                {t('finance.balances.creditLimit')}
              </TableHead>
              {/* ChevronHead takes no rowSpan: the chevron's head spans both rows by hand. */}
              <TableHead aria-hidden rowSpan={2} className="pl-0" />
            </TableRow>
            <TableRow>
              {AGING_BUCKETS.map((bucket) => (
                // The second header row sticks under the first one in a scrolling card.
                <TableHead key={bucket} className="h-7 text-right top-7!">
                  {t(`finance.agingShort.${bucket}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.isPending ? <SkeletonRows columns={AGING_BUCKETS.length + 7} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.customerId} to={`/finance/customers/${row.customerId}`}>
                <TruncateCell text={`${row.name} · ${row.code}`}>
                  <Link
                    to={`/finance/customers/${row.customerId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="ml-2 font-mono text-muted-foreground">{row.code}</span>
                  {row.creditHold ? (
                    <Badge variant="destructive" className="ml-2">
                      {t('finance.balances.hold')}
                    </Badge>
                  ) : null}
                </TruncateCell>
                <TableCell className="text-right font-mono">{formatTugrik(row.balance)}</TableCell>
                <TableCell className="text-right font-mono">{row.openInvoices}</TableCell>
                {/* An overdue debt only reminds, in red (ADR-0101). */}
                <TableCell className="text-right font-mono font-medium text-destructive">
                  {row.overdueAmount === '0.00' ? '' : formatTugrik(row.overdueAmount)}
                </TableCell>
                {AGING_BUCKETS.map((bucket) => (
                  <TableCell key={bucket} className="text-right font-mono text-muted-foreground">
                    {row.aging[bucket] === '0.00' ? '' : formatMnt(row.aging[bucket])}
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap">
                  {t(`partners.settlement.groups.${row.settlementGroup}`)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.creditLimit === null
                    ? t('finance.balances.noLimit')
                    : formatTugrik(row.creditLimit)}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!balances.isPending && rows.length === 0 ? (
          <EmptyState icon={Landmark} title={t('finance.balances.empty')} />
        ) : null}
        <LoadMore query={balances} />
      </ListCard>
    </div>
  );
}
