import { FileStack } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductSearch } from '@/features/inventory/shared';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { SupplierPicker, type PickedSupplier } from '@/features/partners/supplier-picker';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import {
  type BookOptions,
  type StockDocType,
  type StockDocumentRow,
  type StockDocumentsQuery,
  useBookDownloads,
  useBookOptions,
  useStockDocumentLines,
  useStockDocuments,
} from './book-api';
import {
  amount,
  type BookColumn,
  COL,
  detailParts,
  detailText,
  GROUP_END,
  isZero,
  MINUS,
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

const DOC_TYPES: readonly StockDocType[] = ['GR', 'GI', 'TR', 'ADJ', 'ST', 'SO', 'POS', 'CN'];

function useStockDocumentsQuery() {
  const params = useBookParams();
  const { search } = params;
  const query = useMemo<StockDocumentsQuery | null>(() => {
    if (!params.ready) return null;
    const docTypes = search
      .getAll('t')
      .flatMap((value) => DOC_TYPES.filter((type) => type === value));
    const warehouseIds = idsParam(search, 'w');
    const ids = {
      productId: idParamOf(search, 'pr'),
      customerId: idParamOf(search, 'c'),
      supplierId: idParamOf(search, 's'),
      userId: idParamOf(search, 'u'),
    };
    return {
      from: params.from,
      to: params.to,
      ...(docTypes.length ? { docTypes } : {}),
      ...(warehouseIds.length ? { warehouseIds } : {}),
      ...Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined)),
    };
  }, [params.ready, params.from, params.to, search]);
  return { ...params, query };
}

/** «Тайлан → Бараа материал баримтаар» (ADR-0133). */
export function StockDocumentsPage() {
  const { t } = useTranslation();
  const state = useStockDocumentsQuery();
  const [prompting, setPrompting] = useState(!state.ready);
  const report = useStockDocuments(state.query);
  const options = useBookOptions();
  const downloads = useBookDownloads();
  const action = useAction();
  const title = t('reports.books.titles.stockDocuments');
  const { search } = state;
  const filters = [
    ...search.getAll('t').map((type) => t(`reports.books.docTypes.${type as StockDocType}`)),
    ...idsParam(search, 'w').map(
      (id) => options.data?.warehouses.find((w) => w.id === id)?.name ?? String(id),
    ),
    ...(idParamOf(search, 'u')
      ? [options.data?.users.find((u) => u.id === idParamOf(search, 'u'))?.name ?? '']
      : []),
    ...['prn', 'cn', 'sn'].flatMap((key) => (search.get(key) ? [search.get(key) ?? ''] : [])),
  ].filter(Boolean);
  const openPrompt = () => setPrompting(true);
  return (
    <BookPage columns={null}>
      <div className="print:hidden">
        <PageHeader
          compact
          title={title}
          actions={
            <BookActions
              views="stock-documents"
              ready={state.query !== null && report.data !== undefined}
              period={state.query}
              onPrompt={openPrompt}
              excelPending={downloads.stockDocuments.isPending}
              onExcel={() => {
                const query = state.query;
                if (!query) return;
                void action.run(async () =>
                  saveBlob(
                    await downloads.stockDocuments.mutateAsync(query),
                    `baraa-barimtaar-${query.from}-${query.to}.xlsx`,
                  ),
                );
              }}
            />
          }
        />
      </div>
      <StockDocumentsPrompt
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
          <StockDocumentsTable
            report={report.data ?? null}
            warehouseIds={state.query.warehouseIds}
            precision={state.precision}
            onPrompt={openPrompt}
          />
        </BookSheet>
      ) : (
        <BookBlank title={title} icon={FileStack} orientation="landscape" onPrompt={openPrompt} />
      )}
    </BookPage>
  );
}

/**
 * Number, date, description, type, author, party, quantity, the cost for the margins right, total
 * and net (the whole width, landscape A4).
 */
function stockDocumentColumns(values: boolean): BookColumn[] {
  return [
    COL.docNumber,
    COL.date,
    textColumn(20, 10),
    COL.docType,
    COL.person,
    textColumn(14, 9),
    COL.qty,
    ...(values ? [COL.money] : []),
    COL.money,
    COL.money,
  ];
}

