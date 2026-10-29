import { Decimal } from '@tugeel/shared/money';
import { splitBoxes } from '@tugeel/shared/procurement';
import { ArrowLeft, ArrowRight, PackagePlus, PackageSearch } from 'lucide-react';
import { type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, LoadMore, SkeletonRows, TruncateCell } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  type GridPage,
  type GridQuery,
  type GridRow,
  type PurchaseOrderSupplier,
  usePurchaseOrderRows,
} from './api';
import {
  arrivalEditOf,
  arrivedBaseOf,
  type CellEdit,
  isDirty,
  normalizePrice,
  normalizeQty,
  normalizeShipped,
  orderEditOf,
  priceEditOf,
  rowLabel,
  shippedEditOf,
} from './order-edits';
import { type ColumnView, shows } from './order-columns';
import { PoStatusBadge } from './parts';

/** The columns of each group, for the header and the group rows' spans. */
function columnCount(view: ColumnView): number {
  let count = 2; // sku, name
  if (shows(view, 'stock')) count += 3;
  if (shows(view, 'sales')) count += 4;
  if (shows(view, 'order')) count += 6 + (view.canPrices ? 2 : 0);
  if (shows(view, 'shipping')) count += 1;
  if (shows(view, 'receiving')) count += 3;
  if (shows(view, 'pricing')) count += 3;
  return count;
}

/** `boxes · pieces` of a base quantity in the row's ordered unit; pieces alone for a piece unit. */
function boxesText(base: string, factor: string): string {
  if (new Decimal(factor).lte(1)) return formatQty(base);
  const split = splitBoxes(base, factor);
  return `${formatQty(split.boxes.toFixed())} · ${formatQty(split.pieces.toFixed())}`;
}

type ColumnKey =
  | 'sku'
  | 'name'
  | 'warehouse'
  | 'onHand'
  | 'minQty'
  | 'avg12'
  | 'avg3'
  | 'lastMonth'
  | 'sameMonthLastYear'
  | 'boxSize'
  | 'unitWeight'
  | 'unit'
  | 'qty'
  | 'pieces'
  | 'kg'
  | 'lastPrice'
  | 'estimated'
  | 'shipped'
  | 'arrived'
  | 'difference'
  | 'note'
  | 'unitPrice'
  | 'amount'
  | 'priceDiff';

export function OrderTableHead({ view, salesMonths }: { view: ColumnView; salesMonths?: string }) {
  const { t } = useTranslation();
  const head = (key: ColumnKey, className = 'text-right', title?: string) => (
    <TableHead className={className} title={title}>
      {t(`procurement.detail.columns.${key}`)}
    </TableHead>
  );
  return (
    <TableHeader>
      <TableRow>
        {head('sku', '')}
        {head('name', '')}
        {shows(view, 'stock') ? (
          <>
            {head('warehouse', '')}
            {head('onHand')}
            {head('minQty')}
          </>
        ) : null}
        {shows(view, 'sales') ? (
          <>
            {head('avg12', 'text-right', salesMonths)}
            {head('avg3', 'text-right', salesMonths)}
            {head('lastMonth')}
            {head('sameMonthLastYear')}
          </>
        ) : null}
        {shows(view, 'order') ? (
          <>
            {head('boxSize')}
            {head('unitWeight')}
            {head('unit', '')}
            {head('qty')}
            {head('pieces')}
            {head('kg')}
            {view.canPrices ? head('lastPrice') : null}
            {view.canPrices ? head('estimated') : null}
          </>
        ) : null}
        {shows(view, 'shipping') ? head('shipped') : null}
        {shows(view, 'receiving') ? (
          <>
            {head('arrived')}
            {head('difference')}
            {head('note', '')}
          </>
        ) : null}
        {shows(view, 'pricing') ? (
          <>
            {head('unitPrice')}
            {head('amount')}
            {head('priceDiff')}
          </>
        ) : null}
      </TableRow>
    </TableHeader>
  );
}

