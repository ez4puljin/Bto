import { TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterChip,
  ListCard,
  ListTable,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
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
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import type { ColumnSpec } from '@/lib/column-layout';
import { saveBlob } from '@/lib/download';
import { formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  PROFIT_GROUPINGS,
  type ProfitGrouping,
  type ProfitReport,
  type ProfitRow,
  SALES_SOURCES,
  type SalesDocument,
  type SalesFilter,
  type SalesSource,
  useProfit,
  useReportDownloads,
  useSalesDocuments,
} from './api';
import { idParam, marginText, NONE, reportHref, useRange } from './report-helpers';
import { AmountCell, ExcelButton, PrintHeading, PrintLink, RefreshControl } from './report-kit';

const isGrouping = (value: string | null): value is ProfitGrouping =>
  PROFIT_GROUPINGS.some((by) => by === value);
const isSource = (value: string | null): value is SalesSource =>
  SALES_SOURCES.some((source) => source === value);

/** The URL parameters of the drill filters (a customer's, a category's … figures). */
const FILTER_KEYS = ['customerId', 'productId', 'categoryId', 'repUserId', 'app', 'label'] as const;

/** The profit report's grouping and filter from the URL. */
function useProfitParams() {
  const [search] = useSearchParams();
  const range = useRange();
  const by = search.get('by');
  const source = search.get('source');
  const filter: SalesFilter = {
    from: range.from,
    to: range.to,
    source: isSource(source) ? source : 'ALL',
    customerId: idParam(search.get('customerId')),
    productId: idParam(search.get('productId')),
    categoryId: idParam(search.get('categoryId')),
    repUserId: idParam(search.get('repUserId')),
    app: search.get('app') === '1',
  };
  return {
    by: isGrouping(by) ? by : ('customer' as const),
    filter,
    valid: range.valid,
    label: search.get('label'),
  };
}

/** The filter's URL parameters, for links to this report or its paper. */
function filterParams(filter: SalesFilter) {
  return {
    from: filter.from,
    to: filter.to,
    source: filter.source && filter.source !== 'ALL' ? filter.source : undefined,
    customerId: filter.customerId,
    productId: filter.productId,
    categoryId: filter.categoryId,
    repUserId: filter.repUserId,
    app: filter.app ? 1 : undefined,
  };
}

/** What a row adds to the filter when it is drilled into, or null when it cannot be. */
function rowFilter(row: ProfitRow): Partial<SalesFilter> | null {
  switch (row.kind) {
    case 'CUSTOMER':
      return row.id ? { customerId: row.id } : null;
    case 'PRODUCT':
      return row.id ? { productId: row.id } : null;
    case 'CATEGORY':
      return row.id ? { categoryId: row.id } : null;
    case 'USER':
      return row.id ? { repUserId: row.id } : null;
    case 'APP':
      return { app: true };
    case 'POS':
      return { source: 'POS' };
    default:
      return null;
  }
}

const rowKey = (row: ProfitRow) => `${row.kind}:${row.id ?? ''}`;

function useRowName() {
  const { t } = useTranslation();
  return (row: ProfitRow): string => {
    if (
      row.kind === 'APP' ||
      row.kind === 'POS' ||
      row.kind === 'COST_ADJ' ||
      row.kind === 'NONE'
    ) {
      return t(`reports.excel.kinds.${row.kind}`);
    }
    if (row.name) return row.name;
    return row.kind === 'CATEGORY' ? t('reports.profit.noCategory') : t('reports.common.noName');
  };
}

/** The report's columns on screen (ADR-0119): the code and quantity only when the grouping shows them. */
function profitColumns(coded: boolean, product: boolean): readonly ColumnSpec[] {
  return [
    ...(coded ? [{ key: 'code', kind: 'code' } as const] : []),
    { key: 'name', kind: 'text', weight: 3, min: 14 },
    ...(product ? [{ key: 'qty', kind: 'qty' } as const] : []),
    { key: 'sales', kind: 'money', width: 10 },
    { key: 'returns', kind: 'money' },
    { key: 'cost', kind: 'money', width: 10 },
    { key: 'profit', kind: 'money', width: 10 },
    { key: 'margin', kind: 'percent' },
    { key: 'chevron', kind: 'chevron' },
  ];
}

/** With `onOpen` (the screen) the columns are sized by the layout; on paper the table lays itself out. */
function ProfitTable(props: { report: ProfitReport; onOpen?: (row: ProfitRow) => void }) {
  const { t } = useTranslation();
  const nameOf = useRowName();
  const { report } = props;
  const columns = 'reports.profit.columns';
  const product = report.by === 'product';
  const coded = report.by !== 'rep';
  const spec = useMemo(() => profitColumns(coded, product), [coded, product]);
  // The cells before the amounts: the name, the code and the quantity when shown.
  const span = 1 + (coded ? 1 : 0) + (product ? 1 : 0);
  const amounts = (row: {
    sales: string;
    returns: string;
    cost: string;
    profit: string;
    margin: string | null;
    flagged?: boolean;
  }) => (
    <>
      <AmountCell value={row.sales} />
      <AmountCell value={row.returns} />
      <AmountCell value={row.cost} />
      <AmountCell value={row.profit} className={row.flagged ? 'text-destructive' : undefined} />
      <TableCell
        className={cn(
          'text-right font-mono whitespace-nowrap',
          row.flagged && 'font-semibold text-destructive',
        )}
      >
        {marginText(row.margin)}
      </TableCell>
    </>
  );
  const body = (
    <>
      <TableHeader>
        <TableRow>
          {coded ? <TableHead>{t(`${columns}.code`)}</TableHead> : null}
          <TableHead>{t(`${columns}.name`)}</TableHead>
          {product ? <TableHead className="text-right">{t(`${columns}.qty`)}</TableHead> : null}
          <TableHead className="text-right">{t(`${columns}.sales`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.returns`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.cost`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.profit`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.margin`)}</TableHead>
          {props.onOpen ? <ChevronHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => {
          const name = nameOf(row);
          const opens = props.onOpen !== undefined && rowFilter(row) !== null;
          const cells = (
            <>
              {coded ? <TableCell className="font-mono">{row.code ?? ''}</TableCell> : null}
              <TruncateCell text={name}>
                {opens ? (
                  <button
                    type="button"
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={() => props.onOpen?.(row)}
                  >
                    {name}
                  </button>
                ) : (
                  name
                )}
              </TruncateCell>
              {product ? (
                <TableCell className="text-right font-mono">
                  {row.qty === null ? '' : formatQty(row.qty)}
                </TableCell>
              ) : null}
              {amounts(row)}
            </>
          );
          return opens ? (
            <ButtonRow key={rowKey(row)} onOpen={() => props.onOpen?.(row)}>
              {cells}
            </ButtonRow>
          ) : (
            <TableRow key={rowKey(row)}>
              {cells}
              {props.onOpen ? <TableCell /> : null}
            </TableRow>
          );
        })}
        {report.others ? (
          <TableRow className="text-muted-foreground">
            <TableCell colSpan={span}>{t('reports.profit.others')}</TableCell>
            {amounts(report.others)}
            {props.onOpen ? <TableCell /> : null}
          </TableRow>
        ) : null}
        <TableRow className="font-semibold">
          <TableCell colSpan={span}>{t('reports.common.total')}</TableCell>
          {amounts(report.totals)}
          {props.onOpen ? <TableCell /> : null}
        </TableRow>
      </TableBody>
    </>
  );
  return props.onOpen ? <ListTable columns={spec}>{body}</ListTable> : <Table>{body}</Table>;
}

