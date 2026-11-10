import { addDays, businessDate, businessMonthStart } from '@tugeel/shared/time';
import { ClipboardCheck, FileDown, Printer } from 'lucide-react';
import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, FilterBar, ListCard, SearchField, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { categoryPaths } from '@/features/catalog/category-tree';
import { useCategories } from '@/features/catalog/api';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import { useStockBalanceLines } from '@/features/reports/books/book-api';
import { stockDocHref } from '@/features/reports/books/book-links';
import { useSegments } from '@/features/segments/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  SHEET_FILTERS,
  type StockCountDetail,
  type StockCountSheetFilter,
  type StockCountSheetQuery,
  type StockCountSheetRow,
  type StockCountSheetTotals,
  useStockCountLineEntries,
  useStockCountMutations,
  useStockCountSheet,
} from './counts-api';
import { useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';
import { groupBySupplier, sheetSearch, signedMnt, signedQty, sumsOf } from './stock-count-helpers';

// The count sheet (ADR-0177), drawn after the old system's «Тооллогын хуудас»: the tiles over the
// whole count, the views and filters, the products by supplier with their difference at the
// selling price and a reason each, a product's report on a click, and the sheet on paper.

const KINDS = ['WHOLESALE', 'STORE'] as const;
const isZero = (value: string) => new RegExp('^-?0(\\.0+)?$').test(value);
const tone = (value: string | null) =>
  value === null || isZero(value)
    ? undefined
    : value.startsWith('-')
      ? 'text-destructive'
      : 'text-success';
const NUM = 'text-right font-mono tabular-nums';

/** The count of each view, from the tiles: «Тааараагүй 207». */
function viewCount(totals: StockCountSheetTotals, view: StockCountSheetFilter): number {
  switch (view) {
    case 'DIFFERENT':
      return totals.different;
    case 'MATCHED':
      return totals.matched;
    case 'UNLISTED':
      return totals.unlisted;
    case 'UNCOUNTED':
      return totals.uncounted;
    case 'ALL':
      return totals.lines;
  }
}

const idOf = (value: string) => (value ? Number.parseInt(value, 10) : undefined);

export function CountSheet({
  detail,
  mayEdit,
}: {
  detail: StockCountDetail;
  /** Reasons are written while the count is counted or reviewed, by its approver. */
  mayEdit: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StockCountSheetFilter>('DIFFERENT');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const query: StockCountSheetQuery = {
    filter,
    ...(q ? { q } : {}),
    ...(supplierId ? { supplierId: idOf(supplierId) } : {}),
    ...(categoryId ? { categoryId: idOf(categoryId) } : {}),
    ...(segmentId ? { segmentId: idOf(segmentId) } : {}),
  };
  const sheet = useStockCountSheet(detail.id, query, detail.status === 'COUNTING');
  const categories = useCategories();
  const segments = useSegments('PRODUCT');
  const categoryOptions = useMemo(
    () =>
      [...categoryPaths(categories.data ?? [])]
        .map(([id, path]) => ({ id, path }))
        .sort((a, b) => a.path.localeCompare(b.path, 'mn')),
    [categories.data],
  );

  // The product report's place and period: the count's warehouse, from the start of its month.
  const started = detail.startedAt ? businessDate(new Date(detail.startedAt)) : businessDate();
  const [reportWarehouse, setReportWarehouse] = useState<number | undefined>(detail.warehouseId);
  const [from, setFrom] = useState<string | undefined>(
    businessMonthStart(new Date(`${started}T12:00:00+08:00`)),
  );
  const [to, setTo] = useState<string | undefined>(detail.effectiveDate ?? businessDate());
  const warehouses = useWarehouseOptions(KINDS);
  const [opened, setOpened] = useState<StockCountSheetRow | null>(null);

  const data = sheet.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const groups = useMemo(() => groupBySupplier(rows), [rows]);
  const shown = useMemo(() => sumsOf(rows), [rows]);
  const numbers = useMemo(() => new Map(rows.map((row, index) => [row.lineId, index + 1])), [rows]);
  const printHref = (pdf: boolean) =>
    `/inventory/counts/${detail.id}/print?${sheetSearch(query)}${pdf ? '&pdf=1' : ''}`;

  return (
    <section className="flex flex-col gap-3">
      {data ? <SheetTiles totals={data.totals} /> : null}
      {data && data.totals.unpriced > 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('inventory.counts.sheet.unpriced', { count: data.totals.unpriced })}
        </p>
      ) : null}

      <FilterBar
        className="mb-0"
        end={
          <>
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.counts.sheet.reportFor')}
            </span>
            <WarehouseSelect
              variant="filter"
              label={t('inventory.counts.sheet.reportWarehouse')}
              options={warehouses.options}
              value={reportWarehouse}
              onChange={setReportWarehouse}
              emptyLabel={t('inventory.allWarehouses')}
            />
            <DateRangeFilter
              label={t('inventory.counts.sheet.period')}
              fromLabel={t('inventory.counts.variance.from')}
              toLabel={t('inventory.counts.variance.to')}
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
            />
          </>
        }
      >
        <SegmentedControl
          name={t('inventory.counts.lines.filter')}
          options={SHEET_FILTERS}
          value={filter}
          label={(value) =>
            data
              ? t('inventory.counts.sheet.viewCount', {
                  view: t(`inventory.counts.sheet.views.${value}`),
                  count: viewCount(data.totals, value),
                })
              : t(`inventory.counts.sheet.views.${value}`)
          }
          onChange={setFilter}
        />
      </FilterBar>
      <FilterBar
        className="mb-0"
        end={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={printHref(true)} target="_blank" rel="noreferrer">
                <FileDown />
                {t('inventory.counts.sheet.pdf')}
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={printHref(false)} target="_blank" rel="noreferrer">
                <Printer />
                {t('inventory.counts.sheet.print')}
              </a>
            </Button>
          </>
        }
      >
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('inventory.counts.searchProduct')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <NativeSelect
          variant="filter"
          className="max-w-60"
          aria-label={t('inventory.counts.sheet.supplier')}
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
        >
          <option value="">{t('inventory.counts.sheet.allSuppliers')}</option>
          {(data?.suppliers ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          className="max-w-60"
          aria-label={t('inventory.counts.categories')}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">{t('inventory.counts.sheet.allCategories')}</option>
          {categoryOptions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.path}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          className="max-w-52"
          aria-label={t('inventory.counts.segment')}
          value={segmentId}
          onChange={(event) => setSegmentId(event.target.value)}
        >
          <option value="">{t('inventory.counts.sheet.allSegments')}</option>
          {(segments.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <ProblemAlert problem={problemFromError(sheet.error)} onRetry={sheet.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-12 text-right">{t('inventory.counts.sheet.no')}</TableHead>
              <TableHead className="w-28">{t('inventory.counts.sheet.code')}</TableHead>
              <TableHead>{t('inventory.counts.sheet.name')}</TableHead>
              <TableHead className="w-24 text-right">{t('inventory.counts.expected')}</TableHead>
              <TableHead className="w-24 text-right">{t('inventory.counts.counted')}</TableHead>
              <TableHead className="w-20 text-right">{t('inventory.counts.difference')}</TableHead>
              <TableHead className="w-24 text-right">{t('inventory.counts.sheet.price')}</TableHead>
              <TableHead className="w-28 text-right">
                {t('inventory.counts.sheet.amount')}
              </TableHead>
              <TableHead className="w-[22rem]">{t('inventory.counts.sheet.reason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.supplierId ?? 'none'}>
                <TableRow className="bg-success-soft/50 hover:bg-success-soft/50">
                  <TableCell colSpan={9} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
                      <span className="font-semibold">
                        {group.supplierName ?? t('inventory.counts.sheet.noSupplier')}
                      </span>
                      <span className="text-muted-foreground">
                        {t('inventory.counts.sheet.groupCount', { count: group.rows.length })}
                      </span>
                      <span className="ml-auto flex flex-wrap gap-x-3">
                        <GroupSum
                          label={t('inventory.counts.sheet.surplus')}
                          qty={group.surplusQty}
                          amount={group.surplusAmount}
                        />
                        <GroupSum
                          label={t('inventory.counts.sheet.shortage')}
                          qty={group.shortageQty}
                          amount={group.shortageAmount}
                        />
                        <span className={cn('font-medium', tone(group.netAmount))}>
                          {t('inventory.counts.sheet.netShort', {
                            amount: signedMnt(group.netAmount),
                          })}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
                {group.rows.map((row) => (
                  <SheetRow
                    key={row.lineId}
                    index={numbers.get(row.lineId) ?? 0}
                    row={row}
                    countId={detail.id}
                    mayEdit={mayEdit}
                    onOpen={() => setOpened(row)}
                  />
                ))}
              </Fragment>
            ))}
            {rows.length > 0 ? (
              <TableRow className="bg-muted/60 font-medium hover:bg-muted/60">
                <TableCell colSpan={5} className="text-right">
                  {t('inventory.counts.sheet.shownTotal', {
                    surplusQty: signedQty(shown.surplusQty),
                    surplusAmount: signedMnt(shown.surplusAmount),
                    shortageQty: signedQty(shown.shortageQty),
                    shortageAmount: signedMnt(shown.shortageAmount),
                  })}
                </TableCell>
                <TableCell className={cn(NUM, tone(shown.netQty))}>
                  {signedQty(shown.netQty)}
                </TableCell>
                <TableCell />
                <TableCell className={cn(NUM, tone(shown.netAmount))}>
                  {signedMnt(shown.netAmount)}
                </TableCell>
                <TableCell />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {!sheet.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={
              detail.scopeMode === 'SCANNED' && filter === 'ALL' && q === ''
                ? t('inventory.counts.lines.emptyScanned')
                : t('inventory.counts.lines.empty')
            }
          />
        ) : null}
        {data?.truncated ? (
          <p className="px-4 py-2 text-[0.8125rem] text-muted-foreground">
            {t('inventory.counts.sheet.truncated')}
          </p>
        ) : null}
      </ListCard>

      <Dialog open={opened !== null} onOpenChange={(open) => (open ? undefined : setOpened(null))}>
        {opened ? (
          <ProductReportDialog
            countId={detail.id}
            row={opened}
            warehouseId={reportWarehouse}
            from={from ?? addDays(businessDate(), -30)}
            to={to ?? businessDate()}
            onClose={() => setOpened(null)}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function GroupSum(props: { label: string; qty: string; amount: string }) {
  const { t } = useTranslation();
  if (isZero(props.qty)) return null;
  return (
    <span className={tone(props.qty)}>
      {t('inventory.counts.sheet.groupSum', {
        label: props.label,
        qty: signedQty(props.qty),
        amount: signedMnt(props.amount),
      })}
    </span>
  );
}

/** The six tiles over the whole count, whatever the view. */
export function SheetTiles({ totals }: { totals: StockCountSheetTotals }) {
  const { t } = useTranslation();
  const tiles = [
    {
      label: t('inventory.counts.sheet.tiles.lines'),
      value: String(totals.lines),
      sub: t('inventory.counts.sheet.tiles.linesSub', {
        counted: totals.counted,
        uncounted: totals.uncounted,
      }),
    },
    {
      label: t('inventory.counts.sheet.tiles.matched'),
      value: String(totals.matched),
      valueTone: 'text-success',
    },
    {
      label: t('inventory.counts.sheet.tiles.different'),
      value: String(totals.different),
      valueTone: totals.different > 0 ? 'text-warning' : undefined,
      sub: t('inventory.counts.sheet.tiles.differentSub', {
        surplus: totals.surplusLines,
        shortage: totals.shortageLines,
      }),
    },
    {
      label: t('inventory.counts.sheet.surplus'),
      value: t('inventory.counts.sheet.tiles.pieces', { qty: signedQty(totals.surplusQty) }),
      valueTone: tone(totals.surplusQty),
      sub: signedMnt(totals.surplusAmount),
    },
    {
      label: t('inventory.counts.sheet.shortage'),
      value: t('inventory.counts.sheet.tiles.pieces', { qty: signedQty(totals.shortageQty) }),
      valueTone: tone(totals.shortageQty),
      sub: signedMnt(totals.shortageAmount),
    },
    {
      label: t('inventory.counts.sheet.tiles.net'),
      value: signedMnt(totals.netAmount),
      valueTone: tone(totals.netAmount),
      sub: t('inventory.counts.sheet.tiles.pieces', { qty: signedQty(totals.netQty) }),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.06]"
        >
          <div className="text-[0.75rem] text-muted-foreground">{tile.label}</div>
          <div className={cn('font-mono text-lg font-semibold tabular-nums', tile.valueTone)}>
            {tile.value}
          </div>
          {tile.sub ? <div className="text-[0.75rem] text-muted-foreground">{tile.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

function SheetRow(props: {
  index: number;
  row: StockCountSheetRow;
  countId: number;
  mayEdit: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const open = {
    className: 'cursor-pointer',
    onClick: props.onOpen,
  };
  return (
    <TableRow
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) props.onOpen();
      }}
    >
      <TableCell {...open} className={cn(open.className, 'text-right text-muted-foreground')}>
        {props.index}
      </TableCell>
      <TableCell {...open} className={cn(open.className, 'font-mono text-primary')}>
        {row.sku}
      </TableCell>
      <TableCell {...open}>
        <span className="font-medium">{row.name}</span>
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {row.listed ? null : <Badge variant="outline">{t('inventory.counts.sheet.added')}</Badge>}
          {isZero(row.movedDuring) ? null : (
            <Badge variant="secondary">
              {t('inventory.counts.lines.movedDuring', { qty: signedQty(row.movedDuring) })}
            </Badge>
          )}
          {isZero(row.movedAfter) ? null : (
            <Badge variant="warning">
              {t('inventory.counts.lines.movedAfter', { qty: signedQty(row.movedAfter) })}
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell {...open} className={cn(open.className, NUM)}>
        {row.expectedQty === null ? '' : formatQty(row.expectedQty)}
      </TableCell>
      <TableCell {...open} className={cn(open.className, NUM)}>
        {row.countedQty === null ? '' : formatQty(row.countedQty)}
        {isZero(row.pendingQty) ? null : (
          <span className="block text-[0.75rem] text-muted-foreground">
            {t('inventory.counts.lines.pending', { qty: formatQty(row.pendingQty) })}
          </span>
        )}
      </TableCell>
      <TableCell
        {...open}
        className={cn(open.className, NUM, 'font-medium', tone(row.differenceQty))}
      >
        {row.differenceQty === null ? '' : signedQty(row.differenceQty)}
      </TableCell>
      <TableCell {...open} className={cn(open.className, NUM)}>
        {row.salePrice === null ? '' : formatMnt(row.salePrice)}
      </TableCell>
      <TableCell {...open} className={cn(open.className, NUM, tone(row.differenceAmount))}>
        {row.differenceAmount === null ? '' : signedMnt(row.differenceAmount)}
      </TableCell>
      <TableCell className="py-1">
        {props.mayEdit ? (
          <ReasonInput
            key={`${row.lineId}:${row.reason ?? ''}`}
            countId={props.countId}
            row={row}
          />
        ) : (
          <span className="text-[0.8125rem]">{row.reason ?? ''}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** The reason, saved when the box is left with another text. */
function ReasonInput({ countId, row }: { countId: number; row: StockCountSheetRow }) {
  const { t } = useTranslation();
  const mutations = useStockCountMutations();
  const [value, setValue] = useState(row.reason ?? '');
  const [failed, setFailed] = useState(false);
  const placeholder =
    row.differenceQty === null || isZero(row.differenceQty)
      ? t('inventory.counts.sheet.reasonPlaceholder')
      : row.differenceQty.startsWith('-')
        ? t('inventory.counts.sheet.shortageReason')
        : t('inventory.counts.sheet.surplusReason');
  const save = () => {
    if (value.trim() === (row.reason ?? '')) return;
    setFailed(false);
    mutations.reason.mutate(
      { id: countId, lineId: row.lineId, reason: value },
      { onError: () => setFailed(true) },
    );
  };
  return (
    <Input
      aria-label={t('inventory.counts.sheet.reasonFor', { name: row.name })}
      aria-invalid={failed || undefined}
      title={failed ? t('inventory.counts.sheet.reasonFailed') : undefined}
      className="h-8 text-[0.8125rem]"
      value={value}
      maxLength={500}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

const time = (value: string) => formatUbDateTime(Date.parse(value));

/** One product: its stock report for the chosen place and period, and who counted it. */
function ProductReportDialog(props: {
  countId: number;
  row: StockCountSheetRow;
  warehouseId: number | undefined;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const report = useStockBalanceLines(
    {
      from: props.from,
      to: props.to,
      ...(props.warehouseId === undefined ? {} : { warehouseIds: [props.warehouseId] }),
    },
    { productId: row.productId },
  );
  const entries = useStockCountLineEntries(props.countId, row.lineId);
  const lines = report.data?.rows ?? [];
  const closing = lines.at(-1)?.balanceQty ?? report.data?.openingQty ?? null;
  return (
    <DialogContent closeLabel={t('common.close')} size="xl">
      <DialogHeader>
        <DialogTitle>{row.name}</DialogTitle>
        <DialogDescription>
          {t('inventory.counts.sheet.reportSummary', {
            sku: row.sku,
            from: props.from,
            to: props.to,
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
        <ProblemAlert problem={problemFromError(report.error) ?? problemFromError(entries.error)} />
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('inventory.counts.line.report')}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.date')}</TableHead>
                <TableHead>{t('inventory.counts.line.document')}</TableHead>
                <TableHead className="text-right">{t('inventory.counts.sheet.in')}</TableHead>
                <TableHead className="text-right">{t('inventory.counts.sheet.out')}</TableHead>
                <TableHead className="text-right">{t('inventory.counts.sheet.balance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={4} className="font-medium">
                  {t('inventory.counts.sheet.opening', { date: props.from })}
                </TableCell>
                <TableCell className={NUM}>
                  {report.data ? formatQty(report.data.openingQty) : ''}
                </TableCell>
              </TableRow>
              {lines.map((line, index) => {
                const href = stockDocHref(line.docType, line.docId);
                const label = `${t(`reports.books.docTypes.${line.docType}`, {
                  defaultValue: line.docType,
                })} ${line.docNumber ?? ''}`.trim();
                return (
                  <TableRow key={`${line.docType}:${line.docId}:${index}`}>
                    <TableCell className="font-mono">{line.date}</TableCell>
                    <TableCell>
                      {href ? (
                        <Link to={href} className="font-medium underline-offset-4 hover:underline">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                      {props.warehouseId === undefined ? (
                        <span className="ml-2 text-[0.75rem] text-muted-foreground">
                          {line.warehouseName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className={NUM}>
                      {isZero(line.inQty) ? '' : formatQty(line.inQty)}
                    </TableCell>
                    <TableCell className={NUM}>
                      {isZero(line.outQty) ? '' : formatQty(line.outQty)}
                    </TableCell>
                    <TableCell className={NUM}>{formatQty(line.balanceQty)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                <TableCell colSpan={4}>
                  {t('inventory.counts.sheet.closing', { date: props.to })}
                </TableCell>
                <TableCell className={NUM}>{closing === null ? '' : formatQty(closing)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {report.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {report.data?.truncated ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('reports.prompt.truncated')}
            </p>
          ) : null}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('inventory.counts.line.entries')}</h3>
          {(entries.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {entries.isPending ? t('common.loading') : t('inventory.counts.line.noEntries')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.date')}</TableHead>
                  <TableHead>{t('inventory.counts.sessions.counter')}</TableHead>
                  <TableHead className="text-right">{t('inventory.counts.line.entered')}</TableHead>
                  <TableHead className="text-right">{t('inventory.counts.line.base')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries.data ?? []).map((entry) => (
                  <TableRow key={entry.id} className={entry.voided ? 'opacity-60' : undefined}>
                    <TableCell className="font-mono">{time(entry.createdAt)}</TableCell>
                    <TableCell>{entry.userName}</TableCell>
                    <TableCell className={NUM}>
                      {`${formatQty(entry.enteredQty)} ${entry.unitName}`}
                    </TableCell>
                    <TableCell className={cn(NUM, entry.voided && 'line-through')}>
                      {formatQty(entry.qtyBase)}
                    </TableCell>
                    <TableCell>
                      {entry.voided ? (
                        <Badge variant="outline">{t('inventory.counts.line.voided')}</Badge>
                      ) : entry.sent ? null : (
                        <Badge variant="warning">{t('inventory.counts.sessions.notSent')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
      <DialogFooter>
        <Button onClick={props.onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
