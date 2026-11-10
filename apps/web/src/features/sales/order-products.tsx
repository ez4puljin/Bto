import { Decimal } from '@tugeel/shared/money';
import { isEditable, MANAGER_EDITABLE_STATUSES } from '@tugeel/shared/sales';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import {
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SearchField,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isQty, useWarehouseName } from '@/features/inventory/helpers';
import { ProductSearch } from '@/features/inventory/shared';
import { useLinesQuote } from '@/features/pricing/api';
import { UnitSelect } from '@/features/pricing/quote-table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt, formatQty, formatTugrik, plainDecimal } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type SalesOrder,
  type SalesOrderLine,
  useProductOrderInfo,
  useSalesOrderMutations,
} from './api';
import { PartGroupHeader, PickDraftCell } from './order-pick';
import { orderRequestOf } from './order-request';
import { shortOf, usePickDrafts } from './pick-drafts';
import { usePickerSelf } from './use-picker-self';

/** A line as the table edits it; saved lines keep their id as the key. */
interface EditLine {
  key: string;
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  unitName: string;
  qty: string;
}

const PICKED_FILTERS = ['ALL', 'PICKED', 'NOT_PICKED', 'SHORT'] as const;
type PickedFilter = (typeof PICKED_FILTERS)[number];

/** What a price column shows: the parts (a pack and loose pieces may differ) and the total. */
interface Price {
  priced: boolean;
  parts: { qty: string; uomName: string; unitPrice: string; listPrice: string }[];
  discountAmount: string | null;
  total: string | null;
}

const linesOf = (order: SalesOrder): EditLine[] =>
  order.lines.map((line) => ({
    key: String(line.id),
    productId: line.productId,
    sku: line.productSku,
    name: line.productName,
    unitId: line.productUnitId,
    unitName: line.unitName,
    qty: plainDecimal(line.qty),
  }));

const isPicked = (line: SalesOrderLine | undefined) =>
  line !== undefined && line.qtyPicked !== null && new Decimal(line.qtyPicked).gt(0);

/**
 * The table's columns (ADR-0119) in two groups: the quantities as the order goes — ordered (in the
 * line's unit), reserved (backorders under it), picked (its shelf under it), the deduction — then
 * the money, one column with the list price and the discount under the amount. Few columns, so the
 * table fits the panel instead of squeezing its inputs.
 */
function lineColumns(flags: {
  confirmed: boolean;
  picked: boolean;
  /** The signed-in keeper types counts and shelves: the picked column widens. */
  picking: boolean;
  short: boolean;
  /** The warehouse column: left out when the parts head their lines. */
  warehouse: boolean;
  editable: boolean;
}): ColumnSpec[] {
  return [
    { key: 'product', kind: 'text', weight: 3, min: 14 },
    ...(flags.warehouse ? [{ key: 'warehouse', kind: 'text', weight: 1 } as const] : []),
    // An editable unit is a select of 11rem (`UnitSelect`).
    { key: 'unit', kind: 'text', weight: 1, min: flags.editable ? 12 : 7 },
    { key: 'ordered', kind: 'qty', width: flags.editable ? 7 : 6.5 },
    ...(flags.confirmed ? [{ key: 'reserved', kind: 'qty', width: 7.5 } as const] : []),
    ...(flags.picked
      ? flags.picking
        ? [{ key: 'picked', kind: 'text', weight: 1, min: 10 } as const]
        : [{ key: 'picked', kind: 'qty', width: 7.5 } as const]
      : []),
    ...(flags.short ? [{ key: 'short', kind: 'qty', width: 6.5 } as const] : []),
    { key: 'amount', kind: 'money', width: 10.5 },
    ...(flags.editable ? [{ key: 'remove', kind: 'actions', actions: 1 } as const] : []),
  ];
}

/** The first column of a group (the quantities, the money) draws a line before it. */
const GROUP_START = 'border-l border-border/70';

/**
 * «Бараа» (ADR-0059, erxes's Products): the order's lines with a search by name or code, a filter by
 * warehouse and by picked or not. While the order may change, units and quantities are edited in
 * place, products are added and removed, and «Хадгалах» saves them with the header as stored.
 * Prices come from the rules: the frozen ones of a confirmed order, else a quote of the lines.
 */
