import { Decimal } from '@tugeel/shared/money';
import { Boxes, Truck as TruckIcon, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, FilterToggle, LoadMore, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import { formatCount, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import {
  type LoadLine,
  type PurchaseOrderDetail,
  type PurchaseOrderLoad,
  type PurchaseOrderSupplier,
  useLoadLines,
  usePurchaseOrderMutations,
  useTrucks,
} from './api';
import { TruckDialog } from './trucks-page';

/** What rides on a load, summed per supplier from its items. */
interface LoadRider {
  supplier: PurchaseOrderSupplier;
  boxes: Decimal;
  /** Not every ordered box of the supplier is on this load. */
  partial: boolean;
}

function ridersOf(
  load: PurchaseOrderLoad,
  suppliers: ReadonlyMap<number, PurchaseOrderSupplier>,
): LoadRider[] {
  const sums = new Map<number, Decimal>();
  for (const item of load.items) {
    sums.set(item.supplierId, (sums.get(item.supplierId) ?? new Decimal(0)).plus(item.qty));
  }
  return [...sums.entries()].flatMap(([supplierId, boxes]) => {
    const supplier = suppliers.get(supplierId);
    if (!supplier) return [];
    return [{ supplier, boxes, partial: boxes.lt(supplier.boxes) }];
  });
}

/**
 * The trucks named on the order and what rides on each (ADR-0121, by line since ADR-0122):
 * «Машин нэмэх» makes a load from an active truck (or a new one); the unassigned suppliers below
 * go on a load whole from their row, or line by line through «Бараагаар хуваарилах»; a load's row
 * takes a supplier off; a load can be taken off the order (what rode on it freed).
 */
export function LoadsPanel({
  detail,
  canManage,
}: {
  detail: PurchaseOrderDetail;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const mutations = usePurchaseOrderMutations();
  const trucks = useTrucks(canManage);
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [linesOf, setLinesOf] = useState<PurchaseOrderLoad | null>(null);
  const onOrder = new Set(detail.loads.map((load) => load.truckId));
  const candidates = (trucks.data ?? []).filter((truck) => !onOrder.has(truck.id));
  const bySupplier = new Map(detail.suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const zero = new Decimal(0);
  const unassigned = detail.suppliers
    .filter((supplier) => supplier.lineCount > 0)
    .map((supplier) => ({
      supplier,
      remaining: new Decimal(supplier.boxes).minus(supplier.loadedBoxes),
    }))
    .filter((entry) => entry.remaining.gt(0));
  const remainingBoxes = unassigned.reduce((sum, entry) => sum.plus(entry.remaining), zero);
  const busy =
    mutations.addLoad.isPending ||
    mutations.removeLoad.isPending ||
    mutations.assignLoad.isPending ||
    mutations.setLoadLines.isPending;

  const addTruck = (truckId: number, name: string) =>
    void action.run(async () => {
      await mutations.addLoad.mutateAsync({ key: randomUuid(), id: detail.id, truckId });
      toast.success(t('procurement.overview.loadAdded', { name }));
    });
  const removeLoad = (load: PurchaseOrderLoad) =>
    void action.run(async () => {
      await mutations.removeLoad.mutateAsync({ id: detail.id, loadId: load.id });
      toast.success(t('procurement.overview.loadRemoved', { name: load.truckName }));
    });
  const assign = (supplierId: number, loadId: number | null) =>
    void action.run(async () => {
      await mutations.assignLoad.mutateAsync({ id: detail.id, supplierId, loadId });
    });
  const takeOff = (load: PurchaseOrderLoad, supplierId: number) =>
    void action.run(async () => {
      await mutations.setLoadLines.mutateAsync({
        id: detail.id,
        loadId: load.id,
        lines: load.items
          .filter((item) => item.supplierId === supplierId)
          .map((item) => ({ supplierId, productId: item.productId, qty: '0' })),
      });
    });

  return (
    <aside className="flex w-full flex-col gap-3 xl:w-[26rem] xl:shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <TruckIcon aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-[0.9375rem] font-semibold">{t('procurement.overview.loads')}</h2>
        <span className="font-mono text-[0.8125rem] text-muted-foreground">
          {formatCount(detail.loads.length)}
        </span>
        {canManage ? (
          <NativeSelect
            variant="filter"
            className="ml-auto"
            aria-label={t('procurement.overview.addTruck')}
            value=""
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'new') setCreating(true);
              else if (value !== '') {
                const truck = candidates.find((candidate) => String(candidate.id) === value);
                if (truck) addTruck(truck.id, truck.name);
              }
            }}
          >
            <option value="">{t('procurement.overview.addTruck')}</option>
            {candidates.map((truck) => (
              <option key={truck.id} value={truck.id}>
                {truck.plate ? `${truck.name} (${truck.plate})` : truck.name}
              </option>
            ))}
            <option value="new">{t('procurement.overview.newTruck')}</option>
          </NativeSelect>
        ) : null}
      </div>
      <ProblemAlert problem={action.problem} />
      {detail.loads.length === 0 ? (
        <section className="rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
          <EmptyState
            icon={TruckIcon}
            title={t(
              canManage ? 'procurement.overview.noLoadsHint' : 'procurement.overview.noLoads',
            )}
          />
        </section>
      ) : (
        detail.loads.map((load) => (
          <LoadCard
            key={load.id}
            load={load}
            riders={ridersOf(load, bySupplier)}
            canManage={canManage}
            busy={busy}
            onRemove={() => removeLoad(load)}
            onTakeOff={(supplierId) => takeOff(load, supplierId)}
            onLines={() => setLinesOf(load)}
          />
        ))
      )}
      <section
        aria-label={t('procurement.overview.unassigned')}
        className="rounded-xl border border-dashed border-warning/60 bg-warning-soft/40 p-3"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[0.875rem] font-semibold">{t('procurement.overview.unassigned')}</h3>
          <span className="ml-auto text-[0.8125rem] text-muted-foreground">
            {t('procurement.overview.unassignedSummary', {
              suppliers: formatCount(unassigned.length),
              boxes: formatQty(remainingBoxes.toFixed()),
            })}
          </span>
        </div>
        {unassigned.length === 0 ? (
          <p className="pt-2 text-[0.8125rem] text-muted-foreground">
            {t('procurement.overview.allAssigned')}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {unassigned.map(({ supplier, remaining }) => (
              <li
                key={supplier.supplierId}
                className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-[0.8125rem]"
              >
                <span className="min-w-0 flex-1 truncate">{supplier.supplierName}</span>
                <span className="font-mono text-muted-foreground">
                  {remaining.lt(supplier.boxes)
                    ? t('procurement.overview.remainingOf', {
                        remaining: formatQty(remaining.toFixed()),
                        boxes: formatQty(supplier.boxes),
                      })
                    : formatQty(supplier.boxes)}
                </span>
                {canManage && detail.loads.length > 0 ? (
                  <NativeSelect
                    variant="filter"
                    aria-label={t('procurement.overview.assignTo', { name: supplier.supplierName })}
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value !== '') assign(supplier.supplierId, Number.parseInt(value, 10));
                    }}
                  >
                    <option value="">{t('procurement.overview.noTruck')}</option>
                    {detail.loads.map((load) => (
                      <option key={load.id} value={load.id}>
                        {load.truckName}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage && detail.loads.length > 0 ? (
          <div className="mt-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setLinesOf(detail.loads[0] ?? null)}
            >
              <Boxes aria-hidden />
              {t('procurement.overview.loadLines')}
            </Button>
          </div>
        ) : null}
      </section>
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? (
          <TruckDialog
            truck={null}
            onClose={() => setCreating(false)}
            onCreated={(truck) => {
              setCreating(false);
              addTruck(truck.id, truck.name);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={linesOf !== null} onOpenChange={(open) => !open && setLinesOf(null)}>
        {linesOf ? (
          <LoadLinesDialog detail={detail} initialLoad={linesOf} onClose={() => setLinesOf(null)} />
        ) : null}
      </Dialog>
    </aside>
  );
}

function LoadCard(props: {
  load: PurchaseOrderLoad;
  riders: LoadRider[];
  canManage: boolean;
  busy: boolean;
  onRemove: () => void;
  onTakeOff: (supplierId: number) => void;
  onLines: () => void;
}) {
  const { t } = useTranslation();
  const { load } = props;
  const zero = new Decimal(0);
  const boxes = props.riders.reduce((sum, rider) => sum.plus(rider.boxes), zero);
  // The kg of a part of a supplier: its weight in the share of its boxes on this load.
  const kg = props.riders.reduce((sum, rider) => {
    const all = new Decimal(rider.supplier.boxes);
    if (all.isZero()) return sum;
    return sum.plus(new Decimal(rider.supplier.weightKg).times(rider.boxes).div(all));
  }, zero);
  const capacity = load.capacityKg ? new Decimal(load.capacityKg) : null;
  const fill =
    capacity && !capacity.isZero()
      ? Decimal.min(kg.div(capacity).times(100).floor(), 100).toFixed()
      : null;
  return (
    <section
      aria-label={load.truckName}
      className="rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[0.875rem] font-semibold">{load.truckName}</span>
        {load.plate ? (
          <span className="font-mono text-[0.8125rem] text-muted-foreground">{load.plate}</span>
        ) : null}
        {!load.truckActive ? (
          <Badge variant="secondary">{t('procurement.trucks.inactive')}</Badge>
        ) : null}
        <span className="text-[0.8125rem] text-muted-foreground">
          {t('procurement.overview.loadSummary', {
            suppliers: formatCount(props.riders.length),
            boxes: formatQty(boxes.toFixed()),
            kg: formatQty(kg.toDecimalPlaces(1).toString()),
          })}
        </span>
        {props.canManage ? (
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-link"
              disabled={props.busy}
              onClick={props.onLines}
            >
              {t('procurement.overview.loadLines')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={t('procurement.overview.removeLoad', { name: load.truckName })}
              disabled={props.busy}
              onClick={props.onRemove}
            >
              <X aria-hidden />
            </Button>
          </span>
        ) : null}
      </div>
      {capacity ? (
        <div className="mt-2 flex items-center gap-2" aria-label={t('procurement.overview.fill')}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
            <span className="block h-full bg-primary" style={{ width: `${fill ?? '0'}%` }} />
          </span>
          <span className="font-mono text-[0.75rem] text-muted-foreground">
            {fill}% · {t('procurement.overview.capacity', { kg: formatQty(capacity.toFixed()) })}
          </span>
        </div>
      ) : null}
      {props.riders.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {props.riders.map((rider) => (
            <li
              key={rider.supplier.supplierId}
              className="flex items-center gap-2 rounded-md bg-fill/60 px-2 py-1 text-[0.8125rem]"
            >
              <span className="min-w-0 flex-1 truncate">{rider.supplier.supplierName}</span>
              {rider.partial ? (
                <Badge variant="warning">{t('procurement.overview.partial')}</Badge>
              ) : null}
              <span className="font-mono text-muted-foreground">
                {formatQty(rider.boxes.toFixed())}
              </span>
              {props.canManage ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t('procurement.overview.takeOff', {
                    name: rider.supplier.supplierName,
                  })}
                  disabled={props.busy}
                  onClick={() => props.onTakeOff(rider.supplier.supplierId)}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The quantities typed in the dialog, per line, as text. */
type Typed = Map<number, string>;

/**
 * «Бараагаар хуваарилах» (ADR-0122): the order's lines with what each truck carries of them; the
 * manager picks the load, narrows to a supplier, the unassigned or a search, types what this load
 * takes of each line (0 takes it off) and saves. A line's quantity on this load plus what rides
 * elsewhere never exceeds the ordered quantity: the input is capped at what is left.
 */
export function LoadLinesDialog(props: {
  detail: PurchaseOrderDetail;
  initialLoad: PurchaseOrderLoad;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { detail } = props;
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [loadId, setLoadId] = useState(props.initialLoad.id);
  const [supplierId, setSupplierId] = useState<number | undefined>(undefined);
  const [unassigned, setUnassigned] = useState(true);
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState<Typed>(new Map());
  const lines = useLoadLines(detail.id, { q, supplierId, unassigned });
  const data = useMemo(() => lines.data?.pages.flatMap((page) => page.data) ?? [], [lines.data]);
  const load = detail.loads.find((candidate) => candidate.id === loadId) ?? props.initialLoad;
  // A change of load or filter starts the typing afresh: what is typed belongs to one load.
  useEffect(() => setTyped(new Map()), [loadId, supplierId, unassigned, q]);

  const onThis = (line: LoadLine) =>
    line.loads.find((entry) => entry.loadId === loadId)?.qty ?? '0';
  const elsewhere = (line: LoadLine) =>
    line.loads
      .filter((entry) => entry.loadId !== loadId)
      .reduce((sum, entry) => sum.plus(entry.qty), new Decimal(0));
  const cap = (line: LoadLine) => new Decimal(line.qty).minus(elsewhere(line));
  const valueOf = (line: LoadLine) => typed.get(line.lineId) ?? onThis(line);
  const parse = (text: string): Decimal | null => {
    const clean = text.replace(/\s/g, '').replace(',', '.');
    return /^\d{1,11}(\.\d{1,3})?$/.test(clean) ? new Decimal(clean) : null;
  };
  const changes = data.flatMap((line) => {
    const text = typed.get(line.lineId);
    if (text === undefined) return [];
    const qty = parse(text.trim() === '' ? '0' : text);
    if (qty === null || qty.equals(onThis(line))) return [];
    return [{ supplierId: line.supplierId, productId: line.productId, qty: qty.toFixed() }];
  });
  const invalid = data.some((line) => {
    const text = typed.get(line.lineId);
    if (text === undefined) return false;
    const qty = parse(text.trim() === '' ? '0' : text);
    return qty === null || qty.gt(cap(line));
  });
  const fillAll = () => {
    const next = new Map(typed);
    for (const line of data) next.set(line.lineId, cap(line).toFixed());
    setTyped(next);
  };
  const save = () =>
    void action.run(async () => {
      await mutations.setLoadLines.mutateAsync({ id: detail.id, loadId, lines: changes });
      toast.success(t('procurement.overview.loadSaved', { truck: load.truckName }));
      setTyped(new Map());
      await lines.refetch();
    });

  return (
    <DialogContent size="xl" closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>
          {t('procurement.overview.loadLinesTitle', { truck: load.truckName })}
        </DialogTitle>
      </DialogHeader>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('procurement.overview.loadLinesHint')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={t('procurement.overview.loads')}
          value={String(loadId)}
          onChange={(event) => setLoadId(Number.parseInt(event.target.value, 10))}
        >
          {detail.loads.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.truckName}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('procurement.history.supplier')}
          value={supplierId === undefined ? '' : String(supplierId)}
          onChange={(event) =>
            setSupplierId(
              event.target.value === '' ? undefined : Number.parseInt(event.target.value, 10),
            )
          }
        >
          <option value="">{t('procurement.overview.allSuppliers')}</option>
          {detail.suppliers
            .filter((supplier) => supplier.lineCount > 0)
            .map((supplier) => (
              <option key={supplier.supplierId} value={supplier.supplierId}>
                {supplier.supplierName}
              </option>
            ))}
        </NativeSelect>
        <FilterToggle
          label={t('procurement.overview.unassignedOnly')}
          checked={unassigned}
          onCheckedChange={setUnassigned}
        />
        <SearchField
          className="min-w-[14rem] flex-1"
          placeholder={t('procurement.overview.searchLines')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <Button variant="outline" size="sm" onClick={fillAll} disabled={data.length === 0}>
          {t('procurement.overview.fillRemaining')}
        </Button>
      </div>
      <ProblemAlert problem={action.problem ?? problemFromError(lines.error)} />
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-border/80">
        {lines.isPending ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : data.length === 0 ? (
          <EmptyState title={t('procurement.overview.noLines')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('procurement.overview.columnSupplier')}</TableHead>
                <TableHead>{t('procurement.detail.columns.sku')}</TableHead>
                <TableHead>{t('procurement.detail.columns.name')}</TableHead>
                <TableHead className="text-right">{t('procurement.overview.ordered')}</TableHead>
                <TableHead className="text-right">
                  {t('procurement.overview.columnElsewhere')}
                </TableHead>
                <TableHead className="text-right">
                  {t('procurement.overview.columnRemaining')}
                </TableHead>
                <TableHead className="w-[7rem] text-right">
                  {t('procurement.overview.columnOnThis')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((line) => {
                const other = elsewhere(line);
                const limit = cap(line);
                const value = valueOf(line);
                const qty = parse(value.trim() === '' ? '0' : value);
                const over = qty === null || qty.gt(limit);
                const remaining = qty === null ? limit : Decimal.max(limit.minus(qty), 0);
                return (
                  <TableRow key={line.lineId}>
                    <TableCell className="max-w-[12rem] truncate">{line.supplierName}</TableCell>
                    <TableCell className="font-mono">{line.sku}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{line.productName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(line.qty)} {line.unitName}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {other.isZero() ? '' : formatQty(other.toFixed())}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        remaining.isZero() ? 'text-success' : 'text-warning',
                      )}
                    >
                      {formatQty(remaining.toFixed())}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        inputMode="decimal"
                        className={cn(
                          'h-8 w-24 text-right font-mono',
                          over && 'border-destructive',
                        )}
                        aria-label={t('procurement.overview.onThisNamed', {
                          name: line.productName,
                        })}
                        aria-invalid={over}
                        value={value}
                        onChange={(event) =>
                          setTyped((current) =>
                            new Map(current).set(line.lineId, event.target.value),
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <LoadMore query={lines} />
      </div>
      <DialogFooter>
        <span className="mr-auto text-[0.8125rem] text-muted-foreground">
          {t('procurement.overview.changedLines', { count: changes.length })}
        </span>
        <Button variant="outline" onClick={props.onClose}>
          {t('common.close')}
        </Button>
        <Button
          onClick={save}
          disabled={changes.length === 0 || invalid}
          pending={mutations.setLoadLines.isPending}
        >
          {t('procurement.overview.saveLoad')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
