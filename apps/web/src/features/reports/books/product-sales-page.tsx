import { ShoppingBasket } from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/components/combobox';
import { EmptyState, FilterBar, FilterChip, FilterToggle } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductSearch } from '@/features/inventory/shared';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type BookOptions,
  type PaidAmount,
  type ProductSalesData,
  type ProductSalesDocument,
  type ProductSalesPayment,
  type ProductSalesQuery,
  type ProductSalesRow,
  useBookDownloads,
  useBookOptions,
  useProductSalesData,
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
  NUM,
  negate,
  percentText,
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
  CheckField,
  DetailLabel,
  DetailRow,
  DrillCell,
  DrillRow,
  EmptyRow,
  GroupRow,
  HeadLabel,
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
import { salesDocHref } from './book-links';
import { idParamOf, idsParam, useBookParams, useDrill, usePromptDates } from './book-state';
import {
  buildCube,
  categoryTree,
  type SalesConditions,
  type SalesReport,
  salesDocuments,
  salesReport,
} from './product-sales-cube';

const GROUPINGS = ['none', 'category', 'brand', 'segment', 'user'] as const;
type Grouping = (typeof GROUPINGS)[number];
const SOURCES = ['ALL', 'WHOLESALE', 'POS'] as const;
const KINDS = ['ALL', 'SALES', 'RETURNS'] as const;
type Source = (typeof SOURCES)[number];
type Kind = (typeof KINDS)[number];
/** The bar's filters («Цэвэрлэх» drops them; the period, grouping and split stay). */
const FILTER_KEYS = [
  'src',
  'kind',
  'w',
  'rep',
  'cc',
  'cat',
  'catn',
  'br',
  'sg',
  'c',
  'cn',
  'pr',
  'prn',
];
/** The documents that take goods back: their amount is a return. */
const RETURN_KINDS: readonly ProductSalesDocument['kind'][] = ['CREDIT_NOTE', 'POS_RETURN'];

function useProductSalesQuery() {
  const params = useBookParams();
  const { search } = params;
  const grouping: Grouping = GROUPINGS.find((value) => value === search.get('by')) ?? 'none';
  const payments = search.get('pay') === '1';
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
    const brandIds = idsParam(search, 'br');
    const segmentIds = idsParam(search, 'sg');
    return {
      from: params.from,
      to: params.to,
      ...(source && source !== 'ALL' ? { source } : {}),
      ...(kind && kind !== 'ALL' ? { kind } : {}),
      ...Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined)),
      ...(brandIds.length ? { brandIds } : {}),
      ...(segmentIds.length ? { segmentIds } : {}),
      ...(grouping === 'none' ? {} : { by: grouping }),
      ...(payments ? { payments: true } : {}),
    };
  }, [params.ready, params.from, params.to, search, grouping, payments]);
  return { ...params, query, grouping, payments };
}

/** The address's conditions as the browser's report reads them (a category with its children). */
function conditionsOf(
  query: ProductSalesQuery,
  categories: BookOptions['categories'] | undefined,
): SalesConditions {
  return {
    source: query.source ?? 'ALL',
    kind: query.kind ?? 'ALL',
    repUserId: query.repUserId,
    customerCategoryId: query.customerCategoryId,
    customerId: query.customerId,
    productId: query.productId,
    categoryIds:
      query.categoryId === undefined ? undefined : categoryTree(categories ?? [], query.categoryId),
    warehouseId: query.warehouseId,
    brandIds: query.brandIds ?? [],
    segmentIds: query.segmentIds ?? [],
  };
}

/**
 * «Тайлан → Борлуулалт /Бараагаар/» (ADR-0133, ADR-0135): the period's lines come once; the
 * conditions bar above the paper and the prompt change the report at once, in the browser.
 */
