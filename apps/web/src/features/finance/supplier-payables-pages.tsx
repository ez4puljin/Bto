import { ClipboardCheck, Plus, Truck } from 'lucide-react';
import { useDeferredValue, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { NativeSelect } from '@/components/native-select';
import { useSupplierCategories } from '@/features/partners/api';
import { SegmentFilter } from '@/features/segments/segment-filter';
import {
  type PayableEntry,
  type SupplierBalance,
  useSupplierBalance,
  useSupplierBalances,
  useSupplierLedger,
} from './api';
import { erkhetKeysOf, useErkhetLinks } from '@/features/erkhet/api';
import { ErkhetDocument, ErkhetKind } from '@/features/erkhet/erkhet-entry';
import { DateRangeFilter } from './date-range-filter';

/**
 * The balances' columns (ADR-0119; owner 2026-11-27): code, name, the supplier's category, its
 * segments, what is owed and the newest bill's date.
 */
const BALANCE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'category', kind: 'text', weight: 2, min: 8, drop: 2 },
  { key: 'segment', kind: 'text', weight: 2, min: 8, drop: 1 },
  { key: 'balance', kind: 'money', width: 10 },
  { key: 'latestBill', kind: 'date', width: 8.5 },
  { key: 'chevron', kind: 'chevron' },
];

/** The ledger's columns: date, kind, document, who confirmed it, two sides, owed after. */
const LEDGER_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date' },
  { key: 'kind', kind: 'text', weight: 1 },
  { key: 'document', kind: 'number' },
  { key: 'confirmedBy', kind: 'text', weight: 1, min: 8, drop: 1 },
  { key: 'debit', kind: 'money' },
  { key: 'credit', kind: 'money' },
  { key: 'owedAfter', kind: 'money', width: 10 },
];

/** A positive id from the URL, else undefined. */
function idParam(params: URLSearchParams, name: string): number | undefined {
  const value = Number.parseInt(params.get(name) ?? '', 10);
  return Number.isNaN(value) || value <= 0 ? undefined : value;
}

/**
 * «Нийлүүлэгчийн тооцоо» (F3, ADR-0091): every supplier with payables, largest owed first, found
 * by name or code and narrowed by its category and segment; a row opens the supplier's ledger.
 */