/** Where a sales document opens in the app, or null (a credit note opens with its invoice's order). */
function documentHref(doc: SalesDocument): string | null {
  switch (doc.kind) {
    case 'INVOICE':
      return `/finance/invoices?invoice=${doc.id}`;
    case 'POS_SALE':
    case 'POS_RETURN':
      return `/pos/sales?sale=${doc.id}`;
    default:
      return null;
  }
}

const LINK = 'text-link underline-offset-2 hover:underline';

/** A row's documents, newest first; with «Бараагаар» for a customer, a category, a rep … */
function DocumentsSheet(props: {
  row: ProfitRow | null;
  by: ProfitGrouping;
  filter: SalesFilter;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nameOf = useRowName();
  const { row } = props;
  const extra = row ? rowFilter(row) : null;
  const filter = extra ? { ...props.filter, ...extra } : null;
  const documents = useSalesDocuments(filter);
  const columns = 'reports.profit.documents';
  const name = row ? nameOf(row) : '';
  return (
    <RecordSheet
      open={row !== null}
      onClose={props.onClose}
      title={name}
      description={t('reports.common.range', { from: props.filter.from, to: props.filter.to })}
      actions={
        row && filter ? (
          <>
            {props.by !== 'product' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate(
                    reportHref('/reports/profit', {
                      by: 'product',
                      ...filterParams(filter),
                      label: name,
                    }),
                  )
                }
              >
                {t('reports.profit.byProducts')}
              </Button>
            ) : null}
            {row.kind === 'CUSTOMER' && row.id ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/partners/customers/${row.id}`}>{t('reports.profit.openCustomer')}</Link>
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {row ? (
        <div className="flex flex-col gap-4">
          <FactChips
            facts={[
              { label: t('reports.profit.columns.sales'), value: formatTugrik(row.sales) },
              { label: t('reports.profit.columns.profit'), value: formatTugrik(row.profit) },
              {
                label: t('reports.profit.columns.margin'),
                value: (
                  <span className={row.flagged ? 'font-semibold text-destructive' : undefined}>
                    {marginText(row.margin)}
                  </span>
                ),
              },
            ]}
          />
          <PanelSection title={t(`${columns}.title`)}>
            <ProblemAlert problem={problemFromError(documents.error)} onRetry={documents.refetch} />
            {documents.data?.more ? (
              <p className="text-[0.8125rem] text-muted-foreground">{t(`${columns}.more`)}</p>
            ) : null}
            {documents.data && documents.data.rows.length === 0 ? (
              <EmptyState title={t(`${columns}.empty`)} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t(`${columns}.date`)}</TableHead>
                    <TableHead>{t(`${columns}.number`)}</TableHead>
                    <TableHead>{t(`${columns}.kind`)}</TableHead>
                    <TableHead>{t(`${columns}.order`)}</TableHead>
                    <TableHead>{t(`${columns}.customer`)}</TableHead>
                    <TableHead className="text-right">
                      {t('reports.profit.columns.sales')}
                    </TableHead>
                    <TableHead className="text-right">{t('reports.profit.columns.cost')}</TableHead>
                    <TableHead className="text-right">
                      {t('reports.profit.columns.profit')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('reports.profit.columns.margin')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.isPending ? <SkeletonRows columns={9} rows={3} /> : null}
                  {documents.data?.rows.map((doc) => {
                    const href = documentHref(doc);
                    const number = doc.number ?? t(`reports.profit.docKinds.${doc.kind}`);
                    return (
                      <TableRow key={`${doc.kind}:${doc.id}`}>
                        <TableCell className="font-mono">{doc.date}</TableCell>
                        <TableCell className="font-mono">
                          {href ? (
                            <Link className={LINK} to={href}>
                              {number}
                            </Link>
                          ) : (
                            number
                          )}
                        </TableCell>
                        <TableCell>{t(`reports.profit.docKinds.${doc.kind}`)}</TableCell>
                        <TableCell className="font-mono">
                          {doc.orderId ? (
                            <Link className={LINK} to={`/sales/boards?order=${doc.orderId}`}>
                              {`#${doc.orderId}`}
                            </Link>
                          ) : (
                            ''
                          )}
                        </TableCell>
                        <TruncateCell text={doc.customerName ?? ''}>
                          {doc.customerId ? (
                            <Link className={LINK} to={`/partners/customers/${doc.customerId}`}>
                              {doc.customerName ?? `#${doc.customerId}`}
                            </Link>
                          ) : (
                            (doc.customerName ?? '')
                          )}
                        </TruncateCell>
                        <AmountCell value={doc.sales} />
                        <AmountCell value={doc.cost} />
                        <AmountCell value={doc.profit} />
                        <TableCell className="text-right font-mono">
                          {marginText(doc.margin)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </PanelSection>
        </div>
      ) : null}
    </RecordSheet>
  );
}