export function ProductSalesPage() {
  const { t } = useTranslation();
  const state = useProductSalesQuery();
  const [prompting, setPrompting] = useState(!state.ready);
  const period = useMemo(
    () => (state.ready ? { from: state.from, to: state.to } : null),
    [state.ready, state.from, state.to],
  );
  const data = useProductSalesData(period);
  const cube = useMemo(() => (data.data ? buildCube(data.data) : null), [data.data]);
  const options = useBookOptions();
  const downloads = useBookDownloads();
  const action = useAction();
  const title = t('reports.books.titles.productSales');
  const { search } = state;
  // The table follows the conditions a moment later, so a pill answers at once on a long period.
  const query = useDeferredValue(state.query);
  const conditions = useMemo(
    () => (query ? conditionsOf(query, options.data?.categories) : null),
    [query, options.data?.categories],
  );
  const grouping: Grouping = query?.by ?? 'none';
  const payments = query?.payments === true;
  const names = useMemo(
    () => ({
      none: grouping === 'none' ? '' : t(`reports.books.noGroup.${grouping}`),
      app: t('reports.books.appOrders'),
    }),
    [grouping, t],
  );
  const report = useMemo(
    () =>
      cube && conditions && !cube.data.truncated
        ? salesReport(cube, conditions, grouping, payments, names)
        : null,
    [cube, conditions, grouping, payments, names],
  );
  const documentsOf = useCallback(
    (productId: number, group: string | null) =>
      cube && conditions
        ? salesDocuments(cube, conditions, grouping, productId, group, payments)
        : { rows: [], truncated: false },
    [cube, conditions, grouping, payments],
  );
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
    ...idsParam(search, 'br').map(
      (id) => options.data?.brands.find((b) => b.id === id)?.name ?? String(id),
    ),
    ...idsParam(search, 'sg').map(
      (id) => options.data?.segments.find((g) => g.id === id)?.name ?? String(id),
    ),
    ...['cn', 'prn', 'catn'].flatMap((key) => (search.get(key) ? [search.get(key) ?? ''] : [])),
    ...(search.get('src')
      ? [t(`reports.books.prompt.sources.${search.get('src') as Source}`)]
      : []),
    ...(search.get('kind') ? [t(`reports.books.prompt.kinds.${search.get('kind') as Kind}`)] : []),
  ].filter(Boolean);
  const costs = cube ? cube.data.margins : true;
  const paymentCount = report?.payments.length ?? 0;
  const openPrompt = () => setPrompting(true);
  return (
    <BookPage columns={productSalesColumns(costs, paymentCount)}>
      <div className="print:hidden">
        <PageHeader
          compact
          title={title}
          actions={
            <BookActions
              views="product-sales"
              ready={state.query !== null && report !== null}
              period={state.query}
              onPrompt={openPrompt}
              excelPending={downloads.productSales.isPending}
              onExcel={() => {
                const current = state.query;
                if (!current) return;
                void action.run(async () =>
                  saveBlob(
                    await downloads.productSales.mutateAsync(current),
                    `borluulalt-baraagaar-${current.from}-${current.to}.xlsx`,
                  ),
                );
              }}
            />
          }
        />
        {state.query ? (
          <SalesConditionBar state={state} options={options.data} data={data.data} />
        ) : null}
      </div>
      <ProductSalesPrompt
        open={prompting}
        onOpenChange={setPrompting}
        state={state}
        title={title}
        options={options.data}
      />
      <ProblemAlert problem={action.problem ?? problemFromError(data.error)} />
      {state.query && (data.data || data.isPending) ? (
        <BookSheet
          title={title}
          period={state.query}
          filters={filters}
          orientation="landscape"
          loading={!report && !cube?.data.truncated}
        >
          {cube?.data.truncated ? (
            <EmptyState icon={ShoppingBasket} title={t('reports.books.bar.tooMany')} />
          ) : (
            <ProductSalesTable
              report={report}
              grouping={grouping}
              precision={state.precision}
              costs={costs}
              documentsOf={documentsOf}
              onPrompt={openPrompt}
            />
          )}
        </BookSheet>
      ) : (
        <BookBlank
          title={title}
          icon={ShoppingBasket}
          orientation="landscape"
          onPrompt={openPrompt}
        />
      )}
    </BookPage>
  );
}

/**
 * The live conditions above the paper (ADR-0135): pills that change the report at once — the
 * grouping, the split by payment, the source and kind, the warehouse, the user, the customers'
 * group, the products' group, brands and segments (those sold in the period); a picked customer or
 * product shows as a chip to clear. «Цэвэрлэх» drops every filter but the period.
 */
