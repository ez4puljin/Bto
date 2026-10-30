import { useQueryClient } from '@tanstack/react-query';
import { type components } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { poStatusRank, requiredGroupsFor } from '@tugeel/shared/procurement';
import { ChevronsDownUp, ChevronsUpDown, ClipboardList, TriangleAlert, X } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import { Combobox } from '@/components/combobox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  SearchField,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/features/catalog/api';
import { useWarehouses } from '@/features/identity/api';
import { KEYS as INVENTORY_KEYS, useInventoryMutations } from '@/features/inventory/api';
import { parseScanQty } from '@/features/inventory/helpers';
import { formatCount, formatQty } from '@/lib/money';
import { ApiProblem, problemFromError, unwrap } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { randomUuid } from '@/lib/uuid';
import {
  type GridFilter,
  type GridQuery,
  type PoStatus,
  type PurchaseOrderDetail,
  type PurchaseOrderSupplier,
  type PurchaseOrderVersion,
  useOrderFacets,
  usePurchaseOrder,
  usePurchaseOrderMutations,
  usePurchaseOrderVersion,
} from './api';
import {
  type CellEdit,
  COLUMNS_LIST,
  editKey,
  GROUP_KEYS,
  isDirty,
  isValid,
  toArrivalChange,
  toGridChange,
  useCanTypeOnOrder,
} from './order-edits';
import { OrderHeader } from './order-header';
import { type ColumnView, orderColumns } from './order-columns';
import { OrderTableHead, SupplierGroup } from './order-table';

type ReceiptCosting = components['schemas']['ReceiptCosting'];

const idOf = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const PO_STATUS_ORDER: readonly PoStatus[] = [
  'PREPARING',
  'SENT',
  'SHIPPING',
  'IN_TRANSIT',
  'ARRIVED',
  'ACCOUNTING',
  'RECEIVED',
];
const stepFrom = (status: PoStatus, by: 1 | -1): PoStatus | undefined =>
  PO_STATUS_ORDER[PO_STATUS_ORDER.indexOf(status) + by];

interface SaveReport {
  conflicts: { key: string; text: string }[];
  refused: { key: string; text: string }[];
}

const sameVersion = (a: PurchaseOrderVersion, b: PurchaseOrderVersion) =>
  a.updatedAt === b.updatedAt && a.receiptsUpdatedAt === b.receiptsUpdatedAt;

/**
 * Up to this many suppliers every group opens with the page (ADR-0118's one table); past it the
 * groups start closed and load when opened, so an order of every supplier stays usable.
 */
const OPEN_ALL_UP_TO = 5;

/**
 * One order as in Butenorgil (`/procurement/orders/:id`, ADR-0118): every supplier's products in one
 * table, grouped by supplier, with the columns of every stage side by side — stock and the sales
 * averages, the ordered quantity, the shipped one, the counted boxes × pieces with a note on a
 * difference, the accountant's prices against the previous ones — each typed where the stage and
 * the role allow. One «Хадгалах (n)» sends every changed cell: one request per supplier and kind,
 * the ordered and shipped quantities and the counts each against the value the page opened with,
 * the prices through the receipt's price check. A poll every 30 s shows a yellow bar when another
 * user changed the order; the rows never refresh under a typing hand.
 */
export function PurchaseOrderDetailPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id) ?? 0;
  const order = usePurchaseOrder(id);
  const loadProblem = problemFromError(order.error);

  if (loadProblem || !order.data) {
    return (
      <div>
        <PageHeader title={t('procurement.orders.title')} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} onRetry={order.refetch} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return <OrderDetail detail={order.data} />;
}

