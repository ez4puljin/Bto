import { Factory } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  FilterBar,
  ListCard,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { saveBlob } from '@/lib/download';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import {
  type SupplierReport,
  type SupplierReportRow,
  useReportDownloads,
  useSupplierEntries,
  useSupplierReport,
} from './api';
import { HorizontalBars } from './charts';
import { idParam, reportHref, useRange } from './report-helpers';
import { AmountCell, ExcelButton, PrintHeading, PrintLink, RefreshControl } from './report-kit';

const AMOUNTS = ['purchases', 'purchasesExVat', 'otherBills', 'payments', 'balance'] as const;

function SuppliersTable(props: {
  report: SupplierReport;
  onOpen?: (row: SupplierReportRow) => void;
}) {
  const { t } = useTranslation();
  const columns = 'reports.suppliers.columns';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.code`)}</TableHead>
          <TableHead>{t(`${columns}.name`)}</TableHead>
          {AMOUNTS.map((key) => (
            <TableHead key={key} className="text-right">
              {t(`${columns}.${key}`)}
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
                  <button
                    type="button"
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={() => props.onOpen?.(row)}
                  >
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </TruncateCell>
              {AMOUNTS.map((key) => (
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
          {AMOUNTS.map((key) => (
            <AmountCell key={key} value={props.report.totals[key]} />
          ))}
          {props.onOpen ? <TableCell /> : null}
        </TableRow>
      </TableBody>
    </Table>
  );
}

const LINK = 'text-link underline-offset-2 hover:underline';

/** One supplier's entries in the period: a purchase opens its goods receipt, the rest the journal. */
function EntriesSheet(props: {
  row: SupplierReportRow | null;
  partyId: number | null;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const entries = useSupplierEntries(props.partyId, props.range);
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
              [t('reports.suppliers.columns.purchases'), formatTugrik(row.purchases)],
              [t('reports.suppliers.columns.otherBills'), formatTugrik(row.otherBills)],
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
                <TableHead className="text-right">{t(`${columns}.amount`)}</TableHead>
                <TableHead className="text-right">{t(`${columns}.vat`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.isPending ? <SkeletonRows columns={5} rows={3} /> : null}
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
                      <Link
                        className={LINK}
                        to={
                          entry.receiptId
                            ? `/inventory/receipts/${entry.receiptId}`
                            : `/finance/journal?entry=${entry.entryId}`
                        }
                      >
                        {number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMnt(entry.amount)}
                    </TableCell>
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
    </RecordSheet>
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
  const filter = { from: range.from, to: range.to, q: debounced || undefined };
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
            <PrintLink to={reportHref('/reports/suppliers/print', { ...filter, format: 'a4' })} />
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
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      {top.length > 0 ? (
        <Card className="mb-3 gap-2">
          <CardHeader>
            <CardTitle>{t('reports.suppliers.chart')}</CardTitle>
          </CardHeader>
          <CardContent>
            <HorizontalBars
              items={top}
              label={t('reports.suppliers.chart')}
              valueLabel={t('reports.suppliers.columns.purchases')}
              onSelect={(item) => setParam('party', item.key)}
            />
          </CardContent>
        </Card>
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
        onClose={() => setParam('party', null)}
      />
    </div>
  );
}

/** The supplier report on paper (`/reports/suppliers/print?from&to&q`). */
export function SuppliersPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const range = useRange();
  const filter = { from: range.from, to: range.to, q: search.get('q') ?? undefined };
  const report = useSupplierReport(range.valid ? filter : null);
  const company = useCompanyName();
  const title = t('reports.suppliers.title');
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
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