function SalesConditionBar(props: {
  state: ReturnType<typeof useProductSalesQuery>;
  options: BookOptions | undefined;
  data: ProductSalesData | undefined;
}) {
  const { t } = useTranslation();
  const { search, update } = props.state;
  const categories = useMemo(
    () => categoryOptions(props.options?.categories ?? []),
    [props.options?.categories],
  );
  const named = (list: readonly { id: number; name: string; code?: string | null }[]) =>
    list.map((item) => ({ value: String(item.id), label: item.name, keys: [item.code ?? ''] }));
  const brands = named(props.data?.names.brands ?? props.options?.brands ?? []);
  const segments = named(props.data?.names.segments ?? props.options?.segments ?? []);
  const pill = (
    key: string,
    label: string,
    emptyLabel: string,
    options: readonly ComboboxOption[],
  ) => (
    <Combobox
      aria-label={label}
      value={search.get(key) ?? ''}
      emptyLabel={emptyLabel}
      options={options}
      onChange={(value) => update({ [key]: value })}
    />
  );
  const many = (key: string, label: string, options: readonly ComboboxOption[]) => {
    const chosen = search.getAll(key);
    return (
      <>
        <Combobox
          aria-label={label}
          value=""
          emptyLabel={chosen.length > 0 ? t('reports.books.bar.more', { name: label }) : label}
          options={options.filter((option) => !chosen.includes(option.value))}
          onChange={(value) => {
            if (value) update({ [key]: [...chosen, value] });
          }}
        />
        {chosen.map((value) => {
          const name = options.find((option) => option.value === value)?.label ?? value;
          return (
            <FilterChip
              key={`${key}:${value}`}
              clearLabel={t('reports.prompt.remove', { name })}
              onClear={() => update({ [key]: chosen.filter((v) => v !== value) })}
            >
              {name}
            </FilterChip>
          );
        })}
      </>
    );
  };
  const chip = (key: string, labelKey: string) => {
    const name = search.get(labelKey);
    if (!search.get(key) || !name) return null;
    return (
      <FilterChip
        clearLabel={t('reports.prompt.remove', { name })}
        onClear={() => update({ [key]: null, [labelKey]: null })}
      >
        {name}
      </FilterChip>
    );
  };
  const filtered = FILTER_KEYS.some((key) => search.has(key));
  return (
    <FilterBar
      className="mb-2"
      end={
        filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
          >
            {t('reports.books.bar.clear')}
          </Button>
        ) : null
      }
    >
      <Combobox
        aria-label={t('reports.books.prompt.grouping')}
        value={search.get('by') ?? ''}
        emptyLabel={t('reports.books.prompt.groupings.none')}
        options={GROUPINGS.filter((g) => g !== 'none').map((value) => ({
          value,
          label: t(`reports.books.prompt.groupings.${value}`),
        }))}
        onChange={(value) => update({ by: value })}
      />
      <FilterToggle
        label={t('reports.books.prompt.payments')}
        checked={search.get('pay') === '1'}
        onCheckedChange={(checked) => update({ pay: checked ? '1' : null })}
      />
      {pill(
        'src',
        t('reports.books.prompt.source'),
        t('reports.books.bar.allSources'),
        SOURCES.filter((s) => s !== 'ALL').map((value) => ({
          value,
          label: t(`reports.books.prompt.sources.${value}`),
        })),
      )}
      {pill(
        'kind',
        t('reports.books.prompt.kind'),
        t('reports.books.bar.allKinds'),
        KINDS.filter((k) => k !== 'ALL').map((value) => ({
          value,
          label: t(`reports.books.prompt.kinds.${value}`),
        })),
      )}
      {pill(
        'w',
        t('reports.books.prompt.warehouse'),
        t('reports.books.bar.allWarehouses'),
        (props.options?.warehouses ?? []).map((w) => ({
          value: String(w.id),
          label: `${w.code ?? ''} - ${w.name}`,
        })),
      )}
      {pill(
        'rep',
        t('reports.books.prompt.rep'),
        t('reports.books.bar.allReps'),
        named(props.data?.names.users ?? props.options?.users ?? []),
      )}
      {pill(
        'cc',
        t('reports.books.prompt.customerCategory'),
        t('reports.books.bar.allCustomerCategories'),
        named(props.options?.customerCategories ?? []),
      )}
      <Combobox
        aria-label={t('reports.books.prompt.category')}
        value={search.get('cat') ?? ''}
        emptyLabel={t('reports.books.bar.allCategories')}
        options={categories}
        onChange={(value) =>
          update({ cat: value, catn: categories.find((c) => c.value === value)?.label ?? null })
        }
      />
      {many('br', t('reports.books.prompt.brands'), brands)}
      {many('sg', t('reports.books.prompt.segments'), segments)}
      {chip('c', 'cn')}
      {chip('pr', 'prn')}
    </FilterBar>
  );
}