export interface SupplierGroupProps {
  orderId: number;
  supplier: PurchaseOrderSupplier;
  query: GridQuery;
  view: ColumnView;
  edits: ReadonlyMap<string, CellEdit>;
  conflicted: ReadonlySet<string>;
  onEdit: (edit: CellEdit) => void;
  onMove: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
  onAddExtra: (supplier: PurchaseOrderSupplier, receiptId: number) => void;
  movePending: boolean;
  /** Enter in an input goes to the next input of the same kind. */
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The first page's facts the page needs (the receipt's version for the price check). */
  onPage?: (supplierId: number, page: GridPage) => void;
}

/**
 * One supplier inside the order's table (ADR-0118 #2): its header row with the status and the next
 * step, its products 200 at a time with every stage's cells, and its footer with the totals.
 */
export function SupplierGroup(props: SupplierGroupProps) {
  const { t } = useTranslation();
  const { supplier, view, edits, orderId } = props;
  const rows = usePurchaseOrderRows(orderId, supplier.supplierId, props.query);
  const first = rows.data?.pages[0];
  const loaded = rows.data?.pages.flatMap((page) => page.data) ?? [];
  const extra = first?.extra ?? [];
  const columns = columnCount(view);
  const span = { colSpan: columns };
  const notOrdered =
    first && props.query.filter === 'ALL' && !props.query.q && props.query.warehouseId === undefined
      ? Math.max(first.total - supplier.lineCount, 0)
      : null;
  const name = supplier.supplierName;
  const noteAmountKey = `noteAmount:${supplier.supplierId}`;
  const noteAmountEdit = edits.get(noteAmountKey);
  const noteAmount =
    noteAmountEdit?.kind === 'noteAmount'
      ? noteAmountEdit.amount
      : supplier.noteTotalAmount === null
        ? ''
        : new Decimal(supplier.noteTotalAmount).toFixed(2).replace(/\.00$/, '');

  const describe = (row: GridRow, isExtra: boolean) => (
    <ProductRow
      key={`${isExtra ? 'x' : 'r'}:${row.productId}`}
      row={row}
      isExtra={isExtra}
      page={first}
      {...props}
    />
  );

  return (
    <TableBody>
      <TableRow className="bg-accent/40 hover:bg-accent/40">
        <TableCell {...span} className="h-10 py-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">{name}</span>
            <PoStatusBadge status={supplier.status} />
            {supplier.canMoveBack ? (
              <Button
                size="xs"
                variant="ghost"
                aria-label={t('procurement.supplier.backNamed', { name })}
                title={t('procurement.supplier.backNamed', { name })}
                disabled={props.movePending}
                onClick={() => props.onMove(supplier, -1)}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            {supplier.canMoveNext ? (
              <Button
                size="xs"
                variant="secondary"
                aria-label={t('procurement.supplier.nextNamed', { name })}
                disabled={props.movePending}
                onClick={() => props.onMove(supplier, 1)}
              >
                <ArrowRight />
                {t('procurement.detail.nextStep', {
                  status: nextStatus(supplier.status)
                    ? t(`procurement.status.${nextStatus(supplier.status) ?? 'PREPARING'}`)
                    : '',
                })}
              </Button>
            ) : null}
            {notOrdered !== null && notOrdered > 0 ? (
              <span className="text-[13px] text-muted-foreground">
                {t('procurement.detail.notOrdered', { count: formatCount(notOrdered) })}
              </span>
            ) : null}
            <span className="font-mono text-[13px] text-muted-foreground">
              {t('procurement.detail.piecesKg', {
                pieces: formatQty(supplier.qtyBase),
                kg: formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString()),
              })}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {t('procurement.supplier.orderer')}:{' '}
              {supplier.ordererName ?? t('procurement.supplier.noOrderer')}
            </span>
            {supplier.receiptId !== null ? (
              <Link
                to={`/inventory/receipts/${supplier.receiptId}`}
                className="font-mono text-[13px] text-link underline-offset-4 hover:underline"
              >
                {supplier.receiptNumber ??
                  t('procurement.supplier.receiptDraft', { id: supplier.receiptId })}
              </Link>
            ) : null}
            {supplier.status === 'ARRIVED' && supplier.canCount && supplier.receiptId !== null ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  supplier.receiptId !== null && props.onAddExtra(supplier, supplier.receiptId)
                }
              >
                <PackagePlus />
                {t('procurement.detail.addExtra')}
              </Button>
            ) : null}
            {supplier.canPrice && first?.rights.price ? (
              <label className="ml-auto flex items-center gap-1.5 text-[13px]">
                <span>{t('procurement.detail.noteAmount')}</span>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={t('procurement.detail.noteAmountOf', { name })}
                  aria-invalid={normalizePrice(noteAmount).valid ? undefined : true}
                  className="h-7 w-32 text-right font-mono"
                  value={noteAmount}
                  onChange={(event) =>
                    props.onEdit({
                      kind: 'noteAmount',
                      supplierId: supplier.supplierId,
                      amount: event.target.value,
                      prev: supplier.noteTotalAmount,
                    })
                  }
                />
              </label>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {rows.error ? (
        <TableRow>
          <TableCell {...span}>
            <ProblemAlert problem={problemFromError(rows.error)} onRetry={rows.refetch} />
          </TableCell>
        </TableRow>
      ) : null}
      {rows.isPending ? <SkeletonRows columns={columns} rows={3} /> : null}
      {loaded.map((row) => describe(row, false))}
      {extra.map((row) => describe(row, true))}
      {!rows.isPending && loaded.length === 0 && extra.length === 0 ? (
        <TableRow>
          <TableCell {...span} className="h-auto py-2">
            <EmptyState
              icon={PackageSearch}
              title={t(
                props.query.q || props.query.filter !== 'ALL' || props.query.warehouseId
                  ? 'procurement.grid.emptyFiltered'
                  : 'procurement.grid.empty',
              )}
            />
          </TableCell>
        </TableRow>
      ) : null}
      {rows.hasNextPage ? (
        <TableRow>
          <TableCell {...span} className="h-auto py-1">
            <LoadMore query={rows} />
          </TableCell>
        </TableRow>
      ) : null}
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell {...span} className="h-9 text-[13px]">
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono">
            <span>
              {t('procurement.detail.piecesKg', {
                pieces: formatQty(supplier.qtyBase),
                kg: formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString()),
              })}
            </span>
            {supplier.arrivedBase !== null ? (
              <span>
                {t('procurement.detail.arrivedTotal', { pieces: formatQty(supplier.arrivedBase) })}
              </span>
            ) : null}
            {view.canPrices && supplier.estimatedCost !== null ? (
              <span>
                {t('procurement.detail.estimated')} {formatTugrik(supplier.estimatedCost)}
              </span>
            ) : null}
            {view.canPrices && supplier.finalAmount !== null ? (
              <span>
                {t('procurement.detail.final')} {formatTugrik(supplier.finalAmount)}
              </span>
            ) : null}
            {view.canPrices && supplier.priceDiffCount !== null ? (
              <span>
                {t('procurement.detail.priceDiffCount', {
                  count: formatCount(supplier.priceDiffCount),
                })}
              </span>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

const MANUAL = ['PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED'] as const;
function nextStatus(status: PurchaseOrderSupplier['status']): (typeof MANUAL)[number] | undefined {
  return MANUAL[MANUAL.indexOf(status as (typeof MANUAL)[number]) + 1];
}

function ProductRow(
  props: SupplierGroupProps & { row: GridRow; isExtra: boolean; page: GridPage | undefined },
) {
  const { t } = useTranslation();
  const { row, supplier, view, edits, isExtra } = props;
  const supplierId = supplier.supplierId;
  const label = rowLabel(row);
  const orderEdit = edits.get(`order:${supplierId}:${row.productId}`);
  const order = orderEdit?.kind === 'order' ? orderEdit : orderEditOf(supplierId, row);
  const shippedEdit = edits.get(`shipped:${supplierId}:${row.productId}`);
  const shipped = shippedEdit?.kind === 'shipped' ? shippedEdit : shippedEditOf(supplierId, row);
  const arrivalStored = row.receipt
    ? edits.get(`arrival:${supplierId}:${row.receipt.lineId}`)
    : null;
  const arrival =
    arrivalStored?.kind === 'arrival' ? arrivalStored : arrivalEditOf(supplierId, row);
  const priceStored = row.receipt ? edits.get(`price:${supplierId}:${row.receipt.lineId}`) : null;
  const price = priceStored?.kind === 'price' ? priceStored : priceEditOf(supplierId, row);

  const typed = normalizeQty(order.qty);
  const unit = row.units.find((candidate) => candidate.id === order.unitId);
  const factor = unit?.factor ?? '1';
  const pieces = typed.qty && unit ? new Decimal(typed.qty).times(factor) : null;
  const kg = pieces && row.weightKg ? pieces.times(row.weightKg) : null;
  const below = row.minQty !== null && new Decimal(row.onHand).lt(row.minQty);
  const estimated =
    view.canPrices && row.lastBasePrice && pieces
      ? pieces.times(row.lastBasePrice).toDecimalPlaces(2).toFixed()
      : null;
  const dirty = [orderEdit, shippedEdit, arrivalStored, priceStored].some(
    (edit) => edit && isDirty(edit),
  );
  const conflict = [
    `order:${supplierId}:${row.productId}`,
    `shipped:${supplierId}:${row.productId}`,
    row.receipt ? `arrival:${supplierId}:${row.receipt.lineId}` : '',
  ].some((key) => key && props.conflicted.has(key));

  const arrivedBase = arrival ? arrivedBaseOf(arrival) : null;
  const expectedBase = row.receipt?.expectedBase ?? null;
  const difference =
    arrivedBase?.base != null && expectedBase !== null
      ? new Decimal(arrivedBase.base).minus(expectedBase)
      : null;
  const showNote =
    arrival !== null &&
    ((difference !== null && !difference.isZero()) || arrival.note !== '' || arrival.notArrived);
  const canCount = row.receipt?.canCount ?? false;
  const canPrice = (props.page?.rights.price ?? false) && row.receipt !== null;
  const typedPrice = price ? normalizePrice(price.unitPrice) : null;
  const arrivedUnits =
    row.receipt && arrivedBase?.base != null
      ? new Decimal(arrivedBase.base).div(row.receipt.factor)
      : null;
  const amount =
    typedPrice?.price && arrivedUnits
      ? arrivedUnits.times(typedPrice.price).toDecimalPlaces(2)
      : null;
  const previous = row.receipt?.previousUnitPrice ?? null;
  const priceDiff =
    typedPrice?.price && previous ? new Decimal(typedPrice.price).minus(previous) : null;

  const cell = (children: ReactNode, className = 'text-right font-mono') => (
    <TableCell className={className}>{children}</TableCell>
  );

  return (
    <TableRow
      className={cn(conflict && 'bg-warning-soft', dirty && !conflict && 'bg-secondary/40')}
    >
      <TableCell className="font-mono">{row.sku}</TableCell>
      <TruncateCell text={row.name}>
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate">{row.name}</span>
          {below ? <Badge variant="destructive">{t('procurement.detail.orderBadge')}</Badge> : null}
          {isExtra ? <Badge variant="warning">{t('procurement.detail.extraBadge')}</Badge> : null}
        </span>
      </TruncateCell>
      {shows(view, 'stock') ? (
        <>
          <TableCell className="text-muted-foreground">
            {row.homeWarehouseName ?? t('procurement.grid.noHome')}
          </TableCell>
          {cell(
            <span
              className={cn(below && 'font-semibold text-destructive')}
              title={formatQty(row.onHand)}
            >
              {boxesText(row.onHand, factor)}
            </span>,
          )}
          {cell(row.minQty === null ? t('common.none') : formatQty(row.minQty))}
        </>
      ) : null}
      {shows(view, 'sales') ? (
        <>
          {cell(boxesText(row.sales.avg12, factor))}
          {cell(boxesText(row.sales.avg3, factor))}
          {cell(boxesText(row.sales.lastMonth, factor))}
          {cell(boxesText(row.sales.sameMonthLastYear, factor))}
        </>
      ) : null}
      {shows(view, 'order') ? (
        <>
          {cell(unit && !unit.isBase ? formatQty(unit.factor) : t('common.none'))}
          {cell(row.weightKg ? formatQty(row.weightKg) : t('common.none'))}
          <TableCell className="py-1">
            <NativeSelect
              aria-label={t('procurement.grid.unitOf', { product: label })}
              className="h-8 w-28"
              disabled={!row.editable}
              value={String(order.unitId)}
              onChange={(event) =>
                props.onEdit({ ...order, unitId: Number.parseInt(event.target.value, 10) })
              }
            >
              {row.units.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.isBase
                    ? option.name
                    : t('procurement.grid.unitFactor', {
                        unit: option.name,
                        factor: formatQty(option.factor),
                      })}
                </option>
              ))}
            </NativeSelect>
          </TableCell>
          <TableCell className="py-1 text-right">
            <Input
              data-po-cell="order"
              inputMode="decimal"
              autoComplete="off"
              aria-label={t('procurement.grid.qtyOf', { product: label })}
              aria-invalid={typed.valid ? undefined : true}
              className="ml-auto h-8 w-20 text-right font-mono"
              disabled={!row.editable}
              value={order.qty}
              onChange={(event) => props.onEdit({ ...order, qty: event.target.value })}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={props.onEnter}
            />
          </TableCell>
          {cell(pieces ? formatQty(pieces.toFixed()) : '')}
          {cell(kg ? formatQty(kg.toDecimalPlaces(2).toFixed()) : '')}
          {view.canPrices
            ? cell(row.lastBasePrice ? formatTugrik(row.lastBasePrice) : t('common.none'))
            : null}
          {view.canPrices ? cell(estimated ? formatTugrik(estimated) : '') : null}
        </>
      ) : null}
      {shows(view, 'shipping') ? (
        <TableCell className="py-1 text-right">
          {row.canShip ? (
            <Input
              data-po-cell="shipped"
              inputMode="decimal"
              autoComplete="off"
              aria-label={t('procurement.detail.shippedOf', { product: label })}
              aria-invalid={normalizeShipped(shipped.qty).valid ? undefined : true}
              className="ml-auto h-8 w-20 text-right font-mono"
              value={shipped.qty}
              onChange={(event) => props.onEdit({ ...shipped, qty: event.target.value })}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={props.onEnter}
            />
          ) : (
            <span className="font-mono">
              {row.line?.shippedQty ? formatQty(row.line.shippedQty) : t('common.none')}
            </span>
          )}
        </TableCell>
      ) : null}
      {shows(view, 'receiving') ? (
        <>
          <TableCell className="py-1 text-right">
            {arrival && row.receipt ? (
              canCount ? (
                <span className="flex items-center justify-end gap-1">
                  <Input
                    data-po-cell="arrival"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={t('procurement.detail.arrivedBoxesOf', { product: label })}
                    aria-invalid={arrivedBase?.valid ? undefined : true}
                    className="h-8 w-14 text-right font-mono"
                    disabled={arrival.notArrived || new Decimal(arrival.factor).lte(1)}
                    value={arrival.boxes}
                    onChange={(event) => props.onEdit({ ...arrival, boxes: event.target.value })}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={props.onEnter}
                  />
                  <span className="text-muted-foreground">{'×'}</span>
                  <Input
                    data-po-cell="arrival"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={t('procurement.detail.arrivedPiecesOf', { product: label })}
                    aria-invalid={arrivedBase?.valid ? undefined : true}
                    className="h-8 w-14 text-right font-mono"
                    disabled={arrival.notArrived}
                    value={arrival.pieces}
                    onChange={(event) => props.onEdit({ ...arrival, pieces: event.target.value })}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={props.onEnter}
                  />
                  <label className="ml-1 flex items-center gap-1 text-xs whitespace-nowrap">
                    <Checkbox
                      aria-label={t('procurement.detail.notArrivedOf', { product: label })}
                      checked={arrival.notArrived}
                      onCheckedChange={(checked) =>
                        props.onEdit({ ...arrival, notArrived: checked === true })
                      }
                    />
                    {t('procurement.detail.notArrived')}
                  </label>
                </span>
              ) : (
                <span className="font-mono">
                  {row.receipt.arrivedBase === null
                    ? t('procurement.detail.unchecked')
                    : new Decimal(row.receipt.arrivedBase).isZero()
                      ? t('procurement.detail.notArrived')
                      : boxesText(row.receipt.arrivedBase, arrival.factor)}
                </span>
              )
            ) : null}
          </TableCell>
          {cell(
            difference === null ? (
              ''
            ) : difference.isZero() ? (
              <Badge variant="success">0</Badge>
            ) : (
              <Badge variant={difference.isNegative() ? 'destructive' : 'warning'}>
                {difference.isNegative() ? '' : '+'}
                {formatQty(difference.toFixed())}
              </Badge>
            ),
          )}
          <TableCell className="py-1">
            {arrival && showNote ? (
              canCount ? (
                <Input
                  aria-label={t('procurement.detail.noteOf', { product: label })}
                  maxLength={500}
                  className="h-8 w-40"
                  value={arrival.note}
                  onChange={(event) => props.onEdit({ ...arrival, note: event.target.value })}
                />
              ) : (
                <span className="text-[13px]">{row.receipt?.note}</span>
              )
            ) : null}
          </TableCell>
        </>
      ) : null}
      {shows(view, 'pricing') ? (
        <>
          <TableCell className="py-1 text-right">
            {price && row.receipt ? (
              canPrice ? (
                <Input
                  data-po-cell="price"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={t('procurement.detail.unitPriceOf', { product: label })}
                  aria-invalid={typedPrice?.valid ? undefined : true}
                  title={row.receipt.unitName}
                  className="ml-auto h-8 w-24 text-right font-mono"
                  value={price.unitPrice}
                  onChange={(event) => props.onEdit({ ...price, unitPrice: event.target.value })}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={props.onEnter}
                />
              ) : (
                <span className="font-mono">
                  {row.receipt.docUnitPrice ? formatTugrik(row.receipt.docUnitPrice) : ''}
                </span>
              )
            ) : null}
          </TableCell>
          {cell(
            amount
              ? formatTugrik(amount.toFixed())
              : row.receipt?.docAmount
                ? formatTugrik(row.receipt.docAmount)
                : '',
          )}
          <TableCell className="text-right">
            {previous !== null ? (
              <span className="flex flex-col items-end leading-tight">
                {priceDiff !== null ? (
                  priceDiff.isZero() ? (
                    <Badge variant="success">0</Badge>
                  ) : (
                    <Badge variant={priceDiff.isPositive() ? 'destructive' : 'default'}>
                      {priceDiff.isPositive() ? '+' : ''}
                      {formatTugrik(priceDiff.toFixed())}
                    </Badge>
                  )
                ) : null}
                <span
                  className="text-xs text-muted-foreground"
                  title={row.receipt?.previousDate ?? undefined}
                >
                  {t('procurement.detail.previousPrice', { price: formatTugrik(previous) })}
                </span>
              </span>
            ) : (
              <Badge variant="outline">{t('procurement.detail.noPrevious')}</Badge>
            )}
          </TableCell>
        </>
      ) : null}
    </TableRow>
  );
}