export function SupplierBalancesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const canManageSegments = useHasPermission('segments.manage');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = idParam(params, 'category');
  const segmentId = idParam(params, 'segment');
  const categories = useSupplierCategories();
  const balances = useSupplierBalances({ q, categoryId, segmentId });
  const rows = balances.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(q || categoryId || segmentId);

  return (
    <div>
      <PageHeader
        title={t('finance.payables.title')}
        actions={
          canManageSegments ? (
            <Button variant="outline" asChild>
              <Link to="/segments/new?entity=SUPPLIER">
                <Plus />
                {t('finance.payables.createSegment')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          className="sm:w-60"
          aria-label={t('finance.fields.supplier')}
          placeholder={t('finance.payables.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('finance.payables.category')}
          value={categoryId ?? ''}
          onChange={(event) => setParam('category', event.target.value)}
        >
          <option value="">{t('partners.suppliers.allCategories')}</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </NativeSelect>
        <SegmentFilter
          entity="SUPPLIER"
          value={segmentId}
          onChange={(id) => setParam('segment', id ? String(id) : '')}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(balances.error)} onRetry={balances.refetch} />
      <ListCard scroll>
        <ListTable columns={BALANCE_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.payables.code')}</TableHead>
              <TableHead>{t('finance.payables.name')}</TableHead>
              <TableHead>{t('finance.payables.category')}</TableHead>
              <TableHead>{t('finance.payables.segment')}</TableHead>
              <TableHead className="text-right">{t('finance.payables.balance')}</TableHead>
              <TableHead className="text-right" title={t('finance.payables.latestBillHint')}>
                {t('finance.payables.latestBill')}
              </TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => {
              const segments = row.segments.map((segment) => segment.name).join(', ');
              return (
                <LinkRow key={row.supplierId} to={`/finance/suppliers/${row.supplierId}`}>
                  <TableCell className="font-mono text-muted-foreground">{row.code}</TableCell>
                  <TruncateCell text={row.name}>
                    <Link
                      to={`/finance/suppliers/${row.supplierId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </TruncateCell>
                  <TruncateCell text={row.categoryPath ?? ''}>
                    <span className="text-muted-foreground">{row.categoryPath ?? ''}</span>
                  </TruncateCell>
                  <TruncateCell text={segments}>
                    <span className="text-muted-foreground">{segments}</span>
                  </TruncateCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(row.balance)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {row.latestBillDate ?? ''}
                  </TableCell>
                </LinkRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!balances.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={t('finance.payables.empty')}
            {...(filtered
              ? {
                  onClearFilters: () => {
                    setSearch('');
                    setParams(new URLSearchParams(), { replace: true });
                  },
                }
              : {})}
          />
        ) : null}
        <LoadMore query={balances} />
      </ListCard>
    </div>
  );
}

/**
 * One supplier's payables (F3, ADR-0091): what the company owes, then the ledger newest first
 * (receipts' bills and their price corrections, returns, manual entries) with what is owed after
 * each line and, on a receipt's line, the accountant who confirmed its prices. There is no
 * separate matching step (owner 2026-11-27): a bill is made when the accountant confirms the
 * receipt's prices on the receipt itself, and a payment lowers what is owed when it is posted;
 * «Үнэ батлаагүй орлого» opens the supplier's receipts still waiting for that confirmation.
 */
export function SupplierLedgerPage() {
  const { t } = useTranslation();
  const supplierId = Number.parseInt(useParams().id ?? '', 10);
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const balance = useSupplierBalance(supplierId);
  const ledger = useSupplierLedger(supplierId, { from, to });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];
  const erkhetLinks = useErkhetLinks(erkhetKeysOf(rows));
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
          <Button variant="outline" asChild>
            <Link to={`/inventory/receipts?supplierId=${supplierId}&costing=pending`}>
              <ClipboardCheck />
              {t('finance.payables.pendingReceipts')}
            </Link>
          </Button>
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
        <ProblemAlert problem={problemFromError(ledger.error)} onRetry={ledger.refetch} />
        <ListCard scroll>
          <ListTable columns={LEDGER_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.date')}</TableHead>
                <TableHead>{t('finance.fields.kind')}</TableHead>
                <TableHead>{t('finance.balances.document')}</TableHead>
                <TableHead>{t('finance.payables.confirmedBy')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
                <TableHead className="text-right">{t('finance.payables.owedAfter')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.isPending ? <SkeletonRows columns={7} /> : null}
              {rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono">{entry.entryDate}</TableCell>
                  <TableCell>
                    {entry.erkhet ? (
                      <ErkhetKind erkhet={entry.erkhet} reversal={entry.kind === 'VOID'} />
                    ) : (
                      t(`finance.apKinds.${entry.kind}`)
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {entry.erkhet ? (
                      <ErkhetDocument
                        erkhet={entry.erkhet}
                        number={entry.docNumber}
                        link={entry.erkhet.key ? erkhetLinks.get(entry.erkhet.key) : undefined}
                      />
                    ) : (
                      <DocumentLink entry={entry} />
                    )}
                  </TableCell>
                  <TruncateCell text={entry.confirmedBy ?? ''}>
                    {entry.confirmedBy ?? ''}
                  </TruncateCell>
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
          </ListTable>
          {!ledger.isPending && rows.length === 0 ? (
            <EmptyState title={t('finance.payables.ledgerEmpty')} />
          ) : null}
          <LoadMore query={ledger} />
        </ListCard>
      </section>
    </div>
  );
}

/** What the company owes the supplier, its newest bill, and how a bill and a payment are made. */
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
            <dd className="truncate font-mono text-[0.9375rem] font-semibold">
              {formatTugrik(balance.balance)}
            </dd>
            {prepaid ? (
              <dd className="text-xs text-muted-foreground">{t('finance.payables.prepaid')}</dd>
            ) : null}
          </div>
          <div className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t('finance.payables.latestBill')}</dt>
            <dd className="truncate font-mono text-[0.9375rem] font-semibold">
              {balance.latestBillDate ?? '—'}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{t('finance.payables.howToPayDirect')}</p>
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
