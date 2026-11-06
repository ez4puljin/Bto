import { ACCOUNT_JOURNALS, type AccountJournal } from '@tugeel/shared/finance';
import { ArrowLeftRight, BookOpenText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useCreateParam } from '@/lib/use-create-param';
import { useJournal } from './api';
import { SourceBadge } from './badges';
import { DateRangeFilter } from './date-range-filter';
import { TransactionDialog } from './transaction-dialog';

/** Erkhet's menu order; «Мөнгөн хөрөнгө» alone holds no account, so it has no tab. */
const TABS = ACCOUNT_JOURNALS.filter((journal) => journal !== 'MONEY');

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'date', kind: 'date' },
  { key: 'description', kind: 'text', weight: 3, min: 14 },
  { key: 'source', kind: 'status' },
  { key: 'amount', kind: 'money' },
  { key: 'lines', kind: 'count' },
  { key: 'chevron', kind: 'chevron' },
];

/**
 * «Гүйлгээ» (ADR-0150): the transactions by the account's journal, like Erkhet's menus: a tab per
 * journal lists every entry touching its accounts, from any source, and «Шинэ гүйлгээ» opens that
 * journal's form. A row opens the entry on the journal's page, where a manual one is reversed.
 * Stock accounts only list: they move through the warehouse's documents.
 */
export function TransactionsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const canPost = useHasPermission('finance.journal.manage');
  const [creating, setCreating] = useCreateParam();
  const requested = params.get('journal');
  const journal: AccountJournal = TABS.find((tab) => tab === requested) ?? 'CASH';
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const entries = useJournal({ from, to, journal });
  const rows = entries.data?.pages.flatMap((page) => page.data) ?? [];
  const postable = journal !== 'INVENTORY';

  return (
    <div>
      <PageHeader
        title={t('finance.transactions.title')}
        description={t('finance.transactions.description')}
        actions={
          canPost && postable ? (
            <>
              <Button variant="outline" onClick={() => setParam('transfer', '1')}>
                <ArrowLeftRight />
                {t('finance.transactions.transfer.button')}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t('finance.transactions.create')}
              </Button>
            </>
          ) : null
        }
      />
      <div className="mb-3 overflow-x-auto">
        <SegmentedControl
          name={t('finance.fields.kind')}
          options={TABS}
          value={journal}
          label={(value) => t(`finance.transactions.tabs.${value}`)}
          onChange={(value) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set('journal', value);
                return next;
              },
              { replace: true },
            )
          }
        />
      </div>
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
      </FilterBar>
      {postable ? null : (
        <Alert className="mb-3">
          <AlertDescription>
            {t('finance.transactions.stockNote')}{' '}
            <Link to="/inventory/receipts" className="text-link hover:underline">
              {t('finance.transactions.toReceipts')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <ProblemAlert problem={problemFromError(entries.error)} onRetry={entries.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.number')}</TableHead>
              <TableHead>{t('finance.fields.date')}</TableHead>
              <TableHead>{t('finance.fields.description')}</TableHead>
              <TableHead>{t('finance.fields.source')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.amount')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.lines')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((entry) => (
              <LinkRow key={entry.id} to={`/finance/journal?entry=${entry.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/finance/journal?entry=${entry.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {entry.number}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{entry.entryDate}</TableCell>
                <TruncateCell text={entry.description} />
                <TableCell>
                  <SourceBadge source={entry.source} />
                </TableCell>
                <TableCell className="text-right font-mono">{formatMnt(entry.amount)}</TableCell>
                <TableCell className="text-right font-mono">{entry.lineCount}</TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!entries.isPending && rows.length === 0 ? (
          <EmptyState icon={BookOpenText} title={t('finance.transactions.empty')} />
        ) : null}
        <LoadMore query={entries} />
      </ListCard>
      {creating && postable ? (
        <TransactionDialog journal={journal} onClose={() => setCreating(false)} />
      ) : null}
      {params.get('transfer') === '1' && postable ? (
        <TransactionDialog journal={journal} transfer onClose={() => setParam('transfer', null)} />
      ) : null}
    </div>
  );
}
