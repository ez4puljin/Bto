import { Decimal } from '@tugeel/shared/money';
import { LINE_EDIT_STATUSES } from '@tugeel/shared/sales';
import { ArrowRight, Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
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
import { isQty, useWarehouseName } from '@/features/inventory/helpers';
import { ProductSearch } from '@/features/inventory/shared';
import { useLinesQuote } from '@/features/pricing/api';
import { UnitSelect } from '@/features/pricing/quote-table';
import { formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type SalesOrder, useProductOrderInfo, useSalesOrder, useSalesOrderMutations } from './api';
import { usePickerSelf } from './use-picker-self';

/**
 * The board's «Засвар» (ADR-0175), after the warehouse's erxes extension: the order's lines by
 * warehouse, a keeper changing their own — the quantity with −/+, a line taken off in red and put
 * back, a product added — the others' locked; filters, the total before and after, Ctrl+S.
 */
export function LineEditDialog({
  orderId,
  onClose,
}: {
  orderId: number | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={orderId !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {orderId !== null ? <LineEditBody key={orderId} orderId={orderId} onClose={onClose} /> : null}
    </Dialog>
  );
}

type Filter = 'ALL' | 'EXCLUDED' | 'MINE' | 'CHANGED';
const FILTERS: readonly Filter[] = ['ALL', 'EXCLUDED', 'MINE', 'CHANGED'];

interface AddedLine {
  key: string;
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  qty: string;
}

/** One row of the table: a stored line, a taken-off one or a product being added. */
interface Row {
  key: string;
  kind: 'line' | 'excluded' | 'added';
  id: number;
  warehouseId: number | null;
  name: string;
  sku: string;
  unitName: string;
  storedQty: string | null;
  /** The quantity first ordered (ADR-0178); null on a product added after the order. */
  originalQty: string | null;
  qty: string;
  /** Taken off when saved: a stored line marked, or a taken-off one not put back. */
  off: boolean;
  changed: boolean;
  storedTotal: string | null;
  locked: 'other' | 'done' | 'status' | null;
  excludedBy: string | null;
  added?: AddedLine;
}

function LineEditBody({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const query = useSalesOrder(orderId);
  const order = query.data;
  return (
    <DialogContent
      closeLabel={t('common.close')}
      size="2xl"
      className="flex max-h-[calc(100dvh-3rem)] flex-col"
      dirty={false}
    >
      {order ? (
        <Editor order={order} onClose={onClose} />
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>{t('sales.lineEdit.buttonTitle')}</DialogTitle>
            <DialogDescription>{t('common.loading')}</DialogDescription>
          </DialogHeader>
          <ProblemAlert problem={problemFromError(query.error)} onRetry={() => query.refetch()} />
        </>
      )}
    </DialogContent>
  );
}

function Editor({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const self = usePickerSelf();
  const manage = useHasPermission('sales.orders.manage');
  const boards = useHasPermission('sales.boards.manage');
  const office = manage || boards;
  const lead = office || self.lead;
  const { editLines } = useSalesOrderMutations();

  const [qty, setQty] = useState<Record<number, string>>({});
  const [off, setOff] = useState<Set<number>>(new Set());
  const [back, setBack] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<AddedLine[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [adding, setAdding] = useState(false);

  const editable = LINE_EDIT_STATUSES.includes(order.status);
  const writes = (warehouseId: number) => office || self.writes(warehouseId);
  const partDone = (warehouseId: number) =>
    order.picks.find((part) => part.warehouseId === warehouseId)?.status === 'DONE';
  const lockOf = (warehouseId: number): Row['locked'] => {
    if (!editable) return 'status';
    if (!writes(warehouseId)) return 'other';
    if (partDone(warehouseId) && !lead) return 'done';
    return null;
  };

  const info = useProductOrderInfo(added.map((line) => line.productId));
  const infoOf = (productId: number) => info.data?.find((row) => row.productId === productId);
  const addedOk = (line: AddedLine) => {
    const found = infoOf(line.productId);
    if (!found) return false;
    return found.sellable && found.homeWarehouseId !== null && writes(found.homeWarehouseId);
  };
  // Today's prices of the products added: the rest keep the order's.
  const addedRequest = useMemo(
    () =>
      added
        .filter((line) => isQty(line.qty))
        .map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
    [added],
  );
  const addedQuote = useLinesQuote(addedRequest, addedRequest.length > 0, order.pipelineId);

  const rows: Row[] = [
    ...order.lines.map((line): Row => {
      const typed = qty[line.id];
      const value = typed ?? line.qty;
      const lineOff = off.has(line.id);
      return {
        key: `l${line.id}`,
        kind: 'line',
        id: line.id,
        warehouseId: line.warehouseId,
        name: line.productName,
        sku: line.productSku,
        unitName: line.unitName,
        storedQty: line.qty,
        originalQty: line.originalQty,
        qty: value,
        off: lineOff,
        changed: lineOff || (typed !== undefined && !sameQty(typed, line.qty)),
        storedTotal: line.total,
        locked: lockOf(line.warehouseId),
        excludedBy: null,
      };
    }),
    ...order.excludedLines.map((line): Row => {
      const typed = back[line.id];
      return {
        key: `x${line.id}`,
        kind: 'excluded',
        id: line.id,
        warehouseId: line.warehouseId,
        name: line.productName,
        sku: line.productSku,
        unitName: line.unitName,
        storedQty: line.qty,
        originalQty: line.originalQty,
        qty: typed ?? line.qty,
        off: typed === undefined,
        changed: typed !== undefined,
        storedTotal: line.total,
        locked: lockOf(line.warehouseId),
        excludedBy: line.excludedByName,
      };
    }),
    ...added.map((line): Row => ({
      key: line.key,
      kind: 'added',
      id: 0,
      warehouseId: infoOf(line.productId)?.homeWarehouseId ?? null,
      name: line.name,
      sku: line.sku,
      unitName: '',
      storedQty: null,
      originalQty: null,
      qty: line.qty,
      off: false,
      changed: true,
      storedTotal: null,
      locked: null,
      excludedBy: null,
      added: line,
    })),
  ];

  const mine = (row: Row) => row.warehouseId !== null && writes(row.warehouseId);
  const counts: Record<Filter, number> = {
    ALL: rows.length,
    EXCLUDED: rows.filter((row) => row.off).length,
    MINE: rows.filter(mine).length,
    CHANGED: rows.filter((row) => row.changed).length,
  };
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (filter === 'EXCLUDED' && !row.off) return false;
    if (filter === 'MINE' && !mine(row)) return false;
    if (filter === 'CHANGED' && !row.changed) return false;
    if (needle && !`${row.name} ${row.sku}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Groups: my warehouses first, then the others, by name; the added products last.
  const byWarehouse = new Map<number, Row[]>();
  for (const row of shown) {
    if (row.kind === 'added' || row.warehouseId === null) continue;
    byWarehouse.set(row.warehouseId, [...(byWarehouse.get(row.warehouseId) ?? []), row]);
  }
  const groups = [...byWarehouse.entries()]
    .map(([warehouseId, list]) => ({ warehouseId, name: warehouseName(warehouseId), rows: list }))
    .sort(
      (a, b) =>
        Number(!writes(a.warehouseId)) - Number(!writes(b.warehouseId)) ||
        a.name.localeCompare(b.name, 'mn'),
    );
  const addedRows = shown.filter((row) => row.kind === 'added');

  // The total before and after: a changed line at its own unit price, added ones at today's.
  const quoted = addedQuote.data?.lines ?? [];
  const totalOf = (row: Row): Decimal | null => {
    if (row.off) return new Decimal(0);
    if (!isQty(row.qty)) return null;
    if (row.kind === 'added') {
      const index = addedRequest.findIndex(
        (entry) => entry.productUnitId === row.added?.unitId && entry.qty === row.qty,
      );
      const total = index < 0 ? null : quoted[index]?.total;
      return total ? new Decimal(total) : null;
    }
    if (row.storedTotal === null || row.storedQty === null) return null;
    const stored = new Decimal(row.storedTotal);
    if (sameQty(row.qty, row.storedQty)) return stored;
    return stored.times(row.qty).dividedBy(row.storedQty).toDecimalPlaces(0);
  };
  const before = new Decimal(order.total ?? 0);
  const after = rows.reduce<Decimal | null>((sum, row) => {
    if (sum === null) return null;
    const total = totalOf(row);
    return total === null ? null : sum.plus(total);
  }, new Decimal(0));

  const changes = rows.filter((row) => row.changed).length;
  const badQty = rows.some((row) => !row.off && !isQty(row.qty));
  const badAdded = added.some((line) => info.data !== undefined && !addedOk(line));
  const canSave = editable && changes > 0 && !badQty && !badAdded && !editLines.isPending;

  const save = async () => {
    if (!canSave) return;
    try {
      await editLines.mutateAsync({
        id: order.id,
        body: {
          expectedUpdatedAt: order.updatedAt,
          lines: order.lines
            .filter(
              (line) =>
                !off.has(line.id) &&
                qty[line.id] !== undefined &&
                !sameQty(qty[line.id] ?? '', line.qty),
            )
            .map((line) => ({ lineId: line.id, qty: qty[line.id] ?? line.qty })),
          exclude: [...off],
          restore: Object.entries(back).map(([id, value]) => {
            const stored = order.excludedLines.find((line) => line.id === Number.parseInt(id, 10));
            return {
              excludedId: Number.parseInt(id, 10),
              qty: stored && sameQty(value, stored.qty) ? null : value,
            };
          }),
          add: added.map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
        },
      });
      toast.success(t('sales.lineEdit.saved'));
      onClose();
    } catch {
      // Shown by the alert above the footer; ORDER_CHANGED reads the order again (api.ts).
    }
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const setRowQty = (row: Row, value: string) => {
    if (row.kind === 'line') setQty((all) => ({ ...all, [row.id]: value }));
    else if (row.kind === 'excluded') setBack((all) => ({ ...all, [row.id]: value }));
    else
      setAdded((all) => all.map((line) => (line.key === row.key ? { ...line, qty: value } : line)));
  };
  const step = (row: Row, by: number) => {
    const current = isQty(row.qty) ? new Decimal(row.qty) : new Decimal(0);
    const next = Decimal.max(current.plus(by), 1);
    setRowQty(row, next.toFixed());
  };
  const toggleOff = (row: Row) => {
    if (row.kind === 'line') {
      setOff((all) => {
        const next = new Set(all);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    } else if (row.kind === 'excluded') {
      setBack((all) => {
        if (row.id in all) {
          const { [row.id]: _gone, ...rest } = all;
          return rest;
        }
        return { ...all, [row.id]: row.storedQty ?? '1' };
      });
    } else {
      setAdded((all) => all.filter((line) => line.key !== row.key));
    }
  };
  const revert = (row: Row) => {
    if (row.kind === 'line') {
      setQty(({ [row.id]: _gone, ...rest }) => rest);
      setOff((all) => {
        const next = new Set(all);
        next.delete(row.id);
        return next;
      });
    } else if (row.kind === 'excluded') {
      setBack(({ [row.id]: _gone, ...rest }) => rest);
    } else {
      setAdded((all) => all.filter((line) => line.key !== row.key));
    }
  };

  const myNames = [...new Set(order.lines.map((line) => line.warehouseId))]
    .filter((id) => !office && self.writes(id))
    .map(warehouseName);
  const title = t('sales.lineEdit.title', { number: order.number ?? `#${order.id}` });
  const excludedCount = order.excludedLines.length;
  const problem = problemFromError(editLines.error);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {t('sales.lineEdit.description', {
            customer: order.customerName,
            stage: order.stageName ?? '',
            count: order.lines.length,
          })}
          {excludedCount > 0 ? (
            <span className="font-medium text-destructive">
              {` · ${t('sales.lineEdit.descriptionExcluded', { count: excludedCount })}`}
            </span>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!editable ? (
          <p className="w-full rounded-md bg-warning-soft px-3 py-2 text-foreground">
            {t('sales.lineEdit.notEditable')}
          </p>
        ) : office ? (
          <span className="text-muted-foreground">
            {t('sales.lineEdit.mine', { names: t('sales.lineEdit.allWarehouses') })}
          </span>
        ) : myNames.length > 0 ? (
          <span className="text-muted-foreground">
            {t('sales.lineEdit.mine', { names: myNames.join(', ') })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('sales.lineEdit.noWarehouse')}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-64"
          value={search}
          placeholder={t('sales.lineEdit.search')}
          aria-label={t('sales.lineEdit.search')}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Esc clears the search first; the next one closes the dialog.
            if (event.key === 'Escape' && search) {
              event.stopPropagation();
              setSearch('');
            }
          }}
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('sales.lineEdit.search')}>
          {FILTERS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`sales.lineEdit.filters.${value}`)}
              <span
                className={cn(
                  'ml-1 rounded-full px-1.5 text-xs',
                  value === 'EXCLUDED' && counts.EXCLUDED > 0
                    ? 'bg-danger-soft font-semibold text-destructive'
                    : 'bg-fill text-muted-foreground',
                )}
              >
                {counts[value]}
              </span>
            </Button>
          ))}
        </div>
        {editable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus />
            {t('sales.lineEdit.addProduct')}
          </Button>
        ) : null}
      </div>
      {editable && adding ? (
        <ProductSearch
          autoFocus
          saleReady
          onPick={(product) =>
            setAdded((all) => [
              ...all,
              {
                key: randomUuid(),
                productId: product.id,
                sku: product.sku,
                name: product.name,
                unitId: product.baseUnit.id,
                qty: '1',
              },
            ])
          }
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">{t('sales.lineEdit.product')}</th>
              <th className="px-3 py-2 text-center font-medium">{t('sales.lineEdit.qty')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('sales.lineEdit.amount')}</th>
              <th className="w-px px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupOff = group.rows.filter((row) => row.off).length;
              const lock = lockOf(group.warehouseId);
              return (
                <Fragment key={group.warehouseId}>
                  <tr className="border-b border-border bg-fill/60">
                    <td colSpan={4} className="px-3 py-1.5 text-xs">
                      <span className="font-semibold text-foreground">{group.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {t('sales.lineEdit.groupSummary', {
                          count: group.rows.length,
                          excluded: groupOff,
                        })}
                      </span>
                      {lock === 'other' || lock === 'done' ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                          <Lock className="size-3" aria-hidden />
                          {lock === 'done'
                            ? t('sales.lineEdit.lockedDone')
                            : t('sales.lineEdit.readOnly')}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <LineRow
                      key={row.key}
                      row={row}
                      total={totalOf(row)}
                      onQty={(value) => setRowQty(row, value)}
                      onStep={(by) => step(row, by)}
                      onToggle={() => toggleOff(row)}
                      onRevert={() => revert(row)}
                    />
                  ))}
                </Fragment>
              );
            })}
            {addedRows.length > 0 ? (
              <tr className="border-b border-border bg-success-soft">
                <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-success">
                  {t('sales.lineEdit.added')}
                </td>
              </tr>
            ) : null}
            {addedRows.map((row) => {
              const line = row.added;
              const found = line ? infoOf(line.productId) : undefined;
              const warning =
                found === undefined
                  ? null
                  : !found.sellable
                    ? t('sales.lineEdit.notSellable')
                    : found.homeWarehouseId === null || !writes(found.homeWarehouseId)
                      ? t('sales.lineEdit.otherHome', {
                          warehouse:
                            found.homeWarehouseId === null
                              ? ''
                              : warehouseName(found.homeWarehouseId),
                        })
                      : null;
              return (
                <LineRow
                  key={row.key}
                  row={row}
                  total={totalOf(row)}
                  warning={warning}
                  unit={
                    line ? (
                      <UnitSelect
                        productId={line.productId}
                        unitId={line.unitId}
                        name={line.name}
                        onChange={(unitId) =>
                          setAdded((all) =>
                            all.map((entry) =>
                              entry.key === line.key ? { ...entry, unitId } : entry,
                            ),
                          )
                        }
                      />
                    ) : null
                  }
                  onQty={(value) => setRowQty(row, value)}
                  onStep={(by) => step(row, by)}
                  onToggle={() => toggleOff(row)}
                  onRevert={() => revert(row)}
                />
              );
            })}
            {groups.length === 0 && addedRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  {t('sales.lineEdit.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ProblemAlert problem={problem} />
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={cn(changes > 0 ? 'font-medium text-warning' : 'text-muted-foreground')}>
            {changes > 0
              ? t('sales.lineEdit.changes', { count: changes })
              : t('sales.lineEdit.noChanges')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('sales.lineEdit.total')}</span>
            <span className="font-mono">{formatTugrik(before.toFixed(0))}</span>
            {changes > 0 ? (
              <>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono font-semibold" title={t('sales.lineEdit.estimated')}>
                  {after === null ? '—' : `≈ ${formatTugrik(after.toFixed(0))}`}
                </span>
              </>
            ) : null}
          </span>
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {t('sales.lineEdit.shortcut')}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function LineRow({
  row,
  total,
  warning = null,
  unit = null,
  onQty,
  onStep,
  onToggle,
  onRevert,
}: {
  row: Row;
  total: Decimal | null;
  warning?: string | null;
  unit?: ReactNode;
  onQty: (value: string) => void;
  onStep: (by: number) => void;
  onToggle: () => void;
  onRevert: () => void;
}) {
  const { t } = useTranslation();
  const locked = row.locked !== null;
  const invalid = !row.off && !isQty(row.qty);
  const lockText =
    row.locked === 'other'
      ? t('sales.lineEdit.lockedOther')
      : row.locked === 'done'
        ? t('sales.lineEdit.lockedDone')
        : row.locked === 'status'
          ? t('sales.lineEdit.notEditable')
          : '';
  return (
    <tr
      className={cn(
        'border-b border-border/60 align-middle',
        row.off && 'bg-danger-soft',
        !row.off && row.changed && 'bg-warning-soft shadow-[inset_3px_0_0_var(--color-warning)]',
        locked && 'text-muted-foreground',
      )}
    >
      <td className="px-3 py-1.5">
        <div className={cn('font-medium', row.off && 'text-destructive line-through')}>
          {row.name}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{row.sku}</span>
          {row.off ? (
            <span className="rounded bg-danger-soft px-1 text-destructive">
              {t('sales.lineEdit.tags.excluded')}
            </span>
          ) : null}
          {row.kind === 'added' ? (
            <span className="rounded bg-success-soft px-1 text-success">
              {t('sales.lineEdit.tags.added')}
            </span>
          ) : row.changed && !row.off ? (
            <span className="rounded bg-warning-soft px-1 text-warning">
              {t('sales.lineEdit.tags.changed')}
            </span>
          ) : null}
          {row.kind !== 'added' && row.originalQty === null ? (
            <span
              className="rounded bg-info-soft px-1 text-link"
              title={t('sales.lineEdit.addedLaterHint')}
            >
              {t('sales.lineEdit.tags.addedLater')}
            </span>
          ) : null}
          {row.excludedBy && row.off ? (
            <span>{t('sales.lineEdit.excludedBy', { name: row.excludedBy })}</span>
          ) : null}
        </div>
        {warning ? <div className="mt-0.5 text-xs text-destructive">{warning}</div> : null}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`${t('sales.lineEdit.less')}: ${row.name}`}
            disabled={locked || row.off}
            onClick={() => onStep(-1)}
          >
            <Minus />
          </Button>
          <Input
            className={cn(
              'h-8 w-20 text-center font-mono',
              invalid && 'border-destructive text-destructive',
            )}
            inputMode="decimal"
            aria-label={`${t('sales.lineEdit.qty')}: ${row.name}`}
            aria-invalid={invalid}
            title={invalid ? t('sales.lineEdit.badQty') : undefined}
            value={row.qty}
            disabled={locked || row.off}
            onChange={(event) => onQty(event.target.value.replace(',', '.').trim())}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                onStep(1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                onStep(-1);
              }
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`${t('sales.lineEdit.more')}: ${row.name}`}
            disabled={locked || row.off}
            onClick={() => onStep(1)}
          >
            <Plus />
          </Button>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-xs text-muted-foreground">
          {unit ?? <span>{row.unitName}</span>}
          {row.storedQty !== null &&
          row.changed &&
          !row.off &&
          !sameQty(row.qty, row.storedQty) &&
          (row.originalQty === null || !sameQty(row.storedQty, row.originalQty)) ? (
            <span className="text-warning">
              {t('sales.lineEdit.was', { qty: formatQty(row.storedQty) })}
            </span>
          ) : null}
        </div>
        {row.originalQty !== null && (row.off || !sameQty(row.qty, row.originalQty)) ? (
          <div className="text-center text-xs font-medium text-link">
            {t('sales.lineEdit.original', {
              qty: formatQty(row.originalQty),
              unit: row.unitName,
            })}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        {row.off ? (
          <span className="text-destructive line-through">
            {row.storedTotal ? formatTugrik(row.storedTotal) : '—'}
          </span>
        ) : total === null ? (
          '—'
        ) : (
          formatTugrik(total.toFixed(0))
        )}
      </td>
      <td className="px-3 py-1.5">
        {locked ? (
          <span className="inline-flex items-center gap-1 text-xs" title={lockText}>
            <Lock className="size-3.5" aria-hidden />
            <span className="sr-only">{lockText}</span>
          </span>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                'whitespace-nowrap',
                row.off
                  ? 'border-success text-success hover:bg-success-soft'
                  : 'border-destructive text-destructive hover:bg-danger-soft',
              )}
              onClick={onToggle}
            >
              {row.kind === 'added'
                ? t('sales.lineEdit.removeNew')
                : row.off
                  ? t('sales.lineEdit.restore')
                  : t('sales.lineEdit.exclude')}
            </Button>
            {row.changed && row.kind !== 'added' ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${t('sales.lineEdit.revert')}: ${row.name}`}
                title={t('sales.lineEdit.revert')}
                onClick={onRevert}
              >
                <RotateCcw />
              </Button>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Two typed quantities that mean the same number («3» and «3.000»). */
function sameQty(a: string, b: string): boolean {
  try {
    return new Decimal(a).equals(b);
  } catch {
    return false;
  }
}
