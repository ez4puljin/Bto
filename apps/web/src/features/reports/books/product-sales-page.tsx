import { ShoppingBasket } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProductSearch } from '@/features/inventory/shared';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import {
  type BookOptions,
  type ProductSalesQuery,
  type ProductSalesRow,
  useBookDownloads,
  useBookOptions,
  useProductSales,
  useProductSalesDocuments,
} from './book-api';
import {
  addMoney,
  amount,
  BOOK_TABLE,
  categoryOptions,
  NUM,
  type Precision,
  quantity,
} from './book-format';
import {
  BookActions,
  BookSheet,
  DateFields,
  DetailRow,
  DrillMark,
  DrillRow,
  NoteRow,
  PickedField,
  PrecisionField,
  PromptDialog,
  SelectField,
} from './book-kit';
import { salesDocHref } from './book-links';
import { idParamOf, useBookParams, useDrill, usePromptDates } from './book-state';

type Grouping = 'none' | 'category';
const SOURCES = ['ALL', 'WHOLESALE', 'POS'] as const;
const KINDS = ['ALL', 'SALES', 'RETURNS'] as const;
type Source = (typeof SOURCES)[number];
type Kind = (typeof KINDS)[number];

function useProductSalesQuery() {
  const params = useBookParams();
  const { search } = params;
  const grouping: Grouping = search.get('by') === 'category' ? 'category' : 'none';
  const query = useMemo<ProductSalesQuery | null>(() => {
    if (!params.ready) return null;
    const source = SOURCES.find((value) => value === search.get('src'));
    const kind = KINDS.find((value) => value === search.get('kind'));
    const ids = {
      repUserId: idParamOf(search, 'rep'),
      customerCategoryId: idParamOf(search, 'cc'),
      customerId: idParamOf(search, 'c'),
      productId: idParamOf(search, 'pr'),
      categoryId: idParamOf(search, 'cat'),
      warehouseId: idParamOf(search, 'w'),
    };
    return {
      from: params.from,
      to: params.to,
      ...(source && source !== 'ALL' ? { source } : {}),
      ...(kind && kind !== 'ALL' ? { kind } : {}),
      ...Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined)),
    };
  }, [params.ready, params.from, params.to, search]);
  return { ...params, query, grouping };
}

/** «Тайлан → Борлуулалт /Бараагаар/» (ADR-0133). */
export function ProductSalesPage() {
  const { t } = useTranslation();
  const state = useProductSalesQuery();
  const [prompting, setPrompting] = useState(!state.ready);
  const report = useProductSales(state.query);
  const options = useBookOptions();
  const downloads = useBookDownloads();
  const action = useAction();
  const title = t('reports.books.titles.productSales');
  const { search } = state;
  const filters = [
    ...(idParamOf(search, 'rep')
      ? [options.data?.users.find((u) => u.id === idParamOf(search, 'rep'))?.name ?? '']
      : []),
    ...(idParamOf(search, 'cc')
      ? [options.data?.customerCategories.find((c) => c.id === idParamOf(search, 'cc'))?.name ?? '']
      : []),
    ...(idParamOf(search, 'w')
      ? [options.data?.warehouses.find((w) => w.id === idParamOf(search, 'w'))?.name ?? '']
      : []),
    ...['cn', 'prn', 'catn'].flatMap((key) => (search.get(key) ? [search.get(key) ?? ''] : [])),
    ...(search.get('src')
      ? [t(`reports.books.prompt.sources.${search.get('src') as Source}`)]
      : []),
    ...(search.get('kind') ? [t(`reports.books.prompt.kinds.${search.get('kind') as Kind}`)] : []),
  ].filter(Boolean);
  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={t('reports.books.descriptions.productSales')}
          actions={
            <BookActions
              ready={state.query !== null}
              onPrompt={() => setPrompting(true)}
              excelPending={downloads.productSales.isPending}
              onExcel={() => {
                const query = state.query;
                if (!query) return;
                void action.run(async () =>
                  saveBlob(
                    await downloads.productSales.mutateAsync(query),
                    `borluulalt-baraagaar-${query.from}-${query.to}.xlsx`,
                  ),
                );
              }}
            />
          }
        />
      </div>
      <ProductSalesPrompt
        open={prompting}
        onOpenChange={setPrompting}
        state={state}
        title={title}
        options={options.data}
      />
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      {state.query && report.data ? (
        <BookSheet title={title} from={state.query.from} to={state.query.to} filters={filters}>
          <ProductSalesTable
            rows={report.data.rows}
            totals={report.data.totals}
            truncated={report.data.truncated}
            grouping={state.grouping}
            query={state.query}
            precision={state.precision}
          />
        </BookSheet>
      ) : !state.query ? (
        <EmptyState icon={ShoppingBasket} title={t('reports.prompt.waiting')} />
      ) : null}
    </div>
  );
}

