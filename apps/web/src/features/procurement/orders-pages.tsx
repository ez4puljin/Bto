import { Decimal } from '@tugeel/shared/money';
import dayjs from 'dayjs';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  NotebookPen,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea';
import { useCompanyName } from '@/features/company/api';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  isPoStatus,
  PO_STATUSES,
  type PoStatus,
  type PurchaseOrderDetail,
  type PurchaseOrderPrint,
  type PurchaseOrderSupplier,
  usePurchaseOrder,
  usePurchaseOrderMutations,
  usePurchaseOrderPrint,
  usePurchaseOrders,
} from './api';
import { OrderGrid } from './order-grid';
import { PoStatusBadge, SupplierTicks } from './parts';

const idOf = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const stepFrom = (status: PoStatus, by: 1 | -1): PoStatus | undefined =>
  PO_STATUSES[PO_STATUSES.indexOf(status) + by];

/**
 * Purchase orders by supplier (ADR-0115): every order with its lowest status and its suppliers,
 * filtered by number, status and «Миний нийлүүлэгч»; managers start a new one from a dialog.
 */
export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isPoStatus(statusParam) ? statusParam : undefined;
  const mine = params.get('mine') === '1';
  const orders = usePurchaseOrders({ q, status, mine });
  const rows = orders.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();
  const filtered = q !== '' || status !== undefined || mine;

  return (
    <div>
      <PageHeader
        title={t('procurement.orders.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('procurement.orders.create')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <CreateOrderDialog onCancel={() => setCreating(false)} /> : null}
        </Dialog>
      ) : null}
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('procurement.orders.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('procurement.orders.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('procurement.orders.allStatuses')}</option>
          {PO_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`procurement.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('procurement.orders.mine')}
          checked={mine}
          onCheckedChange={(checked) => setParam('mine', checked ? '1' : '')}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(orders.error)} onRetry={orders.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('procurement.orders.number')}</TableHead>
              <TableHead>{t('procurement.orders.date')}</TableHead>
              <TableHead>{t('procurement.orders.suppliers')}</TableHead>
              <TableHead className="text-right">{t('procurement.orders.supplierCount')}</TableHead>
              <TableHead>{t('procurement.orders.note')}</TableHead>
              <TableHead>{t('procurement.orders.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((order) => (
              <LinkRow key={order.id} to={`/procurement/orders/${order.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/procurement/orders/${order.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {order.number}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{order.orderDate}</TableCell>
                <TruncateCell text={order.supplierNames.join(', ')} />
                <TableCell className="text-right font-mono">{order.supplierCount}</TableCell>
                <TruncateCell
                  className="text-muted-foreground"
                  text={order.note ?? t('common.none')}
                />
                <TableCell>
                  <PoStatusBadge status={order.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!orders.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t(filtered ? 'procurement.orders.emptyFiltered' : 'procurement.orders.empty')}
            onClearFilters={
              filtered
                ? () => {
                    setSearch('');
                    setParam('q', '');
                    setParam('status', '');
                    setParam('mine', '');
                  }
                : undefined
            }
          />
        ) : null}
        <LoadMore query={orders} />
      </ListCard>
    </div>
  );
}