export function OrderProducts({
  order,
  onDirty,
}: {
  order: SalesOrder;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const mutations = useSalesOrderMutations();
  const action = useAction();
  // An admin changes the lines until the sale (ADR-0126 #4); others while the order is open.
  const admin = useHasPermission('sales.boards.manage');
  const editable =
    order.canEdit &&
    (isEditable(order.status) || (admin && MANAGER_EDITABLE_STATUSES.includes(order.status)));
  const picking = order.status === 'PICKING' || order.status === 'PACKED';
  // The warehouses' parts head their lines (ADR-0126 #2, one tab since 2026-10-31); the signed-in
  // keeper confirms their own PICKING part (a lead any), typing the counts in the rows.
  const self = usePickerSelf();
  const canPick = useHasPermission('sales.orders.pick');
  const parts = order.picks;
  const grouped = parts.length > 0 && (order.status === 'CONFIRMED' || picking);
  const confirming = new Set(
    canPick
      ? parts
          .filter(
            (part) =>
              part.status === 'PICKING' &&
              (part.pickerId === self.id || self.lead) &&
              self.writes(part.warehouseId),
          )
          .map((part) => part.warehouseId)
      : [],
  );
  const drafts = usePickDrafts(order, confirming.size > 0);
  const saved = useMemo(() => linesOf(order), [order]);
  const savedById = useMemo(
    () => new Map(order.lines.map((line) => [String(line.id), line])),
    [order.lines],
  );
  // null: the stored lines; a list: edits not saved yet.
  const [edits, setEdits] = useState<EditLine[] | null>(null);
  const lines = edits ?? saved;
  const dirty = edits !== null;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [warehouse, setWarehouse] = useState<number | null>(null);
  const [picked, setPicked] = useState<PickedFilter>('ALL');

  const info = useProductOrderInfo(lines.map((line) => line.productId));
  const infoOf = (productId: number) => info.data?.find((row) => row.productId === productId);

  // Prices: frozen on a confirmed order nobody is editing; else a quote of the valid lines.
  const frozen = !dirty && order.total !== null;
  const wanted = JSON.stringify(
    lines
      .filter((line) => isQty(line.qty))
      .map((line) => ({ key: line.key, productUnitId: line.unitId, qty: line.qty })),
  );
  const asked = useDebounced(wanted, 300);
  const askedLines = useMemo(
    () => JSON.parse(asked) as { key: string; productUnitId: number; qty: string }[],
    [asked],
  );
  const request = useMemo(
    () => askedLines.map(({ productUnitId, qty }) => ({ productUnitId, qty })),
    [askedLines],
  );
  const quote = useLinesQuote(request, !frozen, order.pipelineId);
  const priceOf = (line: EditLine): Price | null => {
    if (frozen) {
      const stored = savedById.get(line.key);
      if (!stored) return null;
      return {
        priced: stored.total !== null,
        parts: stored.parts.map((part) => ({
          qty: part.qty,
          uomName: part.uomName,
          unitPrice: part.unitPrice,
          listPrice: part.listPrice,
        })),
        discountAmount: stored.discountAmount,
        total: stored.total,
      };
    }
    const index = askedLines.findIndex((entry) => entry.key === line.key);
    const quoted = index < 0 ? undefined : quote.data?.lines[index];
    if (!quoted) return null;
    return {
      priced: quoted.priced,
      parts: quoted.parts.map((part) => ({
        qty: part.qty,
        uomName: part.uomName,
        unitPrice: part.unitPrice,
        listPrice: part.listPrice,
      })),
      discountAmount: quoted.discountAmount,
      total: quoted.total,
    };
  };
  const total = frozen ? order.total : (quote.data?.total ?? null);
  const subtotal = frozen ? order.subtotal : (quote.data?.subtotal ?? null);
  const discountTotal = frozen ? order.discountTotal : (quote.data?.discountTotal ?? null);

  const rows = lines.map((line) => {
    const stored = savedById.get(line.key);
    const row = infoOf(line.productId);
    return {
      line,
      stored,
      warehouseId: stored?.warehouseId ?? row?.homeWarehouseId ?? null,
      problem:
        row && !row.sellable
          ? t('sales.order.notSellable')
          : row && row.homeWarehouseId === null
            ? t('sales.order.noHome')
            : null,
      keys: searchKeys(line.name, [line.sku]),
    };
  });
  // A line's deduction as typed by its keeper now, else as confirmed (ADR-0130).
  const shortText = (stored: SalesOrderLine | undefined) =>
    stored
      ? shortOf(
          stored,
          confirming.has(stored.warehouseId) ? drafts.drafts[stored.id]?.qty : undefined,
        )
      : '';
  const terms = queryTerms(q);
  const shown = rows.filter(
    (row) =>
      (terms.length === 0 || matchesQuery(row.keys, terms)) &&
      (warehouse === null || row.warehouseId === warehouse) &&
      (picked === 'ALL' ||
        (picked === 'SHORT'
          ? shortText(row.stored) !== ''
          : (picked === 'PICKED') === isPicked(row.stored))),
  );
  const warehouses = [
    ...new Set(rows.flatMap((row) => (row.warehouseId === null ? [] : [row.warehouseId]))),
  ];
  const confirmed = order.status !== 'DRAFT';
  const anyPicked = grouped || order.lines.some((line) => line.qtyPicked !== null);
  const shortLines = order.lines.filter((line) => shortText(line) !== '');
  const anyShort = confirming.size > 0 || shortLines.length > 0;
  const invalid = lines.some((line) => !isQty(line.qty));
  const blocked = rows.some((row) => row.problem !== null);
  const backordered = order.lines.filter((line) => new Decimal(line.qtyBackordered).gt(0));
  const picksNow = confirming.size > 0;
  const columns = useMemo(
    () =>
      lineColumns({
        confirmed,
        picked: anyPicked,
        picking: picksNow,
        short: anyShort,
        warehouse: !grouped,
        editable,
      }),
    [confirmed, anyPicked, picksNow, anyShort, grouped, editable],
  );
  // The table in sections: each part's lines under its header; lines of no part (a draft, or new
  // ones) at the end without one.
  const sections = grouped
    ? [
        ...parts.map((part) => ({
          part,
          rows: shown.filter((row) => row.warehouseId === part.warehouseId),
        })),
        {
          part: null,
          rows: shown.filter((row) => !parts.some((part) => part.warehouseId === row.warehouseId)),
        },
      ].filter((section) => section.rows.length > 0)
    : [{ part: null, rows: shown }].filter((section) => section.rows.length > 0);

  const change = (next: EditLine[]) => setEdits(next);
  const update = (key: string, patch: Partial<EditLine>) =>
    change(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const save = () =>
    void action.run(async () => {
      await mutations.update.mutateAsync({
        id: order.id,
        body: orderRequestOf(order, {
          lines: lines.map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
        }),
      });
      setEdits(null);
      setAdding(false);
      toast.success(t('sales.panel.products.saved'));
    });

  return (
    <div className="flex flex-col gap-3">
      {backordered.length > 0 && order.status !== 'CANCELLED' ? (
        <p className="text-sm text-warning">
          {t('sales.order.backorderedLines', { count: backordered.length })}
        </p>
      ) : null}
      <FilterBar>
        <SearchField
          aria-label={t('sales.panel.products.search')}
          placeholder={t('sales.panel.products.search')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <NativeSelect
          variant="filter"
          active={warehouse !== null}
          aria-label={t('sales.order.warehouse')}
          value={warehouse ?? ''}
          onChange={(event) =>
            setWarehouse(event.target.value ? Number.parseInt(event.target.value, 10) : null)
          }
        >
          <option value="">{t('sales.panel.products.allWarehouses')}</option>
          {warehouses.map((id) => (
            <option key={id} value={id}>
              {warehouseName(id)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          active={picked !== 'ALL'}
          aria-label={t('sales.panel.products.pickedFilter')}
          value={picked}
          onChange={(event) =>
            setPicked(PICKED_FILTERS.find((value) => value === event.target.value) ?? 'ALL')
          }
        >
          {PICKED_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === 'SHORT'
                ? t('sales.panel.products.picked.SHORT', { count: shortLines.length })
                : t(`sales.panel.products.picked.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      {editable && (adding || lines.length === 0) ? (
        <ProductSearch
          // «Бараа нэмэх» (or an order without lines) puts the cursor here.
          autoFocus
          onPick={(product) => {
            // The search stays open for the next product.
            setAdding(true);
            change([
              ...lines,
              {
                key: randomUuid(),
                productId: product.id,
                sku: product.sku,
                name: product.name,
                unitId: product.baseUnit.id,
                unitName: product.baseUnit.uomName,
                qty: '1',
              },
            ]);
          }}
        />
      ) : null}
      {sections.map((section) => (
        <ListCard key={section.part?.warehouseId ?? 'rest'}>
          {section.part ? (
            <PartGroupHeader
              order={order}
              part={section.part}
              drafts={confirming.has(section.part.warehouseId) ? drafts : null}
              canPick={canPick}
            />
          ) : null}
          <ListTable columns={columns}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sales.order.product')}</TableHead>
                {grouped ? null : <TableHead>{t('sales.order.warehouse')}</TableHead>}
                <TableHead>{t('sales.order.unit')}</TableHead>
                <TableHead className={cn('text-right', GROUP_START)}>
                  {t('sales.panel.products.ordered')}
                </TableHead>
                {confirmed ? (
                  <TableHead className="text-right">{t('sales.order.reserved')}</TableHead>
                ) : null}
                {anyPicked ? (
                  <TableHead className="text-right">{t('sales.order.picked')}</TableHead>
                ) : null}
                {anyShort ? (
                  <TableHead className="text-right">{t('sales.pick.short')}</TableHead>
                ) : null}
                <TableHead className={cn('text-right', GROUP_START)}>
                  {t('sales.panel.products.amount')}
                </TableHead>
                {editable ? (
                  <TableHead>
                    <span className="sr-only">{t('sales.order.remove')}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map(({ line, stored, warehouseId, problem }) => {
                const price = priceOf(line);
                const badQty = !isQty(line.qty);
                const short = shortText(stored);
                const discount =
                  price?.discountAmount && new Decimal(price.discountAmount).gt(0)
                    ? price.discountAmount
                    : null;
                return (
                  <TableRow key={line.key} className={short ? 'bg-danger-soft/40' : undefined}>
                    <TableCell className="whitespace-normal">
                      <span className="mr-2 rounded-md bg-fill px-1.5 py-0.5 font-mono text-xs">
                        {line.sku}
                      </span>
                      {line.name}
                      {short ? (
                        <Badge variant="destructive" className="ml-2 align-middle">
                          {t('sales.pick.short')}
                        </Badge>
                      ) : null}
                      {problem ? <div className="text-xs text-destructive">{problem}</div> : null}
                    </TableCell>
                    {grouped ? null : (
                      <TableCell>
                        {warehouseId === null ? '' : warehouseName(warehouseId)}
                      </TableCell>
                    )}
                    <TableCell>
                      {editable ? (
                        <UnitSelect
                          productId={line.productId}
                          unitId={line.unitId}
                          name={line.name}
                          onChange={(unitId) => update(line.key, { unitId })}
                        />
                      ) : (
                        line.unitName
                      )}
                    </TableCell>
                    <TableCell className={cn('text-right', GROUP_START)}>
                      {editable ? (
                        <Input
                          aria-label={`${t('sales.order.qty')}: ${line.name}`}
                          aria-invalid={badQty || undefined}
                          inputMode="decimal"
                          className="ml-auto h-8 w-full px-2 text-right font-mono"
                          value={line.qty}
                          onChange={(event) => update(line.key, { qty: event.target.value.trim() })}
                        />
                      ) : (
                        <span className="font-mono font-semibold">{formatQty(line.qty)}</span>
                      )}
                      <OriginalQty
                        order={order}
                        stored={stored}
                        unitId={line.unitId}
                        qty={line.qty}
                      />
                    </TableCell>
                    {confirmed ? (
                      <TableCell className="text-right font-mono">
                        {stored ? (
                          <>
                            <div>
                              {t('sales.order.qtyIn', {
                                qty: formatQty(stored.qtyApproved),
                                unit: stored.baseUnitName,
                              })}
                            </div>
                            {new Decimal(stored.qtyBackordered).gt(0) ? (
                              <div className="text-xs text-warning">
                                {t('sales.panel.products.backorderedLine', {
                                  qty: formatQty(stored.qtyBackordered),
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </TableCell>
                    ) : null}
                    {anyPicked ? (
                      <TableCell className="text-right">
                        {stored && confirming.has(stored.warehouseId) ? (
                          <PickDraftCell line={stored} drafts={drafts} />
                        ) : stored === undefined || stored.qtyPicked === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <div
                              className={cn(
                                'font-mono font-semibold',
                                new Decimal(stored.qtyPicked).gte(stored.qtyBase)
                                  ? 'text-success'
                                  : 'text-warning',
                              )}
                            >
                              {t('sales.order.qtyIn', {
                                qty: formatQty(stored.qtyPicked),
                                unit: stored.baseUnitName,
                              })}
                            </div>
                            {stored.pickBinCode ? (
                              <div className="font-mono text-xs text-muted-foreground">
                                {stored.pickBinCode}
                              </div>
                            ) : null}
                          </>
                        )}
                      </TableCell>
                    ) : null}
                    {anyShort ? (
                      <TableCell className="text-right font-mono font-semibold text-destructive">
                        {short}
                      </TableCell>
                    ) : null}
                    <TableCell
                      className={cn('text-right font-mono whitespace-nowrap', GROUP_START)}
                    >
                      {price && !price.priced ? (
                        <span className="text-destructive">
                          {t('sales.panel.products.noPrice')}
                        </span>
                      ) : (
                        <>
                          <div className="font-semibold">
                            {price?.total ? formatTugrik(price.total) : ''}
                          </div>
                          {(price?.parts ?? []).map((part, index) => (
                            <div key={index} className="text-xs text-muted-foreground">
                              {t('sales.print.partLine', {
                                qty: formatQty(part.qty),
                                unit: part.uomName,
                                price: formatMnt(part.listPrice),
                              })}
                            </div>
                          ))}
                          {discount ? (
                            <div className="text-xs text-success">
                              {t('sales.panel.products.discountLine', {
                                amount: formatMnt(discount),
                              })}
                            </div>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    {editable ? (
                      <RowActions>
                        <RowAction
                          label={`${t('sales.order.remove')}: ${line.name}`}
                          icon={Trash2}
                          destructive
                          onClick={() => change(lines.filter((entry) => entry.key !== line.key))}
                        />
                      </RowActions>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        </ListCard>
      ))}
      {lines.length === 0 ? (
        <ListCard>
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {editable ? t('sales.panel.products.emptyEditable') : t('sales.panel.products.empty')}
          </p>
        </ListCard>
      ) : shown.length === 0 ? (
        <ListCard>
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('sales.panel.products.noMatch')}
          </p>
        </ListCard>
      ) : null}
      <ProblemAlert problem={action.problem} />
      {/* The footer sticks to the panel's foot, so «Хадгалах» stays in reach under long lists. */}
      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-popover/95 px-5 py-3 backdrop-blur-md">
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {t('sales.panel.products.summary', {
              count: lines.length,
              total: total === null ? '0' : formatMnt(total),
            })}
            {subtotal !== null && discountTotal !== null && new Decimal(discountTotal).gt(0) ? (
              <span className="ml-2 font-normal text-muted-foreground">
                {t('sales.panel.products.discountSummary', {
                  subtotal: formatMnt(subtotal),
                  discount: formatMnt(discountTotal),
                })}
              </span>
            ) : null}
          </p>
          {invalid ? (
            <p className="text-[0.8125rem] text-destructive">{t('sales.panel.products.badQty')}</p>
          ) : null}
          {shortLines.length > 0 ? (
            <p className="text-[0.8125rem] text-destructive">
              {t('sales.pick.shortSummary', { count: shortLines.length })}
            </p>
          ) : null}
          {grouped && !dirty ? (
            <p className="text-[0.8125rem] text-muted-foreground">{t('sales.pick.partsHint')}</p>
          ) : null}
          {!frozen && lines.length > 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('sales.panel.products.estimated')}
            </p>
          ) : null}
          {dirty && order.status === 'CONFIRMED' ? (
            <p className="text-[0.8125rem] text-warning">{t('sales.panel.products.repriceHint')}</p>
          ) : null}
          {dirty && picking ? (
            <p className="text-[0.8125rem] text-warning">{t('sales.panel.products.repickHint')}</p>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            {lines.length > 0 ? (
              <Button variant="outline" onClick={() => setAdding((open) => !open)}>
                <Plus />
                {adding ? t('sales.panel.products.hideAdd') : t('sales.panel.products.add')}
              </Button>
            ) : null}
            {dirty ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEdits(null);
                    action.clear();
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button disabled={invalid || blocked || mutations.update.isPending} onClick={save}>
                  {t('common.save')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The line's first ordered quantity under its quantity when it differs (ADR-0178), or that it was
 * added after the order was placed. A draft has no first quantity yet: it is still being written.
 */
function OriginalQty({
  order,
  stored,
  unitId,
  qty,
}: {
  order: SalesOrder;
  stored: SalesOrderLine | undefined;
  unitId: number;
  qty: string;
}) {
  const { t } = useTranslation();
  if (!stored || order.status === 'DRAFT') return null;
  if (stored.originalQty === null) {
    return (
      <div className="text-xs text-link" title={t('sales.lineEdit.addedLaterHint')}>
        {t('sales.lineEdit.tags.addedLater')}
      </div>
    );
  }
  const same =
    isQty(qty) && unitId === stored.productUnitId && new Decimal(qty).equals(stored.originalQty);
  if (same) return null;
  return (
    <div className="text-xs font-medium text-link">
      {t('sales.lineEdit.original', {
        qty: formatQty(stored.originalQty),
        unit: stored.unitName,
      })}
    </div>
  );
}
