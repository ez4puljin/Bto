import { BookOpen, CircleCheck, ClipboardCheck, Plus, Truck } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Decimal } from '@tugeel/shared/money';
import { addDays, addMonths, businessDate, businessMonthStart } from '@tugeel/shared/time';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import { type ReceiptSummary, useReceipts } from '@/features/inventory/api';
import { NativeSelect } from '@/components/native-select';
import { useSupplierCategories } from '@/features/partners/api';
import { SegmentFilter } from '@/features/segments/segment-filter';
import {
  type PayableEntry,
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

/** The report's columns: date, kind, document, who confirmed it, two sides, owed after. */
const LEDGER_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date', width: 8 },
  { key: 'kind', kind: 'text', weight: 1, min: 7 },
  { key: 'document', kind: 'number', width: 11 },
  { key: 'confirmedBy', kind: 'text', weight: 2, min: 9 },
  { key: 'debit', kind: 'money', width: 9 },
  { key: 'credit', kind: 'money', width: 9 },
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

type Period = { from: string; to: string };

/** This month and the one before it in Ulaanbaatar days. */
function monthsOf(today: string): { current: Period; previous: Period } {
  const start = businessMonthStart();
  const previousStart = addMonths(start, -1);
  return {
    current: { from: start, to: today },
    previous: { from: previousStart, to: addDays(start, -1) },
  };
}

/** One row of the report: a ledger line, or a receipt still waiting for its price check. */
type ReportRow =
  | { kind: 'line'; date: string; entry: PayableEntry }
  | { kind: 'pending'; date: string; receipt: ReceiptSummary };

/**
 * One supplier's «Авлага өглөгийн тайлан» (owner 2026-11-27): the period (this month by default,
 * the previous month or any range), its opening, debit, credit and closing, then every line of
 * the period oldest first with the balance after it. A receipt whose prices the accountant
 * confirmed is green and names that accountant; a posted receipt still waiting for the price
 * check is listed in its place, muted, outside the balance, until it is confirmed on the receipt.
 */
export function SupplierLedgerPage() {
  const { t } = useTranslation();
  const supplierId = Number.parseInt(useParams().id ?? '', 10);
  const [params, setParams] = useSearchParams();
  const today = businessDate();
  const months = monthsOf(today);
  const from = params.get('from') ?? months.current.from;
  const to = params.get('to') ?? months.current.to;
  const setPeriod = (period: Partial<Period>) => {
    const next = new URLSearchParams(params);
    next.set('from', period.from ?? from);
    next.set('to', period.to ?? to);
    setParams(next, { replace: true });
  };
  const balance = useSupplierBalance(supplierId);
  const ledger = useSupplierLedger(supplierId, { from, to });
  const pending = useReceipts({ supplierId, costingPending: true, from, to });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = ledger;
  // The report is the whole period: every page is read, oldest first on screen.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const entries = useMemo(
    () => (ledger.data?.pages.flatMap((page) => page.data) ?? []).slice().reverse(),
    [ledger.data],
  );
  const waiting = useMemo(
    () =>
      (pending.data?.pages.flatMap((page) => page.data) ?? []).filter(
        (receipt) => receipt.status === 'POSTED' && receipt.costingStatus === 'PENDING',
      ),
    [pending.data],
  );
  const rows = useMemo<ReportRow[]>(() => {
    const lines: ReportRow[] = entries.map((entry) => ({
      kind: 'line',
      date: entry.entryDate,
      entry,
    }));
    for (const receipt of waiting) {
      const date = receipt.supplierDocDate ?? receipt.effectiveDate ?? '';
      // After every line of its day, so the balances above it stay in order.
      const at = lines.findIndex((row) => row.date > date);
      const row: ReportRow = { kind: 'pending', date, receipt };
      if (at === -1) lines.push(row);
      else lines.splice(at, 0, row);
    }
    return lines;
  }, [entries, waiting]);
  const erkhetLinks = useErkhetLinks(erkhetKeysOf(entries));
  const summary = balance.data;
  const opening = ledger.data?.pages[0]?.opening ?? '0.00';
  const totals = useMemo(() => {
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const entry of entries) {
      debit = debit.plus(entry.debit);
      credit = credit.plus(entry.credit);
    }
    return {
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      closing: new Decimal(opening).plus(credit).minus(debit).toFixed(2),
    };
  }, [entries, opening]);
  const loading = ledger.isPending || hasNextPage;

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
  const reportHref = `/reports/party-ledger?${new URLSearchParams({
    from,
    to,
    s: String(supplierId),
    sn: summary.name,
    by: 'PARTY_ACCOUNT',
  }).toString()}`;
  const isPeriod = (period: Period) => from === period.from && to === period.to;

  return (
    <div className="space-y-4">
      <PageHeader
        title={summary.name}
        crumbs={crumbs}
        meta={
          <>
            <span className="font-mono">{summary.code}</span>
            <span>
              {t('finance.payables.owedNow')}:{' '}
              <span className="font-mono font-semibold text-foreground">
                {formatTugrik(summary.balance)}
              </span>
            </span>
            <Link
              className="text-link underline-offset-2 hover:underline"
              to={`/partners/suppliers/${supplierId}`}
            >
              {t('finance.payables.supplierInfo')}
            </Link>
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/inventory/receipts?supplierId=${supplierId}&costing=pending`}>
                <ClipboardCheck />
                {t('finance.payables.pendingReceipts')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={reportHref}>
                <BookOpen />
                {t('finance.payables.openReport')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterBar>
        <div role="group" aria-label={t('finance.payables.period')} className="flex gap-1.5">
          <Button
            size="sm"
            variant={isPeriod(months.current) ? 'default' : 'outline'}
            aria-pressed={isPeriod(months.current)}
            onClick={() => setPeriod(months.current)}
          >
            {t('finance.payables.thisMonth')}
          </Button>
          <Button
            size="sm"
            variant={isPeriod(months.previous) ? 'default' : 'outline'}
            aria-pressed={isPeriod(months.previous)}
            onClick={() => setPeriod(months.previous)}
          >
            {t('finance.payables.previousMonth')}
          </Button>
        </div>
        <DateRangeFilter
          label={t('finance.fields.date')}
          fromLabel={t('finance.fields.from')}
          toLabel={t('finance.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setPeriod({ from: value ?? months.current.from })}
          onTo={(value) => setPeriod({ to: value ?? today })}
        />
      </FilterBar>
      <dl
        aria-label={t('reports.ledger.titles.PARTY')}
        className="grid grid-cols-2 gap-2 @container lg:grid-cols-4"
      >
        <Figure label={t('finance.payables.opening')} value={opening} />
        <Figure label={t('finance.payables.debitTurnover')} value={totals.debit} />
        <Figure label={t('finance.payables.creditTurnover')} value={totals.credit} />
        <Figure label={t('finance.payables.closing')} value={totals.closing} strong />
      </dl>
      <ProblemAlert problem={problemFromError(ledger.error)} onRetry={ledger.refetch} />
      <section aria-label={t('reports.ledger.titles.PARTY')} className="space-y-2">
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
              <TableRow className="bg-muted/40 font-medium">
                <TableCell className="font-mono">{from}</TableCell>
                <TableCell colSpan={5}>{t('finance.payables.opening')}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(opening)}</TableCell>
              </TableRow>
              {loading ? <SkeletonRows columns={7} /> : null}
              {loading
                ? null
                : rows.map((row) =>
                    row.kind === 'line' ? (
                      <LineRow
                        key={`l${row.entry.id}`}
                        entry={row.entry}
                        erkhetLink={
                          row.entry.erkhet?.key ? erkhetLinks.get(row.entry.erkhet.key) : undefined
                        }
                      />
                    ) : (
                      <PendingRow key={`p${row.receipt.id}`} receipt={row.receipt} />
                    ),
                  )}
              {!loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('finance.payables.ledgerEmpty')}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell className="font-mono">{to}</TableCell>
                <TableCell colSpan={3}>{t('finance.payables.closing')}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(totals.debit)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(totals.credit)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(totals.closing)}</TableCell>
              </TableRow>
            </TableBody>
          </ListTable>
        </ListCard>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-sm bg-success-soft ring-1 ring-success/40"
            />
            {t('finance.payables.legendConfirmed')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-sm bg-warning-soft ring-1 ring-warning/40"
            />
            {t('finance.payables.legendPending')}
          </span>
          <span>{t('finance.payables.howToPayDirect')}</span>
        </p>
      </section>
    </div>
  );
}

/** A figure of the period: the opening, the turnover of each side, the closing. */
function Figure(props: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          'truncate font-mono text-[0.9375rem]',
          props.strong ? 'font-semibold' : 'font-medium',
        )}
      >
        {formatTugrik(props.value)}
      </dd>
    </div>
  );
}

/** A ledger line; a receipt whose prices an accountant confirmed is green with that name. */
function LineRow(props: {
  entry: PayableEntry;
  erkhetLink: Parameters<typeof ErkhetDocument>[0]['link'];
}) {
  const { t } = useTranslation();
  const { entry } = props;
  const confirmed = entry.docType === 'RECEIPT' && entry.confirmedBy !== null;
  return (
    <TableRow
      data-confirmed={confirmed ? 'true' : undefined}
      className={cn(confirmed && 'bg-success-soft/60 hover:bg-success-soft')}
    >
      <TableCell className="font-mono">{entry.entryDate}</TableCell>
      <TruncateCell text={entry.erkhet ? '' : t(`finance.apKinds.${entry.kind}`)}>
        {entry.erkhet ? (
          <ErkhetKind erkhet={entry.erkhet} reversal={entry.kind === 'VOID'} />
        ) : (
          t(`finance.apKinds.${entry.kind}`)
        )}
      </TruncateCell>
      <TableCell className="font-mono">
        {entry.erkhet ? (
          <ErkhetDocument erkhet={entry.erkhet} number={entry.docNumber} link={props.erkhetLink} />
        ) : (
          <DocumentLink entry={entry} />
        )}
      </TableCell>
      <TruncateCell text={entry.confirmedBy ?? ''}>
        {confirmed ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CircleCheck aria-hidden className="size-3.5" />
            {entry.confirmedBy}
          </span>
        ) : (
          (entry.confirmedBy ?? '')
        )}
      </TruncateCell>
      <TableCell className="text-right font-mono">
        {entry.debit === '0.00' ? '' : formatMnt(entry.debit)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {entry.credit === '0.00' ? '' : formatMnt(entry.credit)}
      </TableCell>
      <TableCell className="text-right font-mono">{formatMnt(entry.balanceAfter)}</TableCell>
    </TableRow>
  );
}

/** A posted receipt waiting for the accountant's price check: no payable yet. */
function PendingRow({ receipt }: { receipt: ReceiptSummary }) {
  const { t } = useTranslation();
  return (
    <TableRow data-pending="true" className="bg-warning-soft/50 text-muted-foreground">
      <TableCell className="font-mono">
        {receipt.supplierDocDate ?? receipt.effectiveDate ?? ''}
      </TableCell>
      <TableCell>{t('finance.apKinds.BILL')}</TableCell>
      <TableCell className="font-mono">
        <Link
          className="text-link underline-offset-2 hover:underline"
          to={`/inventory/receipts/${receipt.id}`}
        >
          {receipt.number ?? ''}
        </Link>
      </TableCell>
      <TableCell className="text-warning">{t('finance.payables.notConfirmed')}</TableCell>
      <TableCell />
      <TableCell className="text-right font-mono italic">
        {receipt.netAmount ? formatMnt(receipt.netAmount) : ''}
      </TableCell>
      <TableCell />
    </TableRow>
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
