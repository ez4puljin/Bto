import { Boxes } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductSearch } from '@/features/inventory/shared';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type BookOption,
  type StockBalanceQuery,
  type StockBalanceRow,
  useBookDownloads,
  useBookOptions,
  useStockBalance,
  useStockBalanceLines,
} from './book-api';
import {
  addMoney,
  amount,
  type BookColumn,
  categoryOptions,
  COL,
  detailParts,
  detailText,
  GROUP_END,
  isZero,
  NUM,
  type Precision,
  quantity,
  textColumn,
} from './book-format';
import {
  BookActions,
  BookBlank,
  BookPage,
  BookSheet,
  BookTable,
  DetailLabel,
  DetailRow,
  DetailSkeleton,
  DrillCell,
  DrillRow,
  EmptyRow,
  GroupRow,
  MultiPick,
  NoteRow,
  PickedField,
  PrecisionField,
  PromptDialog,
  SelectField,
  SkeletonBody,
  TextCell,
  TotalRow,
} from './book-kit';
import { stockDocHref } from './book-links';
import { idParamOf, idsParam, useBookParams, useDrill, usePromptDates } from './book-state';

type Grouping = 'product' | 'warehouse' | 'category';
const GROUPINGS: readonly Grouping[] = ['product', 'warehouse', 'category'];
const GROUPS = ['opening', 'in', 'out', 'closing'] as const;