/**
 * Code, name, unit, quantity, average price, sales, returns, with the margins right cost, profit
 * and margin, then one column per payment (landscape A4).
 */
function productSalesColumns(costs: boolean, payments: number): BookColumn[] {
  return [
    COL.code,
    textColumn(21),
    COL.unit,
    COL.qty,
    COL.money,
    COL.money,
    COL.money,
    ...(costs ? [COL.money, COL.money, COL.percent] : []),
    ...Array<BookColumn>(payments).fill(COL.money),
  ];
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
  const [brands, setBrands] = useState<string[]>(search.getAll('br'));
  const [segments, setSegments] = useState<string[]>(search.getAll('sg'));
  const [payments, setPayments] = useState(props.state.payments);
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
    setBrands(search.getAll('br'));
    setSegments(search.getAll('sg'));
    setGrouping(GROUPINGS.find((value) => value === search.get('by')) ?? 'none');
    setPayments(search.get('pay') === '1');
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
      br: brands,
      sg: segments,
      pay: payments ? '1' : null,
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
            <CustomerPicker
              id="book-customer"
              value={customer}
              onChange={setCustomer}
              searchFirst
            />
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
          <MultiPick
            label={t('reports.books.prompt.brands')}
            options={(props.options?.brands ?? []).map((b) => ({
              value: String(b.id),
              label: b.name,
              keys: [b.code ?? ''],
            }))}
            values={brands}
            onChange={setBrands}
          />
          <MultiPick
            label={t('reports.books.prompt.segments')}
            options={(props.options?.segments ?? []).map((g) => ({
              value: String(g.id),
              label: g.name,
            }))}
            values={segments}
            onChange={setSegments}
          />
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
            onChange={(value) => setGrouping(GROUPINGS.find((g) => g === value) ?? 'none')}
          />
          <CheckField
            id="book-payments"
            label={t('reports.books.prompt.payments')}
            checked={payments}
            onChange={setPayments}
          />
        </>
      }
    />
  );
}

interface SalesTotals {
  sales: string;
  returns: string;
  cost: string | null;
  profit: string | null;
  paid: readonly PaidAmount[];
}

/** A payment's amount in a row's split, null without one. */
function paidOf(paid: readonly PaidAmount[], key: string): string | null {
  return paid.find((p) => p.key === key)?.amount ?? null;
}

/** Adds two splits by payment. */
function addPaid(a: readonly PaidAmount[], b: readonly PaidAmount[]): PaidAmount[] {
  const sum = new Map(a.map((p) => [p.key, p.amount]));
  for (const p of b) sum.set(p.key, addMoney(sum.get(p.key) ?? '0', p.amount) ?? '0');
  return [...sum].map(([key, amount]) => ({ key, amount }));
}

/** The groups' order: by name, the customer app and «… -гүй» last. */
function groupRank(key: string | null): number {
  return key === 'NONE' ? 2 : key === 'APP' ? 1 : 0;
}

function ProductSalesHead(props: { costs: boolean; payments: readonly ProductSalesPayment[] }) {
  const { t } = useTranslation();
  const twoRows = props.payments.length > 0;
  const head = (label: ReactNode, className?: string) => (
    <TableHead rowSpan={twoRows ? 2 : undefined} className={className}>
      {label}
    </TableHead>
  );
  const exVat = t('reports.books.head.exVat');
  return (
    <TableHeader>
      <TableRow>
        {head(t('reports.books.columns.sku'))}
        {head(t('reports.books.columns.name'))}
        {head(t('reports.books.head.unit'), GROUP_END)}
        {head(t('reports.books.columns.qty'), 'text-right')}
        {head(t('reports.books.columns.avgPrice'), 'text-right')}
        {head(<HeadLabel label={t('reports.books.head.sales')} note={exVat} />, 'text-right')}
        {head(t('reports.books.columns.returns'), cn('text-right', GROUP_END))}
        {props.costs ? (
          <>
            {head(t('reports.books.columns.cost'), 'text-right')}
            {head(t('reports.books.columns.profit'), 'text-right')}
            {head(t('reports.books.columns.margin'), cn('text-right', GROUP_END))}
          </>
        ) : null}
        {twoRows ? (
          <TableHead colSpan={props.payments.length} className={cn('text-center', GROUP_END)}>
            <HeadLabel label={t('reports.books.head.payments')} note={exVat} />
          </TableHead>
        ) : null}
      </TableRow>
      {twoRows ? (
        <TableRow>
          {props.payments.map((payment) => (
            <TableHead key={payment.key} className="text-right">
              {payment.name}
            </TableHead>
          ))}
        </TableRow>
      ) : null}
    </TableHeader>
  );
}