/** A new order: its date (today), a note and the suppliers to order from; the grid comes after. */
function CreateOrderDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [orderDate, setOrderDate] = useState(() => dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD'));
  const [note, setNote] = useState('');
  const [suppliers, setSuppliers] = useState<ReadonlyMap<number, string>>(new Map());

  const create = () =>
    void action.run(async () => {
      const order = await mutations.create.mutateAsync({
        key,
        orderDate: orderDate || null,
        note: note.trim() || null,
        supplierIds: [...suppliers.keys()],
      });
      toast.success(t('procurement.create.created', { number: order.number }));
      await navigate(`/procurement/orders/${order.id}`, { replace: true });
    });

  return (
    <DialogContent size="lg" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (suppliers.size > 0 && !mutations.create.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.create.title')}</DialogTitle>
          <DialogDescription>{t('procurement.create.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <FormField label={t('procurement.create.date')} htmlFor="po-date">
            <Input
              id="po-date"
              type="date"
              className="font-mono"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </FormField>
          <FormField label={t('procurement.create.note')} htmlFor="po-note">
            <Input
              id="po-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label={t('procurement.create.suppliers')} htmlFor="po-suppliers">
          <SupplierTicks id="po-suppliers" value={suppliers} onChange={setSuppliers} />
        </FormField>
        <DialogFormFooter
          pending={mutations.create.isPending}
          disabled={suppliers.size === 0}
          submitLabel={t('procurement.create.submit')}
          onCancel={onCancel}
        />
      </form>
    </DialogContent>
  );
}

/**
 * One order (`/procurement/orders/:id`, ADR-0115): the suppliers as a strip of cards, each with its
 * status, orderer and steps, and the chosen one's grid (`?supplier=`) below.
 */
export function PurchaseOrderPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id) ?? 0;
  const order = usePurchaseOrder(id);
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<number | null>(null);
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
  const detail = order.data;
  const wanted = idOf(params.get('supplier'));
  const selected =
    detail.suppliers.find((supplier) => supplier.supplierId === wanted) ?? detail.suppliers[0];
  const select = (supplierId: number) => {
    if (supplierId === selected?.supplierId) return;
    if (dirty) setSwitchTo(supplierId);
    else setParam('supplier', String(supplierId));
  };

  return (
    <div>
      <OrderHeader detail={detail} />
      <SupplierStrip
        detail={detail}
        selectedId={selected?.supplierId}
        onSelect={select}
        onRemoved={(supplierId) => {
          if (supplierId === selected?.supplierId) setParam('supplier', '');
        }}
      />
      {selected ? (
        <OrderGrid
          key={selected.supplierId}
          orderId={detail.id}
          supplier={selected}
          onDirtyChange={setDirty}
        />
      ) : (
        <ListCard>
          <EmptyState icon={ClipboardList} title={t('procurement.order.noSuppliers')} />
        </ListCard>
      )}
      <LeaveGuard
        when={dirty}
        title={t('procurement.grid.leaveTitle')}
        description={t('procurement.grid.leaveDescription')}
        leaveLabel={t('procurement.grid.leaveLabel')}
      />
      <ConfirmDialog
        open={switchTo !== null}
        title={t('procurement.grid.leaveTitle')}
        description={t('procurement.grid.switchDescription')}
        confirmLabel={t('procurement.grid.switchConfirm')}
        onConfirm={() => {
          if (switchTo !== null) setParam('supplier', String(switchTo));
          setSwitchTo(null);
        }}
        onClose={() => setSwitchTo(null)}
      />
    </div>
  );
}

/** The order's number, lowest status, date and author; print, the note and more suppliers. */
function OrderHeader({ detail }: { detail: PurchaseOrderDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const [adding, setAdding] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  return (
    <>
      <PageHeader
        title={detail.number}
        description={detail.note ?? undefined}
        meta={
          <>
            <PoStatusBadge status={detail.status} />
            <span className="font-mono">{detail.orderDate}</span>
            {detail.createdBy ? (
              <span>{t('procurement.order.createdBy', { name: detail.createdBy })}</span>
            ) : null}
          </>
        }
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="outline" onClick={() => setEditingNote(true)}>
                  <NotebookPen />
                  {t('procurement.order.editNote')}
                </Button>
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus />
                  {t('procurement.order.addSuppliers')}
                </Button>
              </>
            ) : null}
            <Button variant="outline" asChild>
              <Link to={`/procurement/orders/${detail.id}/print`} target="_blank" rel="noreferrer">
                <Printer />
                {t('procurement.order.printAll')}
              </Link>
            </Button>
          </>
        }
      />
      {canManage ? (
        <>
          <Dialog open={adding} onOpenChange={setAdding}>
            {adding ? (
              <AddSuppliersDialog detail={detail} onClose={() => setAdding(false)} />
            ) : null}
          </Dialog>
          <Dialog open={editingNote} onOpenChange={setEditingNote}>
            {editingNote ? (
              <NoteDialog detail={detail} onClose={() => setEditingNote(false)} />
            ) : null}
          </Dialog>
        </>
      ) : null}
    </>
  );
}

