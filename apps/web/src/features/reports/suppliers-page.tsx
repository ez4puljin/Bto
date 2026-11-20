import { ChevronRight, Factory } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordSheet, TotalsGrid } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyName } from '@/features/company/api';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import type { ColumnSpec } from '@/lib/column-layout';
import { saveBlob } from '@/lib/download';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  type SupplierReport,
  type SupplierReportRow,
  useReportDownloads,
  useSupplierEntries,
  useSupplierReport,
} from './api';
import { type BarItem, HorizontalBars } from './charts';
import { idParam, reportHref, useRange } from './report-helpers';
import {
  AmountCell,
  ExcelButton,
  PrintHeading,
  PrintLink,
  RefreshControl,
  ROW_NAME,
} from './report-kit';
import { ReportViews } from './report-views';
import { PeekLink } from './books/record-peek';
import { usePeek } from './books/use-peek';

type Amount = 'purchases' | 'purchasesExVat' | 'otherBills' | 'discounts' | 'payments' | 'balance';

/** The amounts, the credit side first; the discounts beside the payments when split (ADR-0234). */
const amountsOf = (split: boolean): readonly Amount[] =>
  split
    ? ['purchases', 'purchasesExVat', 'otherBills', 'discounts', 'payments', 'balance']
    : ['purchases', 'purchasesExVat', 'otherBills', 'payments', 'balance'];

/** An amount's width when it is not a money column's 8.5rem, and when it leaves a narrow table. */
const AMOUNT_COLUMNS: Record<Amount, Pick<ColumnSpec, 'width' | 'drop'>> = {
  purchases: { width: 10 },
  purchasesExVat: { width: 10, drop: 1 },
  otherBills: { drop: 2 },
  discounts: { width: 10, drop: 4 },
  payments: { width: 10, drop: 4 },
  balance: {},
};

/**
 * The report's columns on screen (ADR-0119): code, name, the five amounts, the chevron; 70.25rem
 * in all, the turnover of a year 10rem («12,345,678,901») and the smaller amounts 8.5. What a
 * narrower table lets go, least needed first (ADR-0201): the purchases without VAT (60.25); the
 * other bills (a till PC's 55.5rem: 51.75); the code (44.75); the payments (a tablet's 40.5rem:
 * 34.75) — the supplier's panel says them all. The name, the purchases and what is owed stay. The
 * discounts' column (ADR-0234, 10rem more) leaves with the payments.
 */
const columnsOf = (split: boolean): readonly ColumnSpec[] => [
  { key: 'code', kind: 'code', drop: 3 },
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  ...amountsOf(split).map((key): ColumnSpec => ({ key, kind: 'money', ...AMOUNT_COLUMNS[key] })),
  { key: 'chevron', kind: 'chevron' },
];
const COLUMNS = columnsOf(false);
const SPLIT_COLUMNS = columnsOf(true);

