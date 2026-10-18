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
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
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
import { useCustomerBalances } from './api';

/**
 * Who owes what (ADR-0060 #4): every customer with a ledger, largest balance first, with the open
 * invoices, the overdue amount and the aging; a row opens the customer's ledger. The aging buckets
 * are plain figures under one «Насжилт (₮)» header, so the table fits a laptop (ADR-0066).
 */
/** A header of two lines beside the aging group (rows of numbers below it stay narrow). */
const WRAPPING_HEAD = 'max-w-28 text-right whitespace-normal';

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
      <ProblemAlert problem={problemFromError(balances.error)} />
      <ListCard scroll>
        <Table>
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
                {t('finance.balances.creditLimit')}
              </TableHead>
              <TableHead aria-hidden rowSpan={2} className="w-9 pl-0" />
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
            {balances.isPending ? <SkeletonRows columns={AGING_BUCKETS.length + 6} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.customerId} to={`/finance/customers/${row.customerId}`}>
                <TruncateCell text={`${row.name} · ${row.code}`} fill className="min-w-44">
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
                <TableCell className="text-right font-mono">
                  {row.overdueAmount === '0.00' ? '' : formatTugrik(row.overdueAmount)}
                </TableCell>
                {AGING_BUCKETS.map((bucket) => (
                  <TableCell key={bucket} className="text-right font-mono text-muted-foreground">
                    {row.aging[bucket] === '0.00' ? '' : formatMnt(row.aging[bucket])}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono">
                  {row.creditLimit === null
                    ? t('finance.balances.noLimit')
                    : formatTugrik(row.creditLimit)}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!balances.isPending && rows.length === 0 ? (
          <EmptyState icon={Landmark} title={t('finance.balances.empty')} />
        ) : null}
        <LoadMore query={balances} />
      </ListCard>
    </div>
  );
}
