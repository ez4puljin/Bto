import { AGING_BUCKETS } from '@tugeel/shared/finance';
import { Landmark } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
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
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useCustomerBalances } from './api';

/**
 * Who owes what (ADR-0060 #4): every customer with a ledger, largest balance first, with the open
 * invoices, the overdue amount and the aging; a row opens the customer's ledger.
 */
export function CustomerBalancesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const overdue = params.get('overdue') === '1' ? true : undefined;
  const balances = useCustomerBalances({ q, overdue });
  const rows = balances.data?.pages.flatMap((page) => page.data) ?? [];

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
      <ListCard>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.customer')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.balance')}</TableHead>
                <TableHead className="text-right">{t('finance.balances.openInvoices')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.overdue')}</TableHead>
                {AGING_BUCKETS.map((bucket) => (
                  <TableHead key={bucket} className="text-right">
                    {t(`finance.aging.${bucket}`)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t('finance.balances.creditLimit')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.isPending ? <SkeletonRows columns={10} /> : null}
              {rows.map((row) => (
                <LinkRow key={row.customerId} to={`/finance/customers/${row.customerId}`}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{row.name}</span>
                      <span className="font-mono text-muted-foreground">{row.code}</span>
                      {row.creditHold ? (
                        <Badge variant="destructive">{t('finance.balances.hold')}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMnt(row.balance)}</TableCell>
                  <TableCell className="text-right font-mono">{row.openInvoices}</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.overdueAmount === '0.00' ? '' : formatMnt(row.overdueAmount)}
                  </TableCell>
                  {AGING_BUCKETS.map((bucket) => (
                    <TableCell key={bucket} className="text-right font-mono text-muted-foreground">
                      {row.aging[bucket] === '0.00' ? '' : formatMnt(row.aging[bucket])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono">
                    {row.creditLimit === null
                      ? t('finance.balances.noLimit')
                      : formatMnt(row.creditLimit)}
                  </TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!balances.isPending && rows.length === 0 ? (
          <EmptyState icon={Landmark} title={t('finance.balances.empty')} />
        ) : null}
        <LoadMore query={balances} />
      </ListCard>
    </div>
  );
}