function useStockBalanceQuery() {
  const params = useBookParams();
  const { search } = params;
  const grouping: Grouping =
    search.get('by') === 'warehouse'
      ? 'warehouse'
      : search.get('by') === 'category'
        ? 'category'
        : 'product';
  const query = useMemo<StockBalanceQuery | null>(() => {
    if (!params.ready) return null;
    const warehouseIds = idsParam(search, 'w');
    const categoryId = idParamOf(search, 'cat');
    const productId = idParamOf(search, 'pr');
    return {
      from: params.from,
      to: params.to,
      by: grouping === 'warehouse' ? 'warehouse' : 'product',
      ...(warehouseIds.length ? { warehouseIds } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(productId ? { productId } : {}),
    };
  }, [params.ready, params.from, params.to, search, grouping]);
  return { ...params, query, grouping };
}

/** «Тайлан → Бараа материалын үлдэгдэл» (ADR-0133). */
export function StockBalancePage() {
  const { t } = useTranslation();
  const state = useStockBalanceQuery();
  const [prompting, setPrompting] = useState(!state.ready);
  const report = useStockBalance(state.query);
  const options = useBookOptions();
  const downloads = useBookDownloads();
  const action = useAction();
  const title = t('reports.books.titles.stockBalance');
  const filters = [
    ...idsParam(state.search, 'w').map(
      (id) => options.data?.warehouses.find((w) => w.id === id)?.name ?? String(id),
    ),
    ...(state.search.get('catn') ? [state.search.get('catn') ?? ''] : []),
    ...(state.search.get('prn') ? [state.search.get('prn') ?? ''] : []),
  ];
  const values = report.data ? report.data.totals.closingValue !== null : true;
  const openPrompt = () => setPrompting(true);
  return (
    <BookPage columns={stockBalanceColumns(values)}>
      <div className="print:hidden">
        <PageHeader
          compact
          title={title}
          actions={
            <BookActions
              ready={state.query !== null && report.data !== undefined}
              period={state.query}
              onPrompt={openPrompt}
              excelPending={downloads.stockBalance.isPending}
              onExcel={() => {
                const query = state.query;
                if (!query) return;
                void action.run(async () =>
                  saveBlob(
                    await downloads.stockBalance.mutateAsync(query),
                    `baraa-uldegdel-${query.from}-${query.to}.xlsx`,
                  ),
                );
              }}
            />
          }
        />
      </div>
      <StockBalancePrompt
        open={prompting}
        onOpenChange={setPrompting}
        state={state}
        title={title}
        options={options.data}
      />
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      {state.query && (report.data || report.isPending) ? (
        <BookSheet
          title={title}
          period={state.query}
          filters={filters}
          orientation="landscape"
          loading={!report.data}
        >
          <StockBalanceTable
            rows={report.data?.rows ?? null}
            totals={report.data?.totals ?? null}
            truncated={report.data?.truncated ?? false}
            grouping={state.grouping}
            query={state.query}
            precision={state.precision}
            onPrompt={openPrompt}
          />
        </BookSheet>
      ) : (
        <BookBlank title={title} icon={Boxes} orientation="landscape" onPrompt={openPrompt} />
      )}
    </BookPage>
  );
}

/** Code, name, unit, then opening, in, out and closing as quantity (and cost) (landscape A4). */
function stockBalanceColumns(values: boolean): BookColumn[] {
  const pair = values ? [COL.qty, COL.money] : [COL.qty];
  return [COL.code, textColumn(18.5, 10), COL.unit, ...pair, ...pair, ...pair, ...pair];
}

function StockBalancePrompt(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReturnType<typeof useStockBalanceQuery>;
  title: string;
  options: { warehouses: BookOption[]; categories: BookOption[] } | undefined;
}) {
  const { t } = useTranslation();
  const { search } = props.state;
  const dates = usePromptDates(props.state.from, props.state.to);
  const [warehouses, setWarehouses] = useState<string[]>(search.getAll('w'));
  const [categoryId, setCategoryId] = useState(search.get('cat') ?? '');
  const [product, setProduct] = useState<{ id: number; label: string } | null>(null);
  const [grouping, setGrouping] = useState<Grouping>(props.state.grouping);
  const [precision, setPrecision] = useState<Precision>(props.state.precision);
  useEffect(() => {
    if (!props.open) return;
    setWarehouses(search.getAll('w'));
    setCategoryId(search.get('cat') ?? '');
    const id = idParamOf(search, 'pr');
    setProduct(id ? { id, label: search.get('prn') ?? String(id) } : null);
  }, [props.open, search]);
  const categories = useMemo(
    () => categoryOptions(props.options?.categories ?? []),
    [props.options?.categories],
  );
  const submit = () => {
    props.state.apply({
      from: dates.start,
      to: dates.end,
      p: precision === '2' ? null : precision,
      w: warehouses,
      cat: categoryId,
      catn: categories.find((c) => c.value === categoryId)?.label,
      pr: product?.id,
      prn: product?.label,
      by: grouping === 'product' ? null : grouping,
    });
    props.onOpenChange(false);
  };
  return (
    <PromptDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      valid={dates.valid}
      onSubmit={submit}
      dates={dates}
      filters={
        <>
          <MultiPick
            label={t('reports.books.prompt.warehouses')}
            options={(props.options?.warehouses ?? []).map((w) => ({
              value: String(w.id),
              label: `${w.code ?? ''} - ${w.name}`,
              keys: [w.code ?? ''],
            }))}
            values={warehouses}
            onChange={setWarehouses}
          />
          <SelectField
            id="book-category"
            label={t('reports.books.prompt.category')}
            value={categoryId}
            options={categories}
            onChange={setCategoryId}
          />
          <PickedField
            label={t('reports.books.prompt.product')}
            htmlFor="book-product"
            picked={product?.label ?? null}
            onClear={() => setProduct(null)}
          >
            <ProductSearch
              id="book-product"
              className="max-w-none"
              pickLabel={t('reports.prompt.choose')}
              onPick={(picked) =>
                setProduct({ id: picked.id, label: `${picked.sku} - ${picked.name}` })
              }
            />
          </PickedField>
        </>
      }
      view={
        <>
          <PrecisionField value={precision} onChange={setPrecision} />
          <SelectField
            id="book-grouping"
            label={t('reports.books.prompt.grouping')}
            value={grouping}
            emptyLabel=""
            options={GROUPINGS.map((value) => ({
              value,
              label: t(`reports.books.prompt.groupings.${value}`),
            }))}
            onChange={(value) =>
              setGrouping(value === 'warehouse' || value === 'category' ? value : 'product')
            }
          />
        </>
      }
    />
  );
}

interface ValueTotals {
  openingValue: string | null;
  inValue: string | null;
  outValue: string | null;
  closingValue: string | null;
}

