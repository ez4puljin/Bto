import { WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
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
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import { DateRangeFilter } from './date-range-filter';
import { useCashBook, useMoneyAccounts } from './api';
import { PaymentKindBadge } from './badges';

/**
 * The cash and bank books (ADR-0060 #5): every money account as a small card with its balance (as
 * many to a row as fit); the chosen one's vouchers newest first with the balance after each
 * (`?account=`, dates `?from=&to=`). Cards carry ₮, the book plain figures (ADR-0066).
 */
export function CashPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const accounts = useMoneyAccounts();
  const chosen = Number.parseInt(params.get('account') ?? '', 10);
  const accountId = chosen > 0 ? chosen : (accounts.data?.[0]?.id ?? null);
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const book = useCashBook(accountId, { from, to });
  const rows = book.data?.pages.flatMap((page) => page.data) ?? [];
  const account = accounts.data?.find((entry) => entry.id === accountId);

  return (
    <div className="space-y-4">
      <PageHeader title={t('finance.cash.title')} />
      <ProblemAlert problem={problemFromError(accounts.error)} />
      {accounts.data && accounts.data.length === 0 ? (
        <ListCard>
          <EmptyState icon={WalletCards} title={t('finance.cash.noAccounts')} />
        </ListCard>
      ) : null}
      <nav
        aria-label={t('finance.cash.accounts')}
        className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3"
      >
        {(accounts.data ?? []).map((entry) => (
          <Link
            key={entry.id}
            to={hrefWithParam(params, 'account', String(entry.id))}
            aria-current={entry.id === accountId ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3.5 py-3 shadow-card transition-[box-shadow,border-color] hover:shadow-popover',
              entry.id === accountId ? 'border-ring ring-2 ring-ring/30' : 'border-border',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold" title={entry.name}>
                {entry.name}
              </span>
              <Badge variant="outline">{t(`finance.moneyKinds.${entry.kind}`)}</Badge>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {entry.code}
              {entry.branchName ? ` · ${entry.branchName}` : ''}
              {entry.bankAccountNo ? ` · ${entry.bankAccountNo}` : ''}
            </span>
            <span className="font-mono text-lg font-semibold">{formatTugrik(entry.balance)}</span>
          </Link>
        ))}
      </nav>
      {account ? (
        <section aria-label={t('finance.cash.book')} className="space-y-3">
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
            {book.data?.pages[0] && from ? (
              <span className="text-sm text-muted-foreground">
                {t('finance.fields.opening')}:{' '}
                <span className="font-mono">{formatMnt(book.data.pages[0].opening)}</span>
              </span>
            ) : null}
          </FilterBar>
          <ProblemAlert problem={problemFromError(book.error)} />
          <ListCard scroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.fields.date')}</TableHead>
                  <TableHead>{t('finance.fields.number')}</TableHead>
                  <TableHead>{t('finance.fields.kind')}</TableHead>
                  <TableHead>{t('finance.cash.party')}</TableHead>
                  <TableHead className="text-right">{t('finance.cash.in')}</TableHead>
                  <TableHead className="text-right">{t('finance.cash.out')}</TableHead>
                  <TableHead className="text-right">{t('finance.fields.balanceAfter')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {book.isPending ? <SkeletonRows columns={7} /> : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono">{row.paidOn}</TableCell>
                    <TableCell className="font-mono">
                      <Link
                        className="text-link underline-offset-2 hover:underline"
                        to={`/finance/payments?payment=${row.id}`}
                      >
                        {row.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <PaymentKindBadge kind={row.kind} />
                    </TableCell>
                    <TruncateCell
                      text={row.customerName ?? row.counterpartyName ?? row.glAccountName ?? ''}
                    />
                    <TableCell className="text-right font-mono">
                      {row.direction === 'IN' ? formatMnt(row.amount) : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.direction === 'OUT' ? formatMnt(row.amount) : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMnt(row.balanceAfter)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!book.isPending && rows.length === 0 ? (
              <EmptyState title={t('finance.cash.empty')} />
            ) : null}
            <LoadMore query={book} />
          </ListCard>
        </section>
      ) : null}
    </div>
  );
}