function OrderDetail({ detail }: { detail: PurchaseOrderDetail }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const canPrices = useHasPermission('procurement.prices.read');
  const canCosts = useHasPermission('inventory.costs.manage');
  const canType = useCanTypeOnOrder();
  const mutations = usePurchaseOrderMutations();
  const inventory = useInventoryMutations();
  const warehouses = useWarehouses();
  const saveAction = useAction();
  const moveAction = useAction();
  const confirmAction = useAction();

  // Filters live in the URL: the supplier and warehouse, the search, the two toggles.
  const supplierParam = idOf(params.get('supplier'));
  const warehouseId = idOf(params.get('warehouse'));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const filterParam = params.get('filter');
  const defaultFilter: GridFilter =
    poStatusRank(detail.status) >= poStatusRank('ARRIVED') ? 'ORDERED' : 'ALL';
  const filter: GridFilter =
    filterParam === 'ORDERED' || filterParam === 'BELOW_MIN' || filterParam === 'ALL'
      ? filterParam
      : defaultFilter;
  const query: GridQuery = { q, filter, warehouseId };
  const ordererParam = idOf(params.get('orderer'));
  const chosen =
    supplierParam === undefined
      ? undefined
      : detail.suppliers.find((supplier) => supplier.supplierId === supplierParam);
  // The suppliers the filters keep (owner 2026-10-30): the orderer's; with a warehouse, a search or
  // a filter, those with a row under it — the server counts the rows per supplier and the bar shows
  // the counts; «Зөвхөн захиалсан» hides the suppliers with nothing ordered at once.
  const facets = useOrderFacets(detail.id, query);
  const countOf = new Map(
    facets.data?.suppliers.map((row) => [row.supplierId, row.rowCount] as const),
  );
  const narrowing = q !== '' || warehouseId !== undefined || filter !== 'ALL';
  const kept = detail.suppliers.filter(
    (supplier) =>
      (ordererParam === undefined || supplier.ordererId === ordererParam) &&
      (filter !== 'ORDERED' || supplier.lineCount > 0) &&
      (!narrowing || facets.data === undefined || (countOf.get(supplier.supplierId) ?? 0) > 0),
  );
  const suppliers = chosen ? [chosen] : kept;
  const productCount = facets.data
    ? suppliers.reduce((sum, supplier) => sum + (countOf.get(supplier.supplierId) ?? 0), 0)
    : undefined;
  const supplierOptions = (chosen && !kept.includes(chosen) ? [chosen, ...kept] : kept).map(
    (supplier) => ({
      value: String(supplier.supplierId),
      label: supplier.supplierName,
      keys: [supplier.supplierCode],
      hint: countOf.has(supplier.supplierId)
        ? t('procurement.ticks.mainProducts', {
            count: formatCount(countOf.get(supplier.supplierId) ?? 0),
          })
        : undefined,
    }),
  );
  const orderers = new Map<number, string>();
  for (const supplier of detail.suppliers) {
    if (supplier.ordererId !== null) {
      orderers.set(supplier.ordererId, supplier.ordererName ?? '');
    }
  }
  const ordererOptions = [...orderers]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([userId, name]) => ({ value: String(userId), label: name }));

  // Groups open or closed (ADR-0118 kept for small orders): a closed group loads no rows.
  const collapsible = detail.suppliers.length > OPEN_ALL_UP_TO;
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const isOpen = (supplierId: number) =>
    !collapsible || supplierParam === supplierId || opened.has(supplierId);
  const toggleGroup = useCallback(
    (supplierId: number) =>
      setOpened((current) => {
        const next = new Set(current);
        if (next.has(supplierId)) next.delete(supplierId);
        else next.add(supplierId);
        return next;
      }),
    [],
  );
  const allOpen = suppliers.every((supplier) => isOpen(supplier.supplierId));
  const toggleAllGroups = () =>
    setOpened(allOpen ? new Set() : new Set(suppliers.map((supplier) => supplier.supplierId)));

  // Column groups hidden per user in this browser; the present stages' groups stay (ADR-0118 #5).
  const locked = requiredGroupsFor(detail.suppliers.map((supplier) => supplier.status));
  const columns = useHiddenColumns(COLUMNS_LIST, GROUP_KEYS, locked);
  const view: ColumnView = { hidden: columns.hidden, canPrices, canCosts };
  const specs = useMemo(
    () => orderColumns({ hidden: columns.hidden, canPrices, canCosts }),
    [columns.hidden, canPrices, canCosts],
  );

  // The typed cells, over every supplier; nothing is written until «Хадгалах».
  const [edits, setEdits] = useState<ReadonlyMap<string, CellEdit>>(new Map());
  const [report, setReport] = useState<SaveReport | null>(null);
  const pending = [...edits.values()].filter(isDirty);
  const invalid = pending.filter((edit) => !isValid(edit)).length;
  const dirty = pending.length > 0;
  const onEdit = useCallback(
    (edit: CellEdit) =>
      setEdits((current) => {
        const next = new Map(current);
        next.set(editKey(edit), edit);
        return next;
      }),
    [],
  );

  // The stale check: the stamps the page loaded with against the poll's (ADR-0118 #3).
  const version = usePurchaseOrderVersion(detail.id);
  const [baseline, setBaseline] = useState<PurchaseOrderVersion | null>(null);
  useEffect(() => {
    if (baseline === null && version.data) setBaseline(version.data);
  }, [baseline, version.data]);
  const stale =
    baseline !== null && version.data !== undefined && !sameVersion(baseline, version.data);
  const [confirmReload, setConfirmReload] = useState(false);
  const reload = async () => {
    setEdits(new Map());
    setReport(null);
    await mutations.refreshOrder(detail.id);
    const fresh = await version.refetch();
    if (fresh.data) setBaseline(fresh.data);
  };
  const afterOwnChange = async () => {
    await mutations.refreshOrder(detail.id);
    const fresh = await version.refetch();
    if (fresh.data) setBaseline(fresh.data);
  };

  // Moves, with «Ирсэн» asking first; the extra-line dialog.
  const [arriving, setArriving] = useState<PurchaseOrderSupplier | null>(null);
  const [extraFor, setExtraFor] = useState<{
    supplier: PurchaseOrderSupplier;
    receiptId: number;
  } | null>(null);
  const move = async (supplier: PurchaseOrderSupplier, to: PoStatus) => {
    await mutations.move.mutateAsync({
      key: randomUuid(),
      id: detail.id,
      supplierId: supplier.supplierId,
      to,
    });
    toast.success(
      t('procurement.supplier.moved', {
        name: supplier.supplierName,
        status: t(`procurement.status.${to}`),
      }),
    );
    await afterOwnChange();
  };
  const step = (supplier: PurchaseOrderSupplier, by: 1 | -1) => {
    const to = stepFrom(supplier.status, by);
    if (!to) return;
    if (to === 'ARRIVED' && by === 1) {
      confirmAction.clear();
      setArriving(supplier);
      return;
    }
    void moveAction.run(() => move(supplier, to));
  };

  /** Enter in a cell goes to the next cell of the same kind (down the table). */
  const table = useRef<HTMLDivElement>(null);
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const kind = event.currentTarget.dataset.poCell ?? '';
    const inputs = [
      ...(table.current?.querySelectorAll<HTMLInputElement>(
        `input[data-po-cell="${kind}"]:not(:disabled)`,
      ) ?? []),
    ];
    const next = inputs[inputs.indexOf(event.currentTarget) + 1];
    if (next) {
      next.focus();
      next.select();
    }
  };

  /** Every dirty cell, per supplier and kind: one request each; the prices through the receipt. */
  const save = () =>
    void saveAction.run(async () => {
      const snapshot = edits;
      const sent = [...snapshot.values()].filter(isDirty);
      const bySupplier = new Map<number, CellEdit[]>();
      for (const edit of sent) {
        bySupplier.set(edit.supplierId, [...(bySupplier.get(edit.supplierId) ?? []), edit]);
      }
      let applied = 0;
      const next: SaveReport = { conflicts: [], refused: [] };
      const failed = new Set<string>();
      for (const [supplierId, own] of bySupplier) {
        const lines = own.filter((edit) => edit.kind === 'order' || edit.kind === 'shipped');
        if (lines.length > 0) {
          const result = await mutations.saveLines.mutateAsync({
            id: detail.id,
            supplierId,
            changes: lines.map(toGridChange),
          });
          applied += result.applied;
          for (const conflict of result.conflicts) {
            const key = `${conflict.field === 'SHIPPED' ? 'shipped' : 'order'}:${supplierId}:${conflict.productId}`;
            const edit = snapshot.get(key);
            const label = edit && 'label' in edit ? edit.label : String(conflict.productId);
            const unitName =
              edit?.kind === 'order'
                ? (edit.units.find((unit) => unit.id === conflict.productUnitId)?.name ?? '')
                : '';
            failed.add(key);
            next.conflicts.push({
              key,
              text:
                conflict.field === 'SHIPPED'
                  ? t('procurement.detail.conflictShipped', {
                      product: label,
                      qty: conflict.qty === null ? t('common.none') : formatQty(conflict.qty),
                    })
                  : conflict.qty && !new Decimal(conflict.qty).isZero()
                    ? t('procurement.grid.conflictLine', {
                        product: label,
                        qty: formatQty(conflict.qty),
                        unit: unitName,
                      })
                    : t('procurement.grid.conflictRemoved', { product: label }),
            });
          }
          for (const refusal of result.refused) {
            const key = `order:${supplierId}:${refusal.productId}`;
            const edit =
              snapshot.get(key) ?? snapshot.get(`shipped:${supplierId}:${refusal.productId}`);
            failed.add(key);
            next.refused.push({
              key,
              text: t('procurement.grid.refusedLine', {
                product: edit && 'label' in edit ? edit.label : String(refusal.productId),
                reason: t(`procurement.grid.refusal.${refusal.reason}`),
              }),
            });
          }
        }
        const arrivals = own.filter((edit) => edit.kind === 'arrival');
        if (arrivals.length > 0) {
          const result = await mutations.saveArrivals.mutateAsync({
            id: detail.id,
            supplierId,
            changes: arrivals.map(toArrivalChange),
          });
          applied += result.applied;
          for (const conflict of result.conflicts) {
            const key = `arrival:${supplierId}:${conflict.lineId}`;
            const edit = snapshot.get(key);
            failed.add(key);
            next.conflicts.push({
              key,
              text: t('procurement.detail.conflictArrived', {
                product: edit && 'label' in edit ? edit.label : String(conflict.lineId),
                qty:
                  conflict.arrivedQtyBase === null
                    ? t('procurement.detail.unchecked')
                    : formatQty(conflict.arrivedQtyBase),
              }),
            });
          }
          for (const refusal of result.refused) {
            const key = `arrival:${supplierId}:${refusal.lineId}`;
            const edit = snapshot.get(key);
            failed.add(key);
            next.refused.push({
              key,
              text: t('procurement.grid.refusedLine', {
                product: edit && 'label' in edit ? edit.label : String(refusal.lineId),
                reason: t(`procurement.detail.arrivalRefusal.${refusal.reason}`),
              }),
            });
          }
        }
        const prices = own.filter((edit) => edit.kind === 'price');
        const noteAmount = own.find((edit) => edit.kind === 'noteAmount');
        if (prices.length > 0 || noteAmount) {
          const supplier = detail.suppliers.find((row) => row.supplierId === supplierId);
          if (supplier?.receiptId == null) continue;
          applied += await savePrices(supplier.receiptId, prices, noteAmount);
        }
      }
      setReport(next.conflicts.length + next.refused.length > 0 ? next : null);
      // Cells typed while the requests ran are kept; the rest now show the server's values.
      setEdits((current) => {
        const kept = new Map(current);
        for (const [key, edit] of snapshot) {
          if (kept.get(key) === edit) kept.delete(key);
        }
        return kept;
      });
      await afterOwnChange();
      if (applied > 0) toast.success(t('procurement.grid.saved', { count: applied }));
    });

  /**
   * The accountant's price check from the page (ADR-0118 #5): the receipt's costing names every
   * arrived line; the typed prices replace theirs, the rest keep the price they carry; one
   * `PUT /receipts/:id/costs` with the costing version the receipt holds now.
   */
  const savePrices = async (
    receiptId: number,
    prices: CellEdit[],
    noteAmount: CellEdit | undefined,
  ): Promise<number> => {
    const costing: ReceiptCosting = unwrap(
      await api.GET('/api/v1/receipts/{id}/costing', { params: { path: { id: receiptId } } }),
    );
    const typed = new Map(
      prices.flatMap((edit) =>
        edit.kind === 'price' ? [[edit.lineId, edit.unitPrice.trim().replace(',', '.')]] : [],
      ),
    );
    const missing: string[] = [];
    const lines = costing.lines.map((line) => {
      const price = typed.get(line.lineId);
      if (price) return { lineId: line.lineId, unitPrice: price };
      if (line.freeGoods) return { lineId: line.lineId, freeGoods: true };
      if (line.docAmount !== null) return { lineId: line.lineId, amount: line.docAmount };
      if (line.docUnitPrice !== null) return { lineId: line.lineId, unitPrice: line.docUnitPrice };
      missing.push(line.productName);
      return { lineId: line.lineId, freeGoods: true };
    });
    if (missing.length > 0) {
      throw new ApiProblem({
        type: 'about:blank',
        status: 422,
        code: 'VALIDATION_FAILED',
        title: t('procurement.detail.pricesMissing', { products: missing.join(', ') }),
      });
    }
    const note =
      noteAmount?.kind === 'noteAmount' ? noteAmount.amount.trim().replace(',', '.') : '';
    await inventory.costReceipt.mutateAsync({
      id: receiptId,
      key: randomUuid(),
      body: {
        costingVersion: costing.costingVersion,
        ...(note ? { noteTotalAmount: note } : {}),
        lines,
      },
    });
    await queryClient.invalidateQueries({ queryKey: INVENTORY_KEYS.receipts });
    return lines.length;
  };

  const conflicted = new Set([
    ...(report?.conflicts.map((row) => row.key) ?? []),
    ...(report?.refused.map((row) => row.key) ?? []),
  ]);

  return (
    <div>
      <OrderHeader
        detail={detail}
        chosen={chosen}
        dirtyCount={pending.length}
        invalidCount={invalid}
        saving={
          saveAction.problem === null &&
          (mutations.saveLines.isPending ||
            mutations.saveArrivals.isPending ||
            inventory.costReceipt.isPending)
        }
        canSave={canType}
        onSave={save}
        stale={stale}
        onReload={() => (dirty ? setConfirmReload(true) : void reload())}
        onStepBack={(supplier) => step(supplier, -1)}
      />
      <FilterBar
        end={
          <>
            {collapsible ? (
              <Button type="button" variant="outline" size="sm" onClick={toggleAllGroups}>
                {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
                {t(allOpen ? 'procurement.detail.collapseAll' : 'procurement.detail.expandAll')}
              </Button>
            ) : null}
            <ColumnChooser
              keys={GROUP_KEYS}
              locked={locked}
              label={(key) => t(`procurement.detail.groups.${key}`)}
              hidden={columns.hidden}
              toggle={columns.toggle}
              showAll={columns.showAll}
            />
          </>
        }
      >
        <Combobox
          aria-label={t('procurement.detail.supplierFilter')}
          emptyLabel={t('procurement.detail.allSuppliers')}
          value={supplierParam === undefined ? '' : String(supplierParam)}
          options={supplierOptions}
          onChange={(value) => setParam('supplier', value)}
        />
        <Combobox
          aria-label={t('procurement.grid.warehouse')}
          emptyLabel={t('procurement.detail.allWarehouses')}
          value={warehouseId === undefined ? '' : String(warehouseId)}
          options={(warehouses.data ?? []).map((warehouse) => ({
            value: String(warehouse.id),
            label: warehouse.kind === 'TRANSIT' ? t('org.kinds.TRANSIT') : warehouse.name,
            keys: [warehouse.code],
          }))}
          onChange={(value) => setParam('warehouse', value)}
        />
        <Combobox
          aria-label={t('procurement.detail.ordererFilter')}
          emptyLabel={t('procurement.detail.allOrderers')}
          value={ordererParam === undefined ? '' : String(ordererParam)}
          options={ordererOptions}
          onChange={(value) => setParam('orderer', value)}
        />
        <SearchField
          aria-label={t('procurement.grid.search')}
          placeholder={t('procurement.grid.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <FilterToggle
          label={t('procurement.detail.belowMin')}
          checked={filter === 'BELOW_MIN'}
          onCheckedChange={(checked) => setParam('filter', checked ? 'BELOW_MIN' : 'ALL')}
        />
        <FilterToggle
          label={t('procurement.detail.orderedOnly')}
          checked={filter === 'ORDERED'}
          onCheckedChange={(checked) => setParam('filter', checked ? 'ORDERED' : 'ALL')}
        />
        <span className="text-[13px] text-muted-foreground" aria-live="polite">
          {productCount === undefined
            ? t('procurement.detail.supplierCount', { count: formatCount(suppliers.length) })
            : t('procurement.detail.matchCount', {
                suppliers: formatCount(suppliers.length),
                products: formatCount(productCount),
              })}
        </span>
      </FilterBar>
      {invalid > 0 ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {t('procurement.grid.invalid', { count: invalid })}
        </p>
      ) : null}
      <ProblemAlert problem={saveAction.problem ?? moveAction.problem} />
      {report ? (
        <Alert className="mb-3 border-transparent bg-warning-soft shadow-none!">
          <TriangleAlert />
          <AlertTitle>{t('procurement.grid.notSavedTitle')}</AlertTitle>
          <AlertDescription>
            {report.conflicts.length > 0 ? (
              <>
                <p>{t('procurement.grid.conflictsTitle')}</p>
                <ul className="list-disc pl-5">
                  {report.conflicts.map((row) => (
                    <li key={row.key}>{row.text}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.refused.length > 0 ? (
              <>
                <p>{t('procurement.grid.refusedTitle')}</p>
                <ul className="list-disc pl-5">
                  {report.refused.map((row) => (
                    <li key={row.key}>{row.text}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </AlertDescription>
          <Button
            size="icon-xs"
            variant="ghost"
            className="absolute top-2 right-2"
            aria-label={t('procurement.grid.dismiss')}
            title={t('procurement.grid.dismiss')}
            onClick={() => setReport(null)}
          >
            <X />
          </Button>
        </Alert>
      ) : null}
      <div ref={table}>
        <ListCard scroll>
          {suppliers.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t(
                detail.suppliers.length === 0
                  ? 'procurement.order.noSuppliers'
                  : 'procurement.order.noOrdered',
              )}
            />
          ) : (
            <ListTable columns={specs}>
              <OrderTableHead view={view} />
              {suppliers.map((supplier) => (
                <SupplierGroup
                  key={supplier.supplierId}
                  orderId={detail.id}
                  supplier={supplier}
                  query={query}
                  view={view}
                  edits={edits}
                  conflicted={conflicted}
                  onEdit={onEdit}
                  onMove={step}
                  onAddExtra={(row, receiptId) => setExtraFor({ supplier: row, receiptId })}
                  movePending={mutations.move.isPending}
                  onEnter={onEnter}
                  open={isOpen(supplier.supplierId)}
                  collapsible={collapsible}
                  onToggle={toggleGroup}
                />
              ))}
            </ListTable>
          )}
        </ListCard>
      </div>
      <LeaveGuard
        when={dirty}
        title={t('procurement.grid.leaveTitle')}
        description={t('procurement.grid.leaveDescription')}
        leaveLabel={t('procurement.grid.leaveLabel')}
      />
      <ConfirmDialog
        open={confirmReload}
        title={t('procurement.detail.reloadTitle')}
        description={t('procurement.detail.reloadDescription')}
        confirmLabel={t('procurement.detail.reload')}
        onConfirm={() => {
          setConfirmReload(false);
          void reload();
        }}
        onClose={() => setConfirmReload(false)}
      />
      <ConfirmDialog
        open={arriving !== null}
        variant="default"
        title={t('procurement.supplier.arriveTitle', { name: arriving?.supplierName ?? '' })}
        description={t('procurement.supplier.arriveDescription')}
        confirmLabel={t('procurement.supplier.arriveConfirm')}
        pending={mutations.move.isPending}
        problem={confirmAction.problem}
        onConfirm={() => {
          const supplier = arriving;
          if (!supplier) return;
          void confirmAction
            .run(() => move(supplier, 'ARRIVED'))
            .then((done) => done && setArriving(null));
        }}
        onClose={() => setArriving(null)}
      />
      <Dialog open={extraFor !== null} onOpenChange={(open) => !open && setExtraFor(null)}>
        {extraFor ? (
          <AddExtraLineDialog
            receiptId={extraFor.receiptId}
            supplierName={extraFor.supplier.supplierName}
            onClose={() => setExtraFor(null)}
            onAdded={afterOwnChange}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/**
 * «Захиалгад байхгүй бараа нэмэх» (ADR-0118 #2): goods the supplier sent that the order never
 * listed, added to the draft receipt in pieces, as the scanner screen does after a scan.
 */
function AddExtraLineDialog(props: {
  receiptId: number;
  supplierName: string;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const inventory = useInventoryMutations();
  const action = useAction();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const products = useProducts({ q, status: 'ACTIVE' }, { limit: 20, enabled: q.length > 0 });
  const [productId, setProductId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const found = products.data?.pages.flatMap((page) => page.data) ?? [];
  const picked = found.find((product) => product.id === productId);
  const valid = picked !== undefined && parseScanQty(qty) !== null;
  const add = () =>
    void action.run(async () => {
      if (!picked) return;
      await inventory.addReceiptLine.mutateAsync({
        id: props.receiptId,
        body: { productUnitId: picked.baseUnit.id, enteredQty: parseScanQty(qty) ?? '0' },
      });
      toast.success(t('procurement.detail.extraAdded', { name: picked.name }));
      await props.onAdded();
      props.onClose();
    });
  return (
    <DialogContent size="md" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !inventory.addReceiptLine.isPending) add();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('procurement.detail.addExtraTitle', { name: props.supplierName })}
          </DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.detail.extraProduct')} htmlFor="po-extra-search">
          <SearchField
            id="po-extra-search"
            className="sm:w-full"
            placeholder={t('procurement.grid.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </FormField>
        {found.length > 0 ? (
          <NativeSelect
            aria-label={t('procurement.detail.extraProduct')}
            value={productId === null ? '' : String(productId)}
            onChange={(event) => setProductId(idOf(event.target.value) ?? null)}
          >
            <option value="">{t('procurement.detail.extraPick')}</option>
            {found.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} {product.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <FormField
          label={t('procurement.detail.extraQty', { unit: picked?.baseUnit.uomName ?? '' })}
          htmlFor="po-extra-qty"
        >
          <Input
            id="po-extra-qty"
            inputMode="decimal"
            className="w-32 text-right font-mono"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </FormField>
        <DialogFormFooter
          pending={inventory.addReceiptLine.isPending}
          disabled={!valid}
          submitLabel={t('procurement.detail.addExtra')}
          onCancel={props.onClose}
        />
      </form>
    </DialogContent>
  );
}