/**
 * «Тайлан → Ашигт ажиллагаа» (ADR-0108): sales ex VAT, returns, cost, profit and margin by customer,
 * product, category or rep; a row opens its documents, a margin under the threshold reads red.
 */
export function ProfitPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const setParam = useSetParam();
  const { by, filter, valid, label } = useProfitParams();
  const report = useProfit(by, valid ? filter : null);
  const downloads = useReportDownloads();
  const action = useAction();
  const open = search.get('row');
  const openRow = report.data?.rows.find((row) => rowKey(row) === open) ?? null;
  const drilled = Boolean(
    filter.customerId || filter.productId || filter.categoryId || filter.repUserId || filter.app,
  );
  const clearDrill = () =>
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        for (const key of FILTER_KEYS) params.delete(key);
        params.delete('row');
        return params;
      },
      { replace: true },
    );
  return (
    <div>
      <PageHeader
        title={t('reports.profit.title')}
        description={t('reports.profit.description')}
        meta={
          report.data ? (
            <span className="text-[0.8125rem]">
              {t('reports.profit.threshold', { threshold: report.data.threshold })}
            </span>
          ) : undefined
        }
        actions={
          <>
            <RefreshControl />
            <ExcelButton
              disabled={!valid || downloads.profit.isPending}
              onClick={() =>
                void action.run(async () =>
                  saveBlob(
                    await downloads.profit.mutateAsync({ by, filter }),
                    `profit-${by}-${filter.from}-${filter.to}.xlsx`,
                  ),
                )
              }
            />
            <PrintLink
              to={reportHref('/reports/profit/print', {
                by,
                ...filterParams(filter),
                label,
                format: 'a4',
              })}
            />
          </>
        }
      />
      <FilterBar>
        <SegmentedControl
          name={t('reports.profit.by.label')}
          options={PROFIT_GROUPINGS}
          value={by}
          label={(value) => t(`reports.profit.by.${value}`)}
          onChange={(value) =>
            setSearch(
              (current) => {
                const params = new URLSearchParams(current);
                params.set('by', value);
                params.delete('row');
                return params;
              },
              { replace: true },
            )
          }
        />
        <DateRangeFilter
          label={t('reports.common.period')}
          fromLabel={t('reports.common.from')}
          toLabel={t('reports.common.to')}
          from={filter.from}
          to={filter.to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('reports.profit.sources.label')}
          active={filter.source !== 'ALL'}
          value={filter.source}
          onChange={(event) =>
            setParam('source', event.target.value === 'ALL' ? null : event.target.value)
          }
        >
          {SALES_SOURCES.map((source) => (
            <option key={source} value={source}>
              {t(`reports.profit.sources.${source}`)}
            </option>
          ))}
        </NativeSelect>
        {drilled ? (
          <FilterChip clearLabel={t('reports.common.clearFilter')} onClear={clearDrill}>
            {t('reports.common.filter', { label: label ?? t('reports.common.noName') })}
          </FilterChip>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <ListCard scroll>
        {report.isPending && valid ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={8} />
            </TableBody>
          </Table>
        ) : report.data && report.data.rows.length > 0 ? (
          <ProfitTable report={report.data} onOpen={(row) => setParam('row', rowKey(row))} />
        ) : (
          <EmptyState icon={TrendingUp} title={t('reports.profit.empty')} />
        )}
      </ListCard>
      <DocumentsSheet row={openRow} by={by} filter={filter} onClose={() => setParam('row', null)} />
    </div>
  );
}

/** The profit report on paper (`/reports/profit/print?by&from&to…`). */
export function ProfitPrintPage() {
  const { t } = useTranslation();
  const { by, filter, valid, label } = useProfitParams();
  const report = useProfit(by, valid ? filter : null);
  const company = useCompanyName();
  const title = `${t('reports.profit.title')} · ${t(`reports.profit.by.${by}`)}`;
  const notes = [
    t('reports.common.range', { from: filter.from, to: filter.to }),
    filter.source && filter.source !== 'ALL' ? t(`reports.profit.sources.${filter.source}`) : null,
    label,
  ].filter(Boolean);
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[0.75rem]">
            <PrintHeading company={company} title={title} note={notes.join(' · ') || NONE} />
            <ProfitTable report={report.data} />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