function AddSuppliersDialog(props: { detail: PurchaseOrderDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [suppliers, setSuppliers] = useState<ReadonlyMap<number, string>>(new Map());
  const inOrder = new Set(props.detail.suppliers.map((supplier) => supplier.supplierId));
  const add = () =>
    void action.run(async () => {
      await mutations.addSuppliers.mutateAsync({
        id: props.detail.id,
        supplierIds: [...suppliers.keys()],
      });
      toast.success(t('procurement.order.added', { count: suppliers.size }));
      props.onClose();
    });
  return (
    <DialogContent size="lg" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (suppliers.size > 0 && !mutations.addSuppliers.isPending) add();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.order.addSuppliers')}</DialogTitle>
          <DialogDescription>{t('procurement.order.addSuppliersHint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.create.suppliers')} htmlFor="po-add-suppliers">
          <SupplierTicks
            id="po-add-suppliers"
            value={suppliers}
            onChange={setSuppliers}
            exclude={inOrder}
          />
        </FormField>
        <DialogFormFooter
          pending={mutations.addSuppliers.isPending}
          disabled={suppliers.size === 0}
          submitLabel={t('procurement.order.add')}
          onCancel={props.onClose}
        />
      </form>
    </DialogContent>
  );
}

function NoteDialog(props: { detail: PurchaseOrderDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [note, setNote] = useState(props.detail.note ?? '');
  const save = () =>
    void action.run(async () => {
      await mutations.updateNote.mutateAsync({ id: props.detail.id, note: note.trim() || null });
      toast.success(t('common.saved'));
      props.onClose();
    });
  return (
    <DialogContent size="md" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutations.updateNote.isPending) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.order.editNote')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.orders.note')} htmlFor="po-note-edit">
          <Textarea
            id="po-note-edit"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFormFooter pending={mutations.updateNote.isPending} onCancel={props.onClose} />
      </form>
    </DialogContent>
  );
}

/**
 * The order's suppliers side by side: status, orderer, lines, the estimated cost (price readers),
 * the receipt once it arrived, and one step forward or back. ARRIVED asks first: it makes the
 * supplier's draft receipt; the last two statuses follow that receipt.
 */
