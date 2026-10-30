import { AGING_BUCKETS, SETTLEMENT_GROUPS } from '@tugeel/shared/finance';
import { CalendarClock } from 'lucide-react';
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
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordSheet, TotalsGrid } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyName } from '@/features/company/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { saveBlob } from '@/lib/download';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import {
  type Aging,
  type AgingFilter,
  type AgingRow,
  type SettlementGroup,
  useAging,
  useAgingItems,
  useReportDownloads,
} from './api';
import { idParam, NONE, reportHref } from './report-helpers';
import {
  AmountCell,
  ExcelButton,
  PrintHeading,
  PrintLink,
  RefreshControl,
  SummaryTile,
} from './report-kit';

const isGroup = (value: string | null): value is SettlementGroup =>
  SETTLEMENT_GROUPS.some((group) => group === value);

/** The aging filter from the URL (`group`, `q`, `overdue=1`). */
function useAgingFilter(): AgingFilter {
  const [search] = useSearchParams();
  const group = search.get('group');
  return {
    settlementGroup: isGroup(group) ? group : undefined,
    q: search.get('q') ?? undefined,
    overdueOnly: search.get('overdue') === '1',
  };
}

function filterParams(filter: AgingFilter) {
  return {
    group: filter.settlementGroup,
    q: filter.q,
    overdue: filter.overdueOnly ? 1 : undefined,
  };
}

/** The aging's columns on screen (ADR-0119): code, name, group, the buckets, credit, total, oldest. */
const AGING_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'group', kind: 'text', weight: 1 },
  ...AGING_BUCKETS.map((bucket): ColumnSpec => ({ key: bucket, kind: 'money' })),
  { key: 'credit', kind: 'money' },
  { key: 'total', kind: 'money', width: 10 },
  { key: 'oldest', kind: 'date' },
  { key: 'chevron', kind: 'chevron' },
];

/** With `onOpen` (the screen) the columns are sized by the layout; on paper the table lays itself out. */
function AgingTable(props: { report: Aging; onOpen?: (row: AgingRow) => void }) {
  const { t } = useTranslation();
  const { report } = props;
  const columns = 'reports.aging.columns';
  const body = (
    <>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.code`)}</TableHead>
          <TableHead>{t(`${columns}.name`)}</TableHead>
          <TableHead>{t(`${columns}.group`)}</TableHead>
          {AGING_BUCKETS.map((bucket) => (
            <TableHead key={bucket} className="text-right">
              {t(`finance.agingShort.${bucket}`)}
            </TableHead>
          ))}
          <TableHead className="text-right">{t(`${columns}.credit`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.total`)}</TableHead>
          <TableHead>{t(`${columns}.oldest`)}</TableHead>
          {props.onOpen ? <ChevronHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => {
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
              <TableCell>
                {row.settlementGroup ? t(`partners.settlement.groups.${row.settlementGroup}`) : ''}
              </TableCell>
              {AGING_BUCKETS.map((bucket) => (
                <AmountCell
                  key={bucket}
                  value={row.buckets[bucket]}
                  className={
                    bucket !== 'NOT_DUE' && row.buckets[bucket] !== '0.00'
                      ? 'text-destructive'
                      : undefined
                  }
                />
              ))}
              <AmountCell value={row.credit} />
              <AmountCell value={row.total} className="font-semibold" />
              <TableCell className="font-mono">{row.oldestDueDate ?? ''}</TableCell>
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
          <TableCell />
          {AGING_BUCKETS.map((bucket) => (
            <AmountCell key={bucket} value={report.totals[bucket]} />
          ))}
          <AmountCell value={report.credit} />
          <AmountCell value={report.total} />
          <TableCell />
          {props.onOpen ? <TableCell /> : null}
        </TableRow>
      </TableBody>
    </>
  );
  return props.onOpen ? (
    <ListTable columns={AGING_COLUMNS}>{body}</ListTable>
  ) : (
    <Table>{body}</Table>
  );
}

function BucketTiles({ report }: { report: Aging }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {AGING_BUCKETS.map((bucket) => (
        <SummaryTile
          key={bucket}
          label={t(`finance.aging.${bucket}`)}
          value={formatTugrik(report.totals[bucket])}
          tone={
            bucket !== 'NOT_DUE' && report.totals[bucket] !== '0.00' ? 'destructive' : 'default'
          }
        />
      ))}
      <SummaryTile
        label={t('reports.aging.overdue')}
        value={formatTugrik(report.overdue)}
        hint={t('reports.common.total') + ' ' + formatTugrik(report.total)}
      />
    </div>
  );
}