function valueSum(rows: readonly StockBalanceRow[]): ValueTotals {
  return rows.reduce<ValueTotals>(
    (sum, row) => ({
      openingValue: addMoney(sum.openingValue, row.openingValue),
      inValue: addMoney(sum.inValue, row.inValue),
      outValue: addMoney(sum.outValue, row.outValue),
      closingValue: addMoney(sum.closingValue, row.closingValue),
    }),
    { openingValue: '0', inValue: '0', outValue: '0', closingValue: '0' },
  );
}

function StockBalanceHead({ values }: { values: boolean }) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead rowSpan={2}>{t('reports.books.columns.sku')}</TableHead>
        <TableHead rowSpan={2}>{t('reports.books.columns.name')}</TableHead>
        <TableHead rowSpan={2} className={GROUP_END}>
          {t('reports.books.head.unit')}
        </TableHead>
        {GROUPS.map((group) => (
          <TableHead key={group} colSpan={values ? 2 : 1} className={cn('text-center', GROUP_END)}>
            {t(`reports.books.table.${group}`)}
          </TableHead>
        ))}
      </TableRow>
      <TableRow>
        {GROUPS.map((group) => (
          <Fragment key={group}>
            <TableHead className={cn('text-right', !values && GROUP_END)}>
              {t('reports.books.table.qty')}
            </TableHead>
            {values ? (
              <TableHead className={cn('text-right', GROUP_END)}>
                {t('reports.books.table.value')}
              </TableHead>
            ) : null}
          </Fragment>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function StockBalanceTable(props: {
  rows: readonly StockBalanceRow[] | null;
  totals: ValueTotals | null;
  truncated: boolean;
  grouping: Grouping;
  query: StockBalanceQuery;
  precision: Precision;
  onPrompt: () => void;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const values = props.totals ? props.totals.closingValue !== null : true;
  const span = values ? 11 : 7;
  const groups = useMemo(() => {
    const rows = props.rows ?? [];
    if (props.grouping === 'product') return [['', [...rows]] as const];
    const map = new Map<string, StockBalanceRow[]>();
    for (const row of rows) {
      const key =
        props.grouping === 'warehouse'
          ? (row.warehouseName ?? '')
          : (row.categoryName ?? t('reports.books.table.noCategory'));
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [props.rows, props.grouping, t]);
  const columns = stockBalanceColumns(values);
  if (props.rows === null || props.totals === null) {
    return (
      <BookTable columns={columns}>
        <StockBalanceHead values={values} />
        <SkeletonBody columns={span} />
      </BookTable>
    );
  }
  if (props.rows.length === 0) {
    return (
      <BookTable columns={columns}>
        <StockBalanceHead values={values} />
        <EmptyRow colSpan={span} onPrompt={props.onPrompt} />
      </BookTable>
    );
  }
  /**
   * A group's quantity and value: a balance (opening, closing) writes «0», a movement is blank
   * when nothing moved; `sum` (a group, the total) writes «0» everywhere and no quantity.
   */
  const pair = (
    qty: string | null,
    value: string | null,
    options: { balance?: boolean; sum?: boolean } = {},
  ) => {
    const zero = options.balance || options.sum ? '0' : '';
    return (
      <>
        <TableCell className={cn(NUM, !values && GROUP_END)}>
          {qty === null ? '' : quantity(qty, zero)}
        </TableCell>
        {values ? (
          <TableCell className={cn(NUM, GROUP_END)}>
            {amount(value, props.precision, zero)}
          </TableCell>
        ) : null}
      </>
    );
  };
  const sums = (totals: ValueTotals) => (
    <>
      {pair(null, totals.openingValue, { sum: true })}
      {pair(null, totals.inValue, { sum: true })}
      {pair(null, totals.outValue, { sum: true })}
      {pair(null, totals.closingValue, { sum: true })}
    </>
  );
  return (
    <BookTable columns={columns}>
      <StockBalanceHead values={values} />
      <TableBody>
        {groups.map(([groupName, rows]) => (
          <Fragment key={groupName}>
            {props.grouping !== 'product' ? (
              <GroupRow>
                <TextCell text={groupName} colSpan={3} className={GROUP_END} />
                {sums(valueSum(rows))}
              </GroupRow>
            ) : null}
            {rows.map((row) => {
              const key = `${row.productId}:${row.warehouseId ?? ''}`;
              const expanded = drill.open.has(key);
              const toggle = () => drill.toggle(key);
              const drillable = !isZero(row.inQty) || !isZero(row.outQty);
              return (
                <Fragment key={key}>
                  <DrillRow expanded={expanded} onToggle={toggle} drillable={drillable}>
                    <DrillCell
                      expanded={expanded}
                      onToggle={toggle}
                      drillable={drillable}
                      text={row.sku}
                    />
                    <TextCell text={row.name} />
                    <TextCell text={row.unit ?? ''} className={GROUP_END} />
                    {pair(row.openingQty, row.openingValue, { balance: true })}
                    {pair(row.inQty, row.inValue)}
                    {pair(row.outQty, row.outValue)}
                    {pair(row.closingQty, row.closingValue, { balance: true })}
                  </DrillRow>
                  {expanded && drillable ? (
                    <StockBalanceDetail
                      query={props.query}
                      productId={row.productId}
                      warehouseIds={row.warehouseId ? [row.warehouseId] : undefined}
                      omit={props.grouping === 'warehouse' ? [groupName] : []}
                      values={values}
                      precision={props.precision}
                      span={span}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
        <TotalRow labelSpan={3}>{sums(props.totals)}</TotalRow>
        {props.truncated ? <NoteRow colSpan={span}>{t('reports.prompt.truncated')}</NoteRow> : null}
      </TableBody>
    </BookTable>
  );
}

/** A product's movements in the period, a click opens the document. */
function StockBalanceDetail(props: {
  query: StockBalanceQuery;
  productId: number;
  warehouseIds?: number[];
  omit: readonly string[];
  values: boolean;
  precision: Precision;
  span: number;
}) {
  const { t } = useTranslation();
  const lines = useStockBalanceLines(props.query, {
    productId: props.productId,
    ...(props.warehouseIds ? { warehouseIds: props.warehouseIds } : {}),
  });
  if (lines.isPending) return <DetailSkeleton colSpan={props.span} />;
  if (lines.error) {
    return (
      <NoteRow colSpan={props.span}>
        <ProblemAlert problem={problemFromError(lines.error)} />
      </NoteRow>
    );
  }
  if (lines.data.rows.length === 0) {
    return <NoteRow colSpan={props.span}>{t('reports.prompt.noLines')}</NoteRow>;
  }
  const blank = props.values ? 2 : 1;
  const end = (last: boolean) => cn(NUM, last && GROUP_END);
  return (
    <>
      {lines.data.rows.map((line, index) => {
        const type = t(`reports.books.docTypes.${line.docType}`, { defaultValue: line.docType });
        const number = line.docNumber ?? String(line.docId);
        const parts = detailParts(number, [line.date, type, line.warehouseName], props.omit);
        const incoming = !isZero(line.inQty);
        return (
          <DetailRow
            key={`${line.docType}:${line.docId}:${line.warehouseId}:${index}`}
            href={stockDocHref(line.docType, line.docId)}
            label={detailText(number, parts)}
          >
            <DetailLabel number={number} parts={parts} colSpan={3} />
            <TableCell colSpan={blank} className={GROUP_END} />
            <TableCell className={end(!props.values)}>{quantity(line.inQty)}</TableCell>
            {props.values ? (
              <TableCell className={end(true)}>
                {incoming ? amount(line.value, props.precision) : ''}
              </TableCell>
            ) : null}
            <TableCell className={end(!props.values)}>{quantity(line.outQty)}</TableCell>
            {props.values ? (
              <TableCell className={end(true)}>
                {incoming ? '' : amount(line.value, props.precision)}
              </TableCell>
            ) : null}
            <TableCell className={NUM}>{quantity(line.balanceQty, '0')}</TableCell>
            {props.values ? <TableCell /> : null}
          </DetailRow>
        );
      })}
      {lines.data.truncated ? (
        <NoteRow colSpan={props.span}>{t('reports.prompt.truncated')}</NoteRow>
      ) : null}
    </>
  );
}