function SupplierStrip(props: {
  detail: PurchaseOrderDetail;
  selectedId: number | undefined;
  onSelect: (supplierId: number) => void;
  onRemoved: (supplierId: number) => void;
}) {
  const { t } = useTranslation();
  const { detail } = props;
  const canManage = useHasPermission('procurement.orders.manage');
  const canPrices = useHasPermission('procurement.prices.read');
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const confirmAction = useAction();
  const [arriving, setArriving] = useState<PurchaseOrderSupplier | null>(null);
  const [removing, setRemoving] = useState<PurchaseOrderSupplier | null>(null);

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
  };
  const step = (supplier: PurchaseOrderSupplier, by: 1 | -1) => {
    const to = stepFrom(supplier.status, by);
    if (!to) return;
    if (to === 'ARRIVED' && by === 1) {
      confirmAction.clear();
      setArriving(supplier);
      return;
    }
    void action.run(() => move(supplier, to));
  };

  return (
    <section aria-label={t('procurement.order.suppliers')} className="mb-4">
      <ProblemAlert problem={action.problem} />
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {detail.suppliers.map((supplier) => {
          const selected = supplier.supplierId === props.selectedId;
          const next = stepFrom(supplier.status, 1);
          const back = stepFrom(supplier.status, -1);
          const name = supplier.supplierName;
          return (
            <li key={supplier.supplierId} className="shrink-0">
              <article
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex h-full w-72 flex-col gap-2 rounded-xl bg-card p-3 shadow-card ring-1 ring-border',
                  selected && 'ring-2 ring-primary',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    aria-pressed={selected}
                    title={name}
                    className="min-w-0 truncate rounded text-left font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => props.onSelect(supplier.supplierId)}
                  >
                    {name}
                  </button>
                  <PoStatusBadge status={supplier.status} />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-muted-foreground">{t('procurement.supplier.orderer')}</dt>
                  <dd className="truncate">
                    {supplier.ordererName ?? t('procurement.supplier.noOrderer')}
                  </dd>
                  <dt className="text-muted-foreground">{t('procurement.supplier.lines')}</dt>
                  <dd className="font-mono">
                    {formatCount(supplier.lineCount)}
                    {new Decimal(supplier.weightKg).gt(0)
                      ? ` · ${t('procurement.supplier.kg', { kg: formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString()) })}`
                      : ''}
                  </dd>
                  {canPrices && supplier.estimatedCost !== null ? (
                    <>
                      <dt className="text-muted-foreground">
                        {t('procurement.supplier.estimatedCost')}
                      </dt>
                      <dd className="font-mono">{formatTugrik(supplier.estimatedCost)}</dd>
                    </>
                  ) : null}
                  {supplier.receiptId !== null ? (
                    <>
                      <dt className="text-muted-foreground">{t('procurement.supplier.receipt')}</dt>
                      <dd>
                        <Link
                          to={`/inventory/receipts/${supplier.receiptId}`}
                          className="font-mono text-link underline-offset-4 hover:underline"
                        >
                          {supplier.receiptNumber ??
                            t('procurement.supplier.receiptDraft', { id: supplier.receiptId })}
                        </Link>
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  {supplier.canMoveBack && back ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('procurement.supplier.backNamed', { name })}
                      title={t('procurement.supplier.backTo', {
                        status: t(`procurement.status.${back}`),
                      })}
                      disabled={mutations.move.isPending}
                      onClick={() => step(supplier, -1)}
                    >
                      <ArrowLeft />
                      {t('procurement.supplier.back')}
                    </Button>
                  ) : null}
                  {supplier.canMoveNext && next ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t('procurement.supplier.nextNamed', { name })}
                      title={t('procurement.supplier.nextTo', {
                        status: t(`procurement.status.${next}`),
                      })}
                      disabled={mutations.move.isPending}
                      onClick={() => step(supplier, 1)}
                    >
                      {t('procurement.supplier.next')}
                      <ArrowRight />
                    </Button>
                  ) : null}
                  <span className="ml-auto flex gap-0.5">
                    <Button size="icon-sm" variant="ghost" className="size-7" asChild>
                      <Link
                        to={`/procurement/orders/${detail.id}/print?supplierId=${supplier.supplierId}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('procurement.supplier.print', { name })}
                        title={t('procurement.supplier.print', { name })}
                      >
                        <Printer />
                      </Link>
                    </Button>
                    {canManage && supplier.status === 'PREPARING' ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label={t('procurement.supplier.remove', { name })}
                        title={t('procurement.supplier.remove', { name })}
                        onClick={() => {
                          confirmAction.clear();
                          setRemoving(supplier);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </span>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
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
      <ConfirmDialog
        open={removing !== null}
        title={t('procurement.supplier.removeTitle', { name: removing?.supplierName ?? '' })}
        description={t('procurement.supplier.removeDescription')}
        confirmLabel={t('procurement.supplier.removeConfirm')}
        pending={mutations.removeSupplier.isPending}
        problem={confirmAction.problem}
        onConfirm={() => {
          const supplier = removing;
          if (!supplier) return;
          void confirmAction
            .run(async () => {
              await mutations.removeSupplier.mutateAsync({
                id: detail.id,
                supplierId: supplier.supplierId,
              });
              toast.success(t('procurement.supplier.removed', { name: supplier.supplierName }));
              props.onRemoved(supplier.supplierId);
            })
            .then((done) => done && setRemoving(null));
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

/**
 * The order on paper (`/procurement/orders/:id/print?supplierId=`, ADR-0058: from the browser, no
 * PDF): one sheet per supplier with what to send, in the units ordered, the pieces and the weight.
 */
export function PurchaseOrderPrintPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id) ?? 0;
  const [search] = useSearchParams();
  const supplierId = idOf(search.get('supplierId'));
  const sheets = usePurchaseOrderPrint(id, supplierId);
  return (
    <PrintFrame
      ready={sheets.data !== undefined}
      error={sheets.error}
      title={sheets.data ? `${t('procurement.print.title')} ${sheets.data.number}` : ''}
    >
      {(narrow) =>
        sheets.data
          ? sheets.data.sheets.map((sheet, index, all) => (
              <SupplierSheet
                key={sheet.supplierId}
                order={sheets.data}
                sheet={sheet}
                narrow={narrow}
                last={index === all.length - 1}
              />
            ))
          : null
      }
    </PrintFrame>
  );
}

function SupplierSheet(props: {
  order: PurchaseOrderPrint;
  sheet: PurchaseOrderPrint['sheets'][number];
  narrow: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const { order, sheet } = props;
  const pieces = sheet.lines.reduce((sum, line) => sum.plus(line.qtyBase), new Decimal(0));
  const kg = sheet.lines.reduce(
    (sum, line) => (line.weightKg ? sum.plus(line.weightKg) : sum),
    new Decimal(0),
  );
  const kgText = (value: Decimal) => formatQty(value.toDecimalPlaces(2).toString());
  const facts: [string, string][] = [
    [t('procurement.print.number'), order.number],
    [t('procurement.print.date'), order.orderDate],
    [t('procurement.print.supplier'), sheet.supplierName],
    [t('procurement.print.orderer'), sheet.ordererName ?? t('common.none')],
    ...(order.note ? ([[t('procurement.print.note'), order.note]] as [string, string][]) : []),
  ];
  const cell = 'border border-foreground/60 px-1.5 py-1';
  return (
    <article
      className={cn('flex flex-col gap-4', props.last ? undefined : 'mb-10 break-after-page')}
    >
      <header
        className={cn(
          'flex flex-col gap-2 border-b pb-3',
          props.narrow ? 'border-dashed border-foreground' : 'border-foreground',
        )}
      >
        <p className="font-semibold">{companyName}</p>
        <h1 className={cn('text-center font-bold', props.narrow ? 'text-sm' : 'text-lg')}>
          {t('procurement.print.title')}
        </h1>
        <dl className={cn('grid gap-x-6 gap-y-0.5', props.narrow ? 'grid-cols-1' : 'grid-cols-2')}>
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-muted-foreground print:text-foreground">{label}:</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {sheet.lines.length === 0 ? <p>{t('procurement.print.empty')}</p> : null}
      {props.narrow ? (
        <ol className="flex flex-col divide-y divide-dashed divide-foreground">
          {sheet.lines.map((line, index) => (
            <li key={line.productId} className="py-1">
              <p>
                {index + 1}. {line.name}
              </p>
              <p className="flex justify-between gap-2 font-mono">
                <span>{line.sku}</span>
                <span className="font-semibold">
                  {formatQty(line.qty)} {line.unitName}
                </span>
              </p>
            </li>
          ))}
        </ol>
      ) : sheet.lines.length > 0 ? (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left">
              <th className={cell}>{t('procurement.print.lineNo')}</th>
              <th className={cell}>{t('procurement.print.sku')}</th>
              <th className={cell}>{t('procurement.print.name')}</th>
              <th className={cell}>{t('procurement.print.warehouse')}</th>
              <th className={cell}>{t('procurement.print.unit')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.qty')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.pieces')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.kg')}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((line, index) => (
              <tr key={line.productId}>
                <td className={cn(cell, 'text-right')}>{index + 1}</td>
                <td className={cn(cell, 'font-mono')}>{line.sku}</td>
                <td className={cell}>{line.name}</td>
                <td className={cell}>{line.warehouseName ?? ''}</td>
                <td className={cell}>{line.unitName}</td>
                <td className={cn(cell, 'text-right font-mono font-semibold')}>
                  {formatQty(line.qty)}
                </td>
                <td className={cn(cell, 'text-right font-mono')}>
                  {formatQty(line.qtyBase)} {line.baseUnitName}
                </td>
                <td className={cn(cell, 'text-right font-mono')}>
                  {line.weightKg ? kgText(new Decimal(line.weightKg)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={cell} colSpan={6}>
                {t('procurement.print.total', { count: sheet.lines.length })}
              </td>
              <td className={cn(cell, 'text-right font-mono')}>{formatQty(pieces.toString())}</td>
              <td className={cn(cell, 'text-right font-mono')}>{kgText(kg)}</td>
            </tr>
          </tfoot>
        </table>
      ) : null}
      {props.narrow && sheet.lines.length > 0 ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-foreground pt-1">
          <dt>{t('procurement.print.total', { count: sheet.lines.length })}</dt>
          <dd className="text-right font-mono">{formatQty(pieces.toString())}</dd>
          <dt>{t('procurement.print.kg')}</dt>
          <dd className="text-right font-mono">{kgText(kg)}</dd>
        </dl>
      ) : null}
      <footer className={cn('mt-8 grid gap-6', props.narrow ? 'grid-cols-1' : 'grid-cols-2')}>
        {[t('procurement.print.orderedBy'), t('procurement.print.acceptedBy')].map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <span>{label}:</span>
            <span className="mt-6 border-b border-foreground" />
            <span className="text-center text-xs">{t('procurement.print.signature')}</span>
          </div>
        ))}
      </footer>
    </article>
  );
}