function StockDocumentsPrompt(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReturnType<typeof useStockDocumentsQuery>;
  title: string;
  options: BookOptions | undefined;
}) {
  const { t } = useTranslation();
  const { search } = props.state;
  const dates = usePromptDates(props.state.from, props.state.to);
  const [types, setTypes] = useState<string[]>(search.getAll('t'));
  const [warehouses, setWarehouses] = useState<string[]>(search.getAll('w'));
  const [product, setProduct] = useState<{ id: number; label: string } | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerLabel, setCustomerLabel] = useState(search.get('cn'));
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [supplierLabel, setSupplierLabel] = useState(search.get('sn'));
  const [author, setAuthor] = useState(search.get('u') ?? '');
  const [precision, setPrecision] = useState<Precision>(props.state.precision);
  useEffect(() => {
    if (!props.open) return;
    setTypes(search.getAll('t'));
    setWarehouses(search.getAll('w'));
    const id = idParamOf(search, 'pr');
    setProduct(id ? { id, label: search.get('prn') ?? String(id) } : null);
    setCustomer(null);
    setCustomerLabel(search.get('cn'));
    setSupplier(null);
    setSupplierLabel(search.get('sn'));
    setAuthor(search.get('u') ?? '');
  }, [props.open, search]);
  const customerId = customer?.id ?? (customerLabel ? idParamOf(search, 'c') : undefined);
  const supplierId = supplier?.id ?? (supplierLabel ? idParamOf(search, 's') : undefined);
  const submit = () => {
    props.state.apply({
      from: dates.start,
      to: dates.end,
      p: precision === '2' ? null : precision,
      t: types,
      w: warehouses,
      pr: product?.id,
      prn: product?.label,
      c: customerId,
      cn: customerId ? (customer ? `${customer.name} · ${customer.code}` : customerLabel) : null,
      s: supplierId,
      sn: supplierId ? (supplier ? `${supplier.name} · ${supplier.code}` : supplierLabel) : null,
      u: author,
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
            label={t('reports.books.prompt.docTypes')}
            options={DOC_TYPES.map((type) => ({
              value: type,
              label: t(`reports.books.docTypes.${type}`),
            }))}
            values={types}
            onChange={setTypes}
          />
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
          <SelectField
            id="book-author"
            label={t('reports.books.prompt.author')}
            value={author}
            options={(props.options?.users ?? []).map((u) => ({
              value: String(u.id),
              label: u.name,
            }))}
            onChange={setAuthor}
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
          <PickedField
            label={t('reports.books.prompt.supplier')}
            htmlFor="book-supplier"
            picked={supplier ? `${supplier.name} · ${supplier.code}` : supplierLabel}
            onClear={() => {
              setSupplier(null);
              setSupplierLabel(null);
            }}
          >
            <SupplierPicker id="book-supplier" value={supplier} onChange={setSupplier} floating />
          </PickedField>
        </>
      }
      view={<PrecisionField value={precision} onChange={setPrecision} />}
    />
  );
}

/** «Үндсэн Борлуулалт - Маргааш авна»: the type, then what the document says. */
function useDescription() {
  const { t } = useTranslation();
  return (row: StockDocumentRow) =>
    [
      row.sourceWarehouse && row.destWarehouse
        ? `${row.sourceWarehouse} → ${row.destWarehouse}`
        : null,
      row.reason ? t(`inventory.reasons.${row.reason}`, { defaultValue: row.reason }) : null,
      row.note,
    ]
      .filter(Boolean)
      .join(' - ');
}

