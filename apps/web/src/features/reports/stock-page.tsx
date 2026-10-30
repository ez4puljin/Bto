import { PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
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
import { useCompanyName } from '@/features/company/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { saveBlob } from '@/lib/download';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import {
  SLOW_DAYS,
  type SlowDays,
  STOCK_FILTERS,
  type StockFilter,
  type StockFilterKind,
  type StockReport,
  type StockReportRow,
  useReportDownloads,
  useStockPrint,
  useStockReport,
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

const isFilter = (value: string | null): value is StockFilterKind =>
  STOCK_FILTERS.some((filter) => filter === value);

/** The stock report's filter from the URL (`days`, `filter`, `q`, `warehouseId`, `categoryId`). */
function useStockFilter(): StockFilter {
  const [search] = useSearchParams();
  const days = idParam(search.get('days'));
  const filter = search.get('filter');
  return {
    slowDays: SLOW_DAYS.find((option) => option === days) ?? 90,
    filter: isFilter(filter) ? filter : 'ALL',
    q: search.get('q') ?? undefined,
    warehouseId: idParam(search.get('warehouseId')),
    categoryId: idParam(search.get('categoryId')),
  };
}

function filterParams(filter: StockFilter) {
  return {
    days: filter.slowDays === 90 ? undefined : filter.slowDays,
    filter: filter.filter === 'ALL' ? undefined : filter.filter,
    q: filter.q,
    warehouseId: filter.warehouseId,
    categoryId: filter.categoryId,
  };
}

/** The report's columns on screen (ADR-0119), the value only when costs are shown. */
function stockColumns(costs: boolean): readonly ColumnSpec[] {
  return [
    { key: 'sku', kind: 'code' },
    { key: 'name', kind: 'text', weight: 3, min: 14 },
    { key: 'category', kind: 'text', weight: 2 },
    { key: 'onHand', kind: 'qty' },
    ...(costs ? [{ key: 'value', kind: 'money' } as const] : []),
    { key: 'sold', kind: 'qty' },
    { key: 'cover', kind: 'count' },
    { key: 'lastSale', kind: 'date' },
    { key: 'sinceSale', kind: 'count' },
    // Two badges («Удаан», «Бага») side by side.
    { key: 'status', kind: 'status', width: 11 },
    { key: 'chevron', kind: 'chevron' },
  ];
}

/** With `links` (the screen) the columns are sized by the layout; on paper the table lays itself out. */
function StockTable(props: {
  rows: readonly StockReportRow[];
  slowDays: number;
  costs: boolean;
  links: boolean;
}) {
  const { t } = useTranslation();
  const columns = 'reports.stock.columns';
  const spec = useMemo(() => stockColumns(props.costs), [props.costs]);
  const body = (
    <>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.sku`)}</TableHead>
          <TableHead>{t(`${columns}.name`)}</TableHead>
          <TableHead>{t(`${columns}.category`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.onHand`)}</TableHead>
          {props.costs ? (
            <TableHead className="text-right">{t(`${columns}.value`)}</TableHead>
          ) : null}
          <TableHead className="text-right">
            {t(`${columns}.sold`, { days: props.slowDays })}
          </TableHead>
          <TableHead className="text-right">{t(`${columns}.cover`)}</TableHead>
          <TableHead>{t(`${columns}.lastSale`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.sinceSale`)}</TableHead>
          <TableHead>{t(`${columns}.status`)}</TableHead>
          {props.links ? <ChevronHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row) => {
          const cells = (
            <>
              <TableCell className="font-mono">{row.sku}</TableCell>
              <TruncateCell text={row.name}>
                {props.links ? (
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    to={`/inventory/stock/${row.productId}`}
                  >
                    {row.name}
                  </Link>
                ) : (
                  row.name
                )}
              </TruncateCell>
              <TruncateCell text={row.categoryName ?? ''} />
              <TableCell className="text-right font-mono">{formatQty(row.onHand)}</TableCell>
              {props.costs ? <AmountCell value={row.value} /> : null}
              <TableCell className="text-right font-mono">{formatQty(row.soldQty)}</TableCell>
              <TableCell className="text-right font-mono">
                {row.coverDays === null ? NONE : formatCount(row.coverDays)}
              </TableCell>
              <TableCell className="font-mono">{row.lastSaleDate ?? NONE}</TableCell>
              <TableCell className="text-right font-mono">
                {row.daysSinceSale === null ? NONE : formatCount(row.daysSinceSale)}
              </TableCell>
              <TableCell>
                {row.slow ? <Badge variant="warning">{t('reports.stock.slow')}</Badge> : null}
                {row.low ? (
                  <Badge variant="destructive" className={row.slow ? 'ml-1' : undefined}>
                    {t('reports.stock.low')}
                  </Badge>
                ) : null}
              </TableCell>
            </>
          );
          return props.links ? (
            <LinkRow key={row.productId} to={`/inventory/stock/${row.productId}`}>
              {cells}
            </LinkRow>
          ) : (
            <TableRow key={row.productId}>{cells}</TableRow>
          );
        })}
      </TableBody>
    </>
  );
  return props.links ? <ListTable columns={spec}>{body}</ListTable> : <Table>{body}</Table>;
}

function StockTiles({ report }: { report: StockReport }) {
  const { t } = useTranslation();
  const { totals } = report;
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <SummaryTile label={t('reports.stock.tiles.products')} value={formatCount(totals.products)} />
      {totals.value !== null ? (
        <SummaryTile label={t('reports.stock.tiles.value')} value={formatTugrik(totals.value)} />
      ) : null}
      <SummaryTile
        label={t('reports.stock.tiles.slow')}
        value={formatCount(totals.slowProducts)}
        tone={totals.slowProducts > 0 ? 'warning' : 'default'}
      />
      {totals.slowValue !== null ? (
        <SummaryTile
          label={t('reports.stock.tiles.slowValue')}
          value={formatTugrik(totals.slowValue)}
        />
      ) : null}
      <SummaryTile
        label={t('reports.stock.tiles.low')}
        value={formatCount(totals.lowProducts)}
        tone={totals.lowProducts > 0 ? 'destructive' : 'default'}
      />
    </div>
  );
}

/** «Тайлан → Барааны эргэлт» (ADR-0108): stock, sales speed, slow movers and low stock. */
export function StockReportPage() {
  const { t } = useTranslation();
  const setParam = useSetParam();
  const filter = useStockFilter();
  const [q, setQ] = useState(filter.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  const query = { ...filter, q: debounced || undefined };
  const report = useStockReport(query);
  const downloads = useReportDownloads();
  const action = useAction();
  const first = report.data?.pages[0];
  const rows = report.data?.pages.flatMap((page) => page.rows) ?? [];
  const costs = first?.totals.value !== null && first?.totals.value !== undefined;
  return (
    <div>
      <PageHeader
        title={t('reports.stock.title')}
        description={t('reports.stock.description')}
        actions={
          <>
            <RefreshControl />
            <ExcelButton
              disabled={downloads.stock.isPending}
              onClick={() =>
                void action.run(async () =>
                  saveBlob(
                    await downloads.stock.mutateAsync(query),
                    `stock-${first?.date ?? 'today'}.xlsx`,
                  ),
                )
              }
            />
            <PrintLink
              to={reportHref('/reports/stock/print', { ...filterParams(query), format: 'a4' })}
            />
          </>
        }
      />
      {first ? <StockTiles report={first} /> : null}
      <FilterBar>
        <SearchField
          aria-label={t('reports.stock.search')}
          placeholder={t('reports.stock.search')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setParam('q', event.target.value.trim() || null);
          }}
        />
        <SegmentedControl
          name={t('reports.stock.filters.label')}
          options={STOCK_FILTERS}
          value={filter.filter}
          label={(value) => t(`reports.stock.filters.${value}`)}
          onChange={(value) => setParam('filter', value === 'ALL' ? null : value)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('reports.stock.slowDays')}
          active={filter.slowDays !== 90}
          value={String(filter.slowDays)}
          onChange={(event) =>
            setParam('days', event.target.value === '90' ? null : event.target.value)
          }
        >
          {SLOW_DAYS.map((days: SlowDays) => (
            <option key={days} value={days}>
              {t('reports.stock.slowDaysOption', { days })}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <ListCard scroll>
        {report.isPending ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={10} />
            </TableBody>
          </Table>
        ) : rows.length > 0 ? (
          <>
            <StockTable rows={rows} slowDays={filter.slowDays} costs={costs} links />
            <LoadMore query={report} />
          </>
        ) : (
          <EmptyState icon={PackageSearch} title={t('reports.stock.empty')} />
        )}
      </ListCard>
    </div>
  );
}

/** The stock report on paper, its first 500 rows (`/reports/stock/print?days&filter&q`). */
export function StockPrintPage() {
  const { t } = useTranslation();
  const filter = useStockFilter();
  const report = useStockPrint(filter);
  const company = useCompanyName();
  const title = `${t('reports.stock.title')} ${report.data?.date ?? ''}`.trim();
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <PrintHeading
              company={company}
              title={title}
              note={`${t(`reports.stock.filters.${filter.filter}`)} · ${t('reports.stock.slowDaysOption', { days: filter.slowDays })}`}
            />
            <StockTable
              rows={report.data.rows}
              slowDays={filter.slowDays}
              costs={report.data.totals.value !== null}
              links={false}
            />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