/** One customer's open items: invoices link to their panel. */
function AgingSheet(props: { row: AgingRow | null; partyId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const items = useAgingItems(props.partyId);
  const row = props.row;
  const columns = 'reports.aging.items';
  return (
    <RecordSheet
      open={props.partyId !== null}
      onClose={props.onClose}
      title={row?.name ?? ''}
      description={row?.code ?? undefined}
      actions={
        row?.customerId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/partners/customers/${row.customerId}`}>{t(`${columns}.openCustomer`)}</Link>
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {row ? (
          <TotalsGrid
            items={[
              [t('reports.aging.columns.total'), formatTugrik(row.total)],
              [t('reports.aging.overdue'), formatTugrik(row.overdue)],
              [t('reports.aging.columns.credit'), formatTugrik(row.credit)],
              [t('reports.aging.columns.oldest'), row.oldestDueDate ?? NONE],
            ]}
          />
        ) : null}
        <ProblemAlert problem={problemFromError(items.error)} onRetry={items.refetch} />
        {items.data && items.data.data.length === 0 ? (
          <EmptyState title={t(`${columns}.empty`)} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${columns}.document`)}</TableHead>
                <TableHead>{t(`${columns}.date`)}</TableHead>
                <TableHead>{t(`${columns}.due`)}</TableHead>
                <TableHead className="text-right">{t(`${columns}.days`)}</TableHead>
                <TableHead>{t(`${columns}.bucket`)}</TableHead>
                <TableHead className="text-right">{t(`${columns}.amount`)}</TableHead>
                <TableHead className="text-right">{t(`${columns}.open`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.isPending ? <SkeletonRows columns={7} rows={3} /> : null}
              {items.data?.data.map((item) => (
                <TableRow key={item.itemId}>
                  <TableCell className="font-mono">
                    {item.invoiceId ? (
                      <Link
                        className="text-link underline-offset-2 hover:underline"
                        to={`/finance/invoices?invoice=${item.invoiceId}`}
                      >
                        {item.documentNumber}
                      </Link>
                    ) : (
                      item.documentNumber
                    )}
                    {item.side === 'CREDIT' ? (
                      <Badge variant="outline" className="ml-2">
                        {t(`${columns}.advance`)}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono">{item.itemDate}</TableCell>
                  <TableCell className="font-mono">{item.dueDate ?? ''}</TableCell>
                  <TableCell className="text-right font-mono">
                    {item.daysOverdue !== null && item.daysOverdue > 0 ? item.daysOverdue : ''}
                  </TableCell>
                  <TableCell>{item.bucket ? t(`finance.agingShort.${item.bucket}`) : ''}</TableCell>
                  <TableCell className="text-right font-mono">{formatMnt(item.amount)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(item.openAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </RecordSheet>
  );
}

/** «Тайлан → Авлагын насжилт» (ADR-0108): each customer's open receivables by days past due. */
export function AgingPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const filter = useAgingFilter();
  const [q, setQ] = useState(filter.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  const query = { ...filter, q: debounced || undefined };
  const report = useAging(query);
  const downloads = useReportDownloads();
  const action = useAction();
  const partyId = idParam(search.get('party')) ?? null;
  const open = report.data?.rows.find((row) => row.partyId === partyId) ?? null;
  return (
    <div>
      <PageHeader
        title={t('reports.aging.title')}
        description={t('reports.aging.description')}
        meta={
          report.data ? (
            <span className="text-[13px]">
              {t('reports.aging.asOf', { date: report.data.date })}
            </span>
          ) : undefined
        }
        actions={
          <>
            <RefreshControl />
            <ExcelButton
              disabled={downloads.aging.isPending}
              onClick={() =>
                void action.run(async () =>
                  saveBlob(
                    await downloads.aging.mutateAsync(query),
                    `aging-${report.data?.date ?? 'today'}.xlsx`,
                  ),
                )
              }
            />
            <PrintLink
              to={reportHref('/reports/aging/print', { ...filterParams(query), format: 'a4' })}
            />
          </>
        }
      />
      {report.data ? <BucketTiles report={report.data} /> : null}
      <FilterBar>
        <SearchField
          aria-label={t('reports.aging.search')}
          placeholder={t('reports.aging.search')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setParam('q', event.target.value.trim() || null);
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('partners.settlement.group')}
          value={filter.settlementGroup ?? ''}
          onChange={(event) => setParam('group', event.target.value || null)}
        >
          <option value="">{t('partners.settlement.allGroups')}</option>
          {SETTLEMENT_GROUPS.map((group) => (
            <option key={group} value={group}>
              {t(`partners.settlement.groups.${group}`)}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('reports.aging.overdueOnly')}
          checked={filter.overdueOnly === true}
          onCheckedChange={(checked) => setParam('overdue', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <ListCard scroll>
        {report.isPending ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={11} />
            </TableBody>
          </Table>
        ) : report.data && report.data.rows.length > 0 ? (
          <AgingTable
            report={report.data}
            onOpen={(row) => setParam('party', String(row.partyId))}
          />
        ) : (
          <EmptyState icon={CalendarClock} title={t('reports.aging.empty')} />
        )}
      </ListCard>
      <AgingSheet row={open} partyId={partyId} onClose={() => setParam('party', null)} />
    </div>
  );
}

/** The aging on paper (`/reports/aging/print?group&q&overdue`). */
export function AgingPrintPage() {
  const { t } = useTranslation();
  const filter = useAgingFilter();
  const report = useAging(filter);
  const company = useCompanyName();
  const title = `${t('reports.aging.title')} ${report.data?.date ?? ''}`.trim();
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <PrintHeading
              company={company}
              title={title}
              note={
                filter.settlementGroup
                  ? t(`partners.settlement.groups.${filter.settlementGroup}`)
                  : undefined
              }
            />
            <AgingTable report={report.data} />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