/** An amount with its sign turned: a discount closes part of what is owed. */
function negated(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/** With `onOpen` (the screen) the columns are sized by the layout; on paper the table lays itself out. */
function SuppliersTable(props: {
  report: SupplierReport;
  onOpen?: (row: SupplierReportRow) => void;
}) {
  const { t } = useTranslation();
  const columns = 'reports.suppliers.columns';
  // The server split the discounts out (ADR-0234): the purchases stand before them.
  const split = props.report.totals.discounts !== null;
  const amounts = amountsOf(split);
  const body = (
    <>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.code`)}</TableHead>
          <TableHead>{t(`${columns}.name`)}</TableHead>
          {/* «Худалдан авалт (НӨАТ-тэй)» is wider than its amounts: a head may take two lines. */}
          {amounts.map((key) => (
            <TableHead key={key} className="text-right leading-tight whitespace-normal">
              {t(`${columns}.${split && key === 'purchases' ? 'grossPurchases' : key}`)}
            </TableHead>
          ))}
          {props.onOpen ? <ChevronHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.report.rows.map((row) => {
          const cells = (
            <>
              <TableCell className="font-mono">{row.code ?? ''}</TableCell>
              <TruncateCell text={row.name}>
                {props.onOpen ? (
                  <button type="button" className={ROW_NAME} onClick={() => props.onOpen?.(row)}>
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </TruncateCell>
              {amounts.map((key) => (
                <AmountCell key={key} value={row[key]} />
              ))}
            </>
          );
          return props.onOpen ? (
            <ButtonRow key={row.partyId} onOpen={() => props.onOpen?.(row)}>
              {cells}
            </ButtonRow>
          ) : (
            <TableRow key={row.partyId}>{cells}</TableRow>
          );
        })}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell>{t('reports.common.total')}</TableCell>
          {amounts.map((key) => (
            <AmountCell key={key} value={props.report.totals[key]} />
          ))}
          {props.onOpen ? <TableCell /> : null}
        </TableRow>
      </TableBody>
    </>
  );
  return props.onOpen ? (
    <ListTable columns={split ? SPLIT_COLUMNS : COLUMNS}>{body}</ListTable>
  ) : (
    <Table>{body}</Table>
  );
}

/** One supplier's entries in the period: a purchase opens its goods receipt, the rest the journal. */
function EntriesSheet(props: {
  row: SupplierReportRow | null;
  partyId: number | null;
  range: { from: string; to: string };
  /** Receipts before their discounts, each discount beside its receipt (ADR-0234). */
  split: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const entries = useSupplierEntries(props.partyId, props.range, props.split);
  // A receipt or entry opens over the list (2026-11-16, the owner).
  const peek = usePeek();
  const { row } = props;
  const columns = 'reports.suppliers.entries';
  return (
    <RecordSheet
      open={props.partyId !== null}
      onClose={props.onClose}
      title={row?.name ?? ''}
      description={t('reports.common.range', props.range)}
      actions={
        row?.supplierId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/partners/suppliers/${row.supplierId}`}>
              {t('reports.suppliers.openSupplier')}
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {row ? (
          <TotalsGrid
            items={[
              [
                t(
                  row.discounts === null
                    ? 'reports.suppliers.columns.purchases'
                    : 'reports.suppliers.columns.grossPurchases',
                ),
                formatTugrik(row.purchases),
              ],
              [t('reports.suppliers.columns.otherBills'), formatTugrik(row.otherBills)],
              ...(row.discounts === null
                ? []
                : [
                    [t('reports.suppliers.columns.discounts'), formatTugrik(row.discounts)] as [
                      string,
                      string,
                    ],
                  ]),
              [t('reports.suppliers.columns.payments'), formatTugrik(row.payments)],
              [t('reports.suppliers.columns.balance'), formatTugrik(row.balance)],
            ]}
          />
        ) : null}
        <ProblemAlert problem={problemFromError(entries.error)} onRetry={entries.refetch} />
        {entries.data && entries.data.data.length === 0 ? (
          <EmptyState title={t(`${columns}.empty`)} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${columns}.date`)}</TableHead>
                <TableHead>{t(`${columns}.kind`)}</TableHead>
                <TableHead>{t(`${columns}.number`)}</TableHead>
                <TableHead className="text-right">
                  {t(`${columns}.${props.split ? 'grossAmount' : 'amount'}`)}
                </TableHead>
                {props.split ? (
                  <TableHead className="text-right">{t(`${columns}.discount`)}</TableHead>
                ) : null}
                <TableHead className="text-right">{t(`${columns}.vat`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.isPending ? <SkeletonRows columns={props.split ? 6 : 5} rows={3} /> : null}
              {entries.data?.data.map((entry) => {
                const number = entry.number ?? `#${entry.entryId}`;
                return (
                  <TableRow key={entry.entryId}>
                    <TableCell className="font-mono">{entry.date}</TableCell>
                    <TableCell>
                      {t(`reports.suppliers.kinds.${entry.kind}`)}
                      {entry.reversal ? (
                        <Badge variant="outline" className="ml-2">
                          {t(`${columns}.reversal`)}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono">
                      <PeekLink
                        peek={
                          entry.receiptId
                            ? { kind: 'receipt', id: entry.receiptId }
                            : { kind: 'entry', id: entry.entryId }
                        }
                        onOpen={peek.open}
                      >
                        {number}
                      </PeekLink>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMnt(entry.amount)}
                    </TableCell>
                    {props.split ? (
                      <TableCell className="text-right font-mono">
                        {/* What closes part of the receipt: shown taken off, blank without one. */}
                        {entry.discount && entry.discount !== '0.00'
                          ? formatMnt(negated(entry.discount))
                          : ''}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right font-mono">
                      {formatMnt(entry.vatAmount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {peek.panel}
    </RecordSheet>
  );
}

/**
 * The ten largest suppliers as bars, behind their title. On a tall window the chart is open; where
 * it alone would push the list under the window's foot (a till PC, a laptop: under 850px of
 * height) it waits folded until it is asked for (ADR-0201). What the user pressed wins.
 */
function TopSuppliers(props: { items: readonly BarItem[]; onSelect: (item: BarItem) => void }) {
  const { t } = useTranslation();
  const low = useMediaQuery('(max-height: 849px)');
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? !low;
  return (
    <Card className="mb-3 py-0">
      <details open={open} className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset touch:min-h-11 [&::-webkit-details-marker]:hidden"
          onClick={(event) => {
            // React holds the state: the browser's own toggle would run ahead of it.
            event.preventDefault();
            setChosen(!open);
          }}
        >
          <ChevronRight
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
          />
          <span className="font-heading text-[0.9375rem] leading-snug font-semibold tracking-tight">
            {t('reports.suppliers.chart')}
          </span>
        </summary>
        {open ? (
          <CardContent className="pb-4">
            <HorizontalBars
              items={props.items}
              label={t('reports.suppliers.chart')}
              valueLabel={t('reports.suppliers.columns.purchases')}
              onSelect={props.onSelect}
            />
          </CardContent>
        ) : null}
      </details>
    </Card>
  );
}

/** «Тайлан → Нийлүүлэгчийн тайлан» (ADR-0108): purchases, payments and what is owed per supplier. */
export function SuppliersReportPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const range = useRange();
  const [q, setQ] = useState(search.get('q') ?? '');
  const debounced = useDebounced(q.trim(), 300);
  const split = search.get('discounts') === '1';
  const filter = {
    from: range.from,
    to: range.to,
    q: debounced || undefined,
    splitDiscounts: split || undefined,
  };
  const report = useSupplierReport(range.valid ? filter : null);
  const downloads = useReportDownloads();
  const action = useAction();
  const partyId = idParam(search.get('party')) ?? null;
  const open = report.data?.rows.find((row) => row.partyId === partyId) ?? null;
  const top = (report.data?.rows ?? [])
    .filter((row) => row.purchases !== '0.00')
    .slice(0, 10)
    .map((row) => ({ key: String(row.partyId), label: row.name, value: row.purchases }));
  return (
    <div>
      <PageHeader
        title={t('reports.suppliers.title')}
        description={t('reports.suppliers.description')}
        actions={
          <>
            <ReportViews page="suppliers" />
            <RefreshControl />
            <ExcelButton
              disabled={!range.valid || downloads.suppliers.isPending}
              onClick={() =>
                void action.run(async () =>
                  saveBlob(
                    await downloads.suppliers.mutateAsync(filter),
                    `suppliers-${filter.from}-${filter.to}.xlsx`,
                  ),
                )
              }
            />
            <PrintLink
              to={reportHref('/reports/suppliers/print', {
                from: filter.from,
                to: filter.to,
                q: filter.q,
                discounts: split ? 1 : undefined,
                format: 'a4',
              })}
            />
          </>
        }
      />
      <FilterBar>
        <DateRangeFilter
          label={t('reports.common.period')}
          fromLabel={t('reports.common.from')}
          toLabel={t('reports.common.to')}
          from={range.from}
          to={range.to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
        <SearchField
          aria-label={t('reports.suppliers.search')}
          placeholder={t('reports.suppliers.search')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setParam('q', event.target.value.trim() || null);
          }}
        />
        <FilterToggle
          label={t('reports.suppliers.splitDiscounts')}
          checked={split}
          onCheckedChange={(checked) => setParam('discounts', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      {top.length > 0 ? (
        <TopSuppliers items={top} onSelect={(item) => setParam('party', item.key)} />
      ) : null}
      <ListCard scroll>
        {report.isPending && range.valid ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={7} />
            </TableBody>
          </Table>
        ) : report.data && report.data.rows.length > 0 ? (
          <SuppliersTable
            report={report.data}
            onOpen={(row) => setParam('party', String(row.partyId))}
          />
        ) : (
          <EmptyState icon={Factory} title={t('reports.suppliers.empty')} />
        )}
      </ListCard>
      <EntriesSheet
        row={open}
        partyId={partyId}
        range={{ from: range.from, to: range.to }}
        split={split}
        onClose={() => setParam('party', null)}
      />
    </div>
  );
}

/** The supplier report on paper (`/reports/suppliers/print?from&to&q&discounts`). */
export function SuppliersPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const range = useRange();
  const filter = {
    from: range.from,
    to: range.to,
    q: search.get('q') ?? undefined,
    splitDiscounts: search.get('discounts') === '1' || undefined,
  };
  const report = useSupplierReport(range.valid ? filter : null);
  const company = useCompanyName();
  const title = t('reports.suppliers.title');
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[0.75rem]">
            <PrintHeading
              company={company}
              title={title}
              note={t('reports.common.range', { from: filter.from, to: filter.to })}
            />
            <SuppliersTable report={report.data} />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
