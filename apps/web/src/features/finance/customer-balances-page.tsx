import { AGING_BUCKETS } from '@tugeel/shared/finance';
import { Landmark } from 'lucide-react';
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
 * are plain figures under heads of two lines («1–30 хоног»), one row of heads with a cell per
 * column: a head across the buckets would keep every column in a narrow table (ADR-0201).
 */
/** A head of two lines over a narrow column of figures. */
const WRAPPING_HEAD = 'text-right whitespace-normal';

/**
 * One entry per column (ADR-0119): the customer, three figures, the aging, group, limit. A table
 * too narrow for all twelve (ADR-0201) lets the group and the limit go first, then the count of
 * invoices, then the aging — the customer's ledger shows them all; the customer, the balance and
 * the overdue amount stay. In rem: 94.25 whole (a monitor's 97), 78.25 on a 1536 laptop (86),
 * 72.25 on a 1366 one (76), 32.25 on a till PC (56) and a tablet (41). The count's column is as
 * wide as its head's longer word.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'customer', kind: 'text', weight: 3, min: 12 },
  { key: 'balance', kind: 'money', width: 9 },
  { key: 'openInvoices', kind: 'count', width: 6, drop: 2 },
  { key: 'overdue', kind: 'money', width: 9 },
  ...AGING_BUCKETS.map((bucket): ColumnSpec => ({ key: bucket, kind: 'money', width: 8, drop: 3 })),
  { key: 'settlementGroup', kind: 'text', weight: 1, drop: 1 },
  { key: 'creditLimit', kind: 'money', width: 9, drop: 1 },
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
              <TableHead>{t('finance.fields.customer')}</TableHead>
              <TableHead className={WRAPPING_HEAD}>{t('finance.fields.balance')}</TableHead>
              <TableHead className={WRAPPING_HEAD}>{t('finance.balances.openInvoices')}</TableHead>
              <TableHead className={WRAPPING_HEAD}>{t('finance.fields.overdue')}</TableHead>
              {AGING_BUCKETS.map((bucket) => (
                <TableHead key={bucket} className={WRAPPING_HEAD}>
                  {t(`finance.aging.${bucket}`)}
                </TableHead>
              ))}
              <TableHead className={WRAPPING_HEAD}>{t('partners.settlement.group')}</TableHead>
              <TableHead className={WRAPPING_HEAD}>{t('finance.balances.creditLimit')}</TableHead>
              <ChevronHead />
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