type DocumentsOf = (
  productId: number,
  group: string | null,
) => { rows: ProductSalesDocument[]; truncated: boolean };

function ProductSalesTable(props: {
  report: SalesReport | null;
  grouping: Grouping;
  precision: Precision;
  costs: boolean;
  documentsOf: DocumentsOf;
  onPrompt: () => void;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const { costs } = props;
  const payments = props.report?.payments ?? [];
  const span = (costs ? 10 : 7) + payments.length;
  const groups = useMemo(() => {
    const rows = props.report?.rows ?? [];
    if (props.grouping === 'none') return [{ key: '', name: '', rows: [...rows] }];
    const map = new Map<string, { key: string; name: string; rows: ProductSalesRow[] }>();
    for (const row of rows) {
      const key = row.group ?? 'NONE';
      const group = map.get(key) ?? { key, name: row.groupName ?? '', rows: [] };
      group.rows.push(row);
      map.set(key, group);
    }
    return [...map.values()].sort(
      (a, b) => groupRank(a.key) - groupRank(b.key) || a.name.localeCompare(b.name, 'mn'),
    );
  }, [props.report?.rows, props.grouping]);
  const columns = productSalesColumns(costs, payments.length);
  const head = <ProductSalesHead costs={costs} payments={payments} />;
  if (props.report === null) {
    return (
      <BookTable columns={columns}>
        {head}
        <SkeletonBody columns={span} />
      </BookTable>
    );
  }
  if (props.report.rows.length === 0) {
    return (
      <BookTable columns={columns}>
        {head}
        <EmptyRow colSpan={span} onPrompt={props.onPrompt} />
      </BookTable>
    );
  }
  const money = (value: string | null, zero = '') => amount(value, props.precision, zero);
  const sumOf = (rows: readonly ProductSalesRow[]): SalesTotals =>
    rows.reduce<SalesTotals>(
      (sum, row) => ({
        sales: addMoney(sum.sales, row.sales) ?? '0',
        returns: addMoney(sum.returns, row.returns) ?? '0',
        cost: addMoney(sum.cost, row.cost),
        profit: addMoney(sum.profit, row.profit),
        paid: addPaid(sum.paid, row.paid),
      }),
      {
        sales: '0',
        returns: '0',
        cost: costs ? '0' : null,
        profit: costs ? '0' : null,
        paid: [],
      },
    );
  const paidCells = (paid: readonly PaidAmount[], zero = '') =>
    payments.map((payment, index) => (
      <TableCell key={payment.key} className={cn(NUM, index === payments.length - 1 && GROUP_END)}>
        {money(paidOf(paid, payment.key) ?? '0', zero)}
      </TableCell>
    ));
  const totalCells = (totals: SalesTotals) => (
    <>
      <TableCell />
      <TableCell />
      <TableCell className={NUM}>{money(totals.sales, '0')}</TableCell>
      <TableCell className={cn(NUM, GROUP_END)}>{money(totals.returns, '0')}</TableCell>
      {costs ? (
        <>
          <TableCell className={NUM}>{money(totals.cost, '0')}</TableCell>
          <TableCell className={NUM}>{money(totals.profit, '0')}</TableCell>
          <TableCell className={GROUP_END} />
        </>
      ) : null}
      {paidCells(totals.paid, '0')}
    </>
  );
  return (
    <BookTable columns={columns}>
      {head}
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            {props.grouping !== 'none' ? (
              <GroupRow>
                <TextCell text={group.name} colSpan={3} className={GROUP_END} />
                {totalCells(sumOf(group.rows))}
              </GroupRow>
            ) : null}
            {group.rows.map((row) => {
              const key = `${row.productId}|${row.group ?? ''}`;
              const expanded = drill.open.has(key);
              const toggle = () => drill.toggle(key);
              return (
                <Fragment key={key}>
                  <DrillRow expanded={expanded} onToggle={toggle}>
                    <DrillCell expanded={expanded} onToggle={toggle} text={row.sku} />
                    <TextCell text={row.name} />
                    <TextCell text={row.unit ?? ''} className={GROUP_END} />
                    <TableCell className={NUM}>{quantity(row.qty)}</TableCell>
                    <TableCell className={NUM}>
                      {row.avgPrice === null ? '' : money(row.avgPrice)}
                    </TableCell>
                    <TableCell className={NUM}>{money(row.sales)}</TableCell>
                    <TableCell className={cn(NUM, GROUP_END)}>{money(row.returns)}</TableCell>
                    {costs ? (
                      <>
                        <TableCell className={NUM}>{money(row.cost)}</TableCell>
                        <TableCell className={NUM}>{money(row.profit)}</TableCell>
                        <TableCell className={cn(NUM, GROUP_END)}>
                          {percentText(row.margin)}
                        </TableCell>
                      </>
                    ) : null}
                    {paidCells(row.paid)}
                  </DrillRow>
                  {expanded ? (
                    <SalesDetail
                      documents={props.documentsOf(row.productId, row.group)}
                      omit={[group.name]}
                      costs={costs}
                      payments={payments}
                      precision={props.precision}
                      span={span}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
        <TotalRow labelSpan={3}>{totalCells(props.report.totals)}</TotalRow>
        {props.report.truncated ? (
          <NoteRow colSpan={span}>{t('reports.prompt.truncated')}</NoteRow>
        ) : null}
      </TableBody>
    </BookTable>
  );
}

/**
 * The documents behind a product; a click opens the invoice or the till's sale. A return's amount
 * shows under «Борлуулалт» (net sales take it off) and under «Буцаалт», as the product's row does.
 */
function SalesDetail(props: {
  documents: ReturnType<DocumentsOf>;
  omit: readonly string[];
  costs: boolean;
  payments: readonly ProductSalesPayment[];
  precision: Precision;
  span: number;
}) {
  const { t } = useTranslation();
  const { documents } = props;
  if (documents.rows.length === 0) {
    return <NoteRow colSpan={props.span}>{t('reports.prompt.noLines')}</NoteRow>;
  }
  return (
    <>
      {documents.rows.map((doc) => {
        const number = doc.number ?? String(doc.id);
        const parts = detailParts(
          number,
          [doc.date, t(`reports.books.salesKinds.${doc.kind}`), doc.customerName],
          props.omit,
        );
        const isReturn = RETURN_KINDS.includes(doc.kind);
        return (
          <DetailRow
            key={`${doc.kind}:${doc.id}`}
            href={salesDocHref(doc)}
            label={detailText(number, parts)}
          >
            <DetailLabel number={number} parts={parts} colSpan={3} />
            <TableCell className={NUM}>{quantity(doc.qty)}</TableCell>
            <TableCell />
            <TableCell className={NUM}>{amount(doc.sales, props.precision)}</TableCell>
            <TableCell className={cn(NUM, GROUP_END)}>
              {isReturn ? amount(negate(doc.sales), props.precision) : ''}
            </TableCell>
            {props.costs ? (
              <>
                <TableCell className={NUM}>{amount(doc.cost, props.precision)}</TableCell>
                <TableCell />
                <TableCell className={GROUP_END} />
              </>
            ) : null}
            {props.payments.map((payment, index) => (
              <TableCell
                key={payment.key}
                className={cn(NUM, index === props.payments.length - 1 && GROUP_END)}
              >
                {amount(paidOf(doc.paid, payment.key) ?? '0', props.precision)}
              </TableCell>
            ))}
          </DetailRow>
        );
      })}
      {documents.truncated ? (
        <NoteRow colSpan={props.span}>{t('reports.prompt.truncated')}</NoteRow>
      ) : null}
    </>
  );
}
