import { ShoppingBasket } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/list';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
  type PaidAmount,
  type ProductSalesDocument,
  type ProductSalesPayment,
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
  MultiPick,
  NoteRow,
  PickedField,
  PrecisionField,
  PromptDialog,
  SelectField,
} from './book-kit';
import { salesDocHref } from './book-links';
import { idParamOf, idsParam, useBookParams, useDrill, usePromptDates } from './book-state';

const GROUPINGS = ['none', 'category', 'brand', 'segment', 'user'] as const;
type Grouping = (typeof GROUPINGS)[number];
const SOURCES = ['ALL', 'WHOLESALE', 'POS'] as const;
const KINDS = ['ALL', 'SALES', 'RETURNS'] as const;
type Source = (typeof SOURCES)[number];
type Kind = (typeof KINDS)[number];

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
            payments={report.data.payments}
            truncated={report.data.truncated}
            grouping={report.data.by}
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
          options={GROUPINGS.map((value) => ({
            value,
            label: t(`reports.books.prompt.groupings.${value}`),
          }))}
          onChange={(value) => setGrouping(GROUPINGS.find((g) => g === value) ?? 'none')}
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="book-payments"
            checked={payments}
            onCheckedChange={(value) => setPayments(value === true)}
          />
          <Label htmlFor="book-payments">{t('reports.books.prompt.payments')}</Label>
        </div>
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

function ProductSalesTable(props: {
  rows: readonly ProductSalesRow[];
  totals: SalesTotals;
  payments: readonly ProductSalesPayment[];
  truncated: boolean;
  grouping: Grouping;
  query: ProductSalesQuery;
  precision: Precision;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const costs = props.totals.cost !== null;
  const { payments } = props;
  const span = (costs ? 10 : 7) + payments.length;
  const groups = useMemo(() => {
    if (props.grouping === 'none') return [{ key: '', name: '', rows: [...props.rows] }];
    const map = new Map<string, { key: string; name: string; rows: ProductSalesRow[] }>();
    for (const row of props.rows) {
      const key = row.group ?? 'NONE';
      const group = map.get(key) ?? { key, name: row.groupName ?? '', rows: [] };
      group.rows.push(row);
      map.set(key, group);
    }
    return [...map.values()].sort(
      (a, b) => groupRank(a.key) - groupRank(b.key) || a.name.localeCompare(b.name, 'mn'),
    );
  }, [props.rows, props.grouping]);
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
  const paidCells = (paid: readonly PaidAmount[]) =>
    payments.map((payment) => (
      <TableCell key={payment.key} className={NUM}>
        {money(paidOf(paid, payment.key) ?? '0')}
      </TableCell>
    ));
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
      {paidCells(totals.paid)}
    </>
  );
  const twoRows = payments.length > 0;
  const head = (label: string, className: string) => (
    <TableHead rowSpan={twoRows ? 2 : undefined} className={className}>
      {label}
    </TableHead>
  );
  return (
    <Table className={BOOK_TABLE}>
      <TableHeader>
        <TableRow>
          {head(t('reports.books.columns.sku'), 'w-28 text-center')}
          {head(t('reports.books.columns.name'), 'text-center')}
          {head(t('reports.books.columns.unit'), 'text-center')}
          {head(t('reports.books.columns.qty'), 'text-right')}
          {head(t('reports.books.columns.avgPrice'), 'text-right')}
          {head(t('reports.books.columns.sales'), 'text-right')}
          {head(t('reports.books.columns.returns'), 'text-right')}
          {costs ? (
            <>
              {head(t('reports.books.columns.cost'), 'text-right')}
              {head(t('reports.books.columns.profit'), 'text-right')}
              {head(t('reports.books.columns.margin'), 'text-right')}
            </>
          ) : null}
          {twoRows ? (
            <TableHead colSpan={payments.length} className="text-center">
              {t('reports.books.columns.payments')}
            </TableHead>
          ) : null}
        </TableRow>
        {twoRows ? (
          <TableRow>
            {payments.map((payment) => (
              <TableHead key={payment.key} className="text-right">
                {payment.name}
              </TableHead>
            ))}
          </TableRow>
        ) : null}
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            {props.grouping !== 'none' ? (
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={3}>{group.name}</TableCell>
                {totalCells(sumOf(group.rows))}
              </TableRow>
            ) : null}
            {group.rows.map((row) => {
              const key = `${row.productId}|${row.group ?? ''}`;
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
                    {paidCells(row.paid)}
                  </DrillRow>
                  {expanded ? (
                    <SalesDetail
                      query={props.query}
                      productId={row.productId}
                      group={row.group}
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
  group: string | null;
  costs: boolean;
  payments: readonly ProductSalesPayment[];
  precision: Precision;
  span: number;
}) {
  const { t } = useTranslation();
  const documents = useProductSalesDocuments(props.query, props.productId, props.group);
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
  const label = (doc: ProductSalesDocument) =>
    [
      `#${doc.number ?? doc.id}`,
      doc.date,
      t(`reports.books.salesKinds.${doc.kind}`),
      ...(doc.customerName ? [doc.customerName] : []),
    ].join(' - ');
  return (
    <>
      {documents.data.rows.map((doc) => (
        <DetailRow key={`${doc.kind}:${doc.id}`} href={salesDocHref(doc)} label={label(doc)}>
          <TableCell colSpan={3} className="text-right">
            {label(doc)}
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
          {props.payments.map((payment) => (
            <TableCell key={payment.key} className={NUM}>
              {amount(paidOf(doc.paid, payment.key) ?? '0', props.precision)}
            </TableCell>
          ))}
        </DetailRow>
      ))}
      {documents.data.truncated ? (
        <NoteRow colSpan={props.span}>{t('reports.prompt.truncated')}</NoteRow>
      ) : null}
    </>
  );
}