function StockDocumentsHead({ values }: { values: boolean }) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {(['number', 'date', 'description', 'docType', 'author', 'party'] as const).map((key) => (
          <TableHead key={key} className={key === 'party' ? GROUP_END : undefined}>
            {t(`reports.books.columns.${key}`)}
          </TableHead>
        ))}
        <TableHead className="text-right">{t('reports.books.columns.qty')}</TableHead>
        {values ? (
          <TableHead className="text-right">{t('reports.books.columns.cost')}</TableHead>
        ) : null}
        <TableHead className="text-right">{t('reports.books.columns.total')}</TableHead>
        <TableHead className="text-right">{t('reports.books.columns.net')}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function StockDocumentsTable(props: {
  report: {
    rows: readonly StockDocumentRow[];
    totals: { inValue: string | null; outValue: string | null; total: string; net: string };
    truncated: boolean;
  } | null;
  warehouseIds?: number[];
  precision: Precision;
  onPrompt: () => void;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const describe = useDescription();
  const values = props.report ? props.report.totals.inValue !== null : true;
  const span = values ? 10 : 9;
  const columns = stockDocumentColumns(values);
  if (props.report === null) {
    return (
      <BookTable columns={columns}>
        <StockDocumentsHead values={values} />
        <SkeletonBody columns={span} />
      </BookTable>
    );
  }
  if (props.report.rows.length === 0) {
    return (
      <BookTable columns={columns}>
        <StockDocumentsHead values={values} />
        <EmptyRow colSpan={span} onPrompt={props.onPrompt} />
      </BookTable>
    );
  }
  const money = (value: string | null, zero = '') => amount(value, props.precision, zero);
  return (
    <BookTable columns={columns}>
      <StockDocumentsHead values={values} />
      <TableBody>
        {props.report.rows.map((row) => {
          const key = `${row.docType}:${row.docId}`;
          const expanded = drill.open.has(key);
          const toggle = () => drill.toggle(key);
          const number = row.number ?? String(row.docId);
          return (
            <Fragment key={key}>
              <DrillRow expanded={expanded} onToggle={toggle}>
                <DrillCell expanded={expanded} onToggle={toggle} text={number} />
                <TableCell className="tabular-nums">{row.date}</TableCell>
                <TextCell text={describe(row)} />
                <TextCell text={t(`reports.books.docTypes.${row.docType}`)} />
                <TextCell text={row.authorName ?? ''} />
                <TextCell text={row.partyName ?? ''} className={GROUP_END} />
                <TableCell className={NUM}>{movedQty(row)}</TableCell>
                {values ? <TableCell className={NUM}>{money(movedValue(row))}</TableCell> : null}
                <TableCell className={NUM}>{row.total === null ? '' : money(row.total)}</TableCell>
                <TableCell className={NUM}>{row.net === null ? '' : money(row.net)}</TableCell>
              </DrillRow>
              {expanded ? (
                <DocumentDetail
                  row={row}
                  warehouseIds={props.warehouseIds}
                  values={values}
                  precision={props.precision}
                  span={span}
                />
              ) : null}
            </Fragment>
          );
        })}
        <TotalRow labelSpan={values ? 8 : 7}>
          <TableCell className={NUM}>{money(props.report.totals.total, '0')}</TableCell>
          <TableCell className={NUM}>{money(props.report.totals.net, '0')}</TableCell>
        </TotalRow>
        {props.report.truncated ? (
          <NoteRow colSpan={span}>{t('reports.prompt.truncated')}</NoteRow>
        ) : null}
      </TableBody>
    </BookTable>
  );
}

/** What a document moved: «7» in, «−1» out, «+2 / −2» both ways (a transfer). */
function movedQty(row: StockDocumentRow): string {
  const inQty = quantity(row.inQty);
  const outQty = quantity(row.outQty);
  if (inQty && outQty) return `+${inQty} / ${MINUS}${outQty}`;
  return inQty || (outQty ? `${MINUS}${outQty}` : '');
}

/** The cost that moved: the incoming side, the outgoing side, the outgoing one of a transfer. */
function movedValue(row: StockDocumentRow): string | null {
  return row.outQty !== '0' ? row.outValue : row.inValue;
}

/**
 * The products of a document — code, name and, when known, the unit cost «нэгж 5,000» — with the
 * warehouse, the quantity and the cost; a click opens the document itself.
 */
function DocumentDetail(props: {
  row: StockDocumentRow;
  warehouseIds?: number[];
  values: boolean;
  precision: Precision;
  span: number;
}) {
  const { t } = useTranslation();
  const lines = useStockDocumentLines({
    docType: props.row.docType,
    docId: props.row.docId,
    ...(props.warehouseIds?.length ? { warehouseIds: props.warehouseIds } : {}),
  });
  if (lines.isPending) return <DetailSkeleton colSpan={props.span} />;
  if (lines.error) {
    return (
      <NoteRow colSpan={props.span}>
        <ProblemAlert problem={problemFromError(lines.error)} />
      </NoteRow>
    );
  }
  const href = stockDocHref(props.row.docType, props.row.docId, props.row.invoiceId);
  return (
    <>
      {lines.data.map((line) => {
        const unit =
          props.values && line.unitCost !== null && !isZero(line.unitCost)
            ? t('reports.books.table.unitShort', {
                cost: amount(line.unitCost, props.precision),
              })
            : null;
        const parts = detailParts(line.sku, [line.name, unit]);
        return (
          <DetailRow
            key={`${line.productId}:${line.warehouseId}`}
            href={href}
            label={detailText(line.sku, parts)}
          >
            <DetailLabel number={line.sku} parts={parts} colSpan={3} />
            <TextCell text={line.warehouseName} colSpan={3} className={GROUP_END} />
            <TableCell className={NUM}>{quantity(line.qty)}</TableCell>
            {props.values ? (
              <TableCell className={NUM}>{amount(line.value, props.precision)}</TableCell>
            ) : null}
            <TableCell />
            <TableCell />
          </DetailRow>
        );
      })}
    </>
  );
}