function ProductSalesPrompt(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReturnType<typeof useProductSalesQuery>;
  title: string;
  options: BookOptions | undefined;
}) {
  const { t } = useTranslation();
  const { search } = props.state;
  const dates = usePromptDates(props.state.from, props.state.to);
  const [rep, setRep] = useState(search.get('rep') ?? '');
  const [categoryOfCustomers, setCategoryOfCustomers] = useState(search.get('cc') ?? '');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerLabel, setCustomerLabel] = useState(search.get('cn'));
  const [source, setSource] = useState(search.get('src') ?? 'ALL');
  const [grouping, setGrouping] = useState<Grouping>(props.state.grouping);
  const [product, setProduct] = useState<{ id: number; label: string } | null>(null);
  const [categoryId, setCategoryId] = useState(search.get('cat') ?? '');
  const [warehouse, setWarehouse] = useState(search.get('w') ?? '');
  const [kind, setKind] = useState(search.get('kind') ?? 'ALL');
  const [precision, setPrecision] = useState<Precision>(props.state.precision);
  useEffect(() => {
    if (!props.open) return;
    setRep(search.get('rep') ?? '');
    setCategoryOfCustomers(search.get('cc') ?? '');
    setCustomer(null);
    setCustomerLabel(search.get('cn'));
    setSource(search.get('src') ?? 'ALL');
    const id = idParamOf(search, 'pr');
    setProduct(id ? { id, label: search.get('prn') ?? String(id) } : null);
    setCategoryId(search.get('cat') ?? '');
    setWarehouse(search.get('w') ?? '');
    setKind(search.get('kind') ?? 'ALL');
  }, [props.open, search]);
  const categories = useMemo(
    () => categoryOptions(props.options?.categories ?? []),
    [props.options?.categories],
  );
  const customerId = customer?.id ?? (customerLabel ? idParamOf(search, 'c') : undefined);
  const submit = () => {
    props.state.apply({
      from: dates.start,
      to: dates.end,
      p: precision === '2' ? null : precision,
      rep,
      cc: categoryOfCustomers,
      c: customerId,
      cn: customerId ? (customer ? `${customer.name} · ${customer.code}` : customerLabel) : null,
      src: source === 'ALL' ? null : source,
      by: grouping === 'none' ? null : grouping,
      pr: product?.id,
      prn: product?.label,
      cat: categoryId,
      catn: categories.find((c) => c.value === categoryId)?.label,
      w: warehouse,
      kind: kind === 'ALL' ? null : kind,
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
    >
      <div className="flex flex-col gap-4">
        <SelectField
          id="book-rep"
          label={t('reports.books.prompt.rep')}
          value={rep}
          options={(props.options?.users ?? []).map((u) => ({
            value: String(u.id),
            label: u.name,
          }))}
          onChange={setRep}
        />
        <SelectField
          id="book-customer-category"
          label={t('reports.books.prompt.customerCategory')}
          value={categoryOfCustomers}
          options={(props.options?.customerCategories ?? []).map((c) => ({
            value: String(c.id),
            label: c.name,
          }))}
          onChange={setCategoryOfCustomers}
        />
        <PickedField
          label={t('reports.books.prompt.customer')}
          htmlFor="book-customer"
          picked={customer ? `${customer.name} · ${customer.code}` : customerLabel}
          onClear={() => {
            setCustomer(null);
            setCustomerLabel(null);
          }}
        >
          <CustomerPicker id="book-customer" value={customer} onChange={setCustomer} searchFirst />
        </PickedField>
        <SelectField
          id="book-source"
          label={t('reports.books.prompt.source')}
          value={source}
          emptyLabel=""
          options={SOURCES.map((value) => ({
            value,
            label: t(`reports.books.prompt.sources.${value}`),
          }))}
          onChange={setSource}
        />
        <SelectField
          id="book-grouping"
          label={t('reports.books.prompt.grouping')}
          value={grouping}
          emptyLabel=""
          options={(['none', 'category'] as const).map((value) => ({
            value,
            label: t(`reports.books.prompt.groupings.${value}`),
          }))}
          onChange={(value) => setGrouping(value === 'category' ? 'category' : 'none')}
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
      </div>
      <div className="flex flex-col gap-4">
        <SelectField
          id="book-category"
          label={t('reports.books.prompt.category')}
          value={categoryId}
          options={categories}
          onChange={setCategoryId}
        />
        <SelectField
          id="book-warehouse"
          label={t('reports.books.prompt.warehouse')}
          value={warehouse}
          options={(props.options?.warehouses ?? []).map((w) => ({
            value: String(w.id),
            label: `${w.code ?? ''} - ${w.name}`,
          }))}
          onChange={setWarehouse}
        />
        <PrecisionField value={precision} onChange={setPrecision} />
        <SelectField
          id="book-kind"
          label={t('reports.books.prompt.kind')}
          value={kind}
          emptyLabel=""
          options={KINDS.map((value) => ({
            value,
            label: t(`reports.books.prompt.kinds.${value}`),
          }))}
          onChange={setKind}
        />
        <DateFields {...dates} />
      </div>
    </PromptDialog>
  );
}

interface SalesTotals {
  sales: string;
  returns: string;
  cost: string | null;
  profit: string | null;
}

function ProductSalesTable(props: {
  rows: readonly ProductSalesRow[];
  totals: SalesTotals;
  truncated: boolean;
  grouping: Grouping;
  query: ProductSalesQuery;
  precision: Precision;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const costs = props.totals.cost !== null;
  const span = costs ? 10 : 7;
  const groups = useMemo(() => {
    if (props.grouping === 'none') return [['', [...props.rows]] as const];
    const map = new Map<string, ProductSalesRow[]>();
    for (const row of props.rows) {
      const key = row.categoryName ?? t('reports.books.table.noCategory');
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'mn'));
  }, [props.rows, props.grouping, t]);
  if (props.rows.length === 0) {
    return <EmptyState icon={ShoppingBasket} title={t('reports.prompt.empty')} />;
  }
  const money = (value: string | null, zero = '') => amount(value, props.precision, zero);
  const sumOf = (rows: readonly ProductSalesRow[]): SalesTotals =>
    rows.reduce<SalesTotals>(
      (sum, row) => ({
        sales: addMoney(sum.sales, row.sales) ?? '0',
        returns: addMoney(sum.returns, row.returns) ?? '0',
        cost: addMoney(sum.cost, row.cost),
        profit: addMoney(sum.profit, row.profit),
      }),
      { sales: '0', returns: '0', cost: costs ? '0' : null, profit: costs ? '0' : null },
    );
  const totalCells = (totals: SalesTotals) => (
    <>
      <TableCell />
      <TableCell />
      <TableCell className={NUM}>{money(totals.sales, '0')}</TableCell>
      <TableCell className={NUM}>{money(totals.returns, '0')}</TableCell>
      {costs ? (
        <>
          <TableCell className={NUM}>{money(totals.cost, '0')}</TableCell>
          <TableCell className={NUM}>{money(totals.profit, '0')}</TableCell>
          <TableCell />
        </>
      ) : null}
    </>
  );
  return (
    <Table className={BOOK_TABLE}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28 text-center">{t('reports.books.columns.sku')}</TableHead>
          <TableHead className="text-center">{t('reports.books.columns.name')}</TableHead>
          <TableHead className="text-center">{t('reports.books.columns.unit')}</TableHead>
          <TableHead className="text-right">{t('reports.books.columns.qty')}</TableHead>
          <TableHead className="text-right">{t('reports.books.columns.avgPrice')}</TableHead>
          <TableHead className="text-right">{t('reports.books.columns.sales')}</TableHead>
          <TableHead className="text-right">{t('reports.books.columns.returns')}</TableHead>
          {costs ? (
            <>
              <TableHead className="text-right">{t('reports.books.columns.cost')}</TableHead>
              <TableHead className="text-right">{t('reports.books.columns.profit')}</TableHead>
              <TableHead className="text-right">{t('reports.books.columns.margin')}</TableHead>
            </>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(([groupName, rows]) => (
          <Fragment key={groupName}>
            {props.grouping === 'category' ? (
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={3}>{groupName}</TableCell>
                {totalCells(sumOf(rows))}
              </TableRow>
            ) : null}
            {rows.map((row) => {
              const key = String(row.productId);
              const expanded = drill.open.has(key);
              return (
                <Fragment key={key}>
                  <DrillRow expanded={expanded} onToggle={() => drill.toggle(key)}>
                    <TableCell>
                      <DrillMark expanded={expanded} />
                      {row.sku}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-center">{row.unit ?? ''}</TableCell>
                    <TableCell className={NUM}>{quantity(row.qty) || '0'}</TableCell>
                    <TableCell className={NUM}>
                      {row.avgPrice === null ? '' : money(row.avgPrice)}
                    </TableCell>
                    <TableCell className={NUM}>{money(row.sales, '0')}</TableCell>
                    <TableCell className={NUM}>{money(row.returns)}</TableCell>
                    {costs ? (
                      <>
                        <TableCell className={NUM}>{money(row.cost, '0')}</TableCell>
                        <TableCell className={NUM}>{money(row.profit, '0')}</TableCell>
                        <TableCell className={NUM}>
                          {row.margin === null ? '' : `${row.margin}%`}
                        </TableCell>
                      </>
                    ) : null}
                  </DrillRow>
                  {expanded ? (
                    <SalesDetail
                      query={props.query}
                      productId={row.productId}
                      costs={costs}
                      precision={props.precision}
                      span={span}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
        <TableRow className="font-semibold">
          <TableCell colSpan={3} className="text-right">
            {t('reports.prompt.total')}
          </TableCell>
          {totalCells(props.totals)}
        </TableRow>
        {props.truncated ? <NoteRow colSpan={span}>{t('reports.prompt.truncated')}</NoteRow> : null}
      </TableBody>
    </Table>
  );
}

/** The documents behind a product; a click opens the invoice or the till's sale. */
function SalesDetail(props: {
  query: ProductSalesQuery;
  productId: number;
  costs: boolean;
  precision: Precision;
  span: number;
}) {
  const { t } = useTranslation();
  const documents = useProductSalesDocuments(props.query, props.productId);
  if (documents.isPending) {
    return <NoteRow colSpan={props.span}>{t('reports.prompt.loadingLines')}</NoteRow>;
  }
  if (documents.error) {
    return (
      <NoteRow colSpan={props.span}>
        <ProblemAlert problem={problemFromError(documents.error)} />
      </NoteRow>
    );
  }
  if (documents.data.rows.length === 0) {
    return <NoteRow colSpan={props.span}>{t('reports.prompt.noLines')}</NoteRow>;
  }
  return (
    <>
      {documents.data.rows.map((doc) => {
        const text = [
          `#${doc.number ?? doc.id}`,
          doc.date,
          t(`reports.books.salesKinds.${doc.kind}`),
          ...(doc.customerName ? [doc.customerName] : []),
        ].join(' - ');
        return (
          <DetailRow key={`${doc.kind}:${doc.id}`} href={salesDocHref(doc)} label={text}>
            <TableCell colSpan={3} className="text-right">
              {text}
            </TableCell>
            <TableCell className={NUM}>{quantity(doc.qty) || '0'}</TableCell>
            <TableCell />
            <TableCell className={NUM}>{amount(doc.sales, props.precision, '0')}</TableCell>
            <TableCell />
            {props.costs ? (
              <>
                <TableCell className={NUM}>{amount(doc.cost, props.precision, '0')}</TableCell>
                <TableCell />
                <TableCell />
              </>
            ) : null}
          </DetailRow>
        );
      })}
      {documents.data.truncated ? (
        <NoteRow colSpan={props.span}>{t('reports.prompt.truncated')}</NoteRow>
      ) : null}
    </>
  );
}
