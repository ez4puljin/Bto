import { Decimal } from '@tugeel/shared/money';
import { nextPoStatus, previousPoStatus } from '@tugeel/shared/procurement';
import { ChevronDown, History, RefreshCw, Table2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, FilterToggle, LoadMore } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import {
  PO_STATUSES,
  type GridRow,
  type PoStatus,
  type PurchaseOrderDetail,
  type PurchaseOrderSupplier,
  useOrdererCandidates,
  usePurchaseOrder,
  usePurchaseOrderMutations,
  usePurchaseOrderRows,
  useSetSupplierOrderer,
} from './api';
import { PoStatusBadge, StatusCountBadge } from './parts';

const idOf = (value: string | undefined) => {
  const id = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

/**
 * The order's front page (owner 2026-10-30, after Butenorgil's order window): the totals as tiles,
 * the suppliers per status as filters, and the suppliers grouped by their orderer with each group's
 * totals. The order itself has no status — only its suppliers do. «Дэлгэрэнгүй» opens the table of
 * every product (`/detail`), a supplier row opens it filtered to that supplier.
 */
export function PurchaseOrderOverviewPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id);
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
  return <Overview detail={order.data} onRefresh={() => void order.refetch()} />;
}

type Totals = {
  suppliers: number;
  boxes: Decimal;
  pieces: Decimal;
  kg: Decimal;
  estimated: Decimal;
  final: Decimal;
};

function sumOf(suppliers: readonly PurchaseOrderSupplier[]): Totals {
  const zero = new Decimal(0);
  return suppliers.reduce<Totals>(
    (sum, supplier) => ({
      suppliers: sum.suppliers + 1,
      boxes: sum.boxes.plus(supplier.boxes),
      pieces: sum.pieces.plus(supplier.qtyBase),
      kg: sum.kg.plus(supplier.weightKg),
      estimated: supplier.estimatedCost
        ? sum.estimated.plus(supplier.estimatedCost)
        : sum.estimated,
      final: supplier.finalAmount ? sum.final.plus(supplier.finalAmount) : sum.final,
    }),
    { suppliers: 0, boxes: zero, pieces: zero, kg: zero, estimated: zero, final: zero },
  );
}

function Overview({ detail, onRefresh }: { detail: PurchaseOrderDetail; onRefresh: () => void }) {
  const { t } = useTranslation();
  const canPrices = useHasPermission('procurement.prices.read');
  const [status, setStatus] = useState<PoStatus | null>(null);
  const base = `/procurement/orders/${detail.id}`;

  // A supplier's status moves from its card; «Ирсэн» asks first (it makes the draft receipt).
  const mutations = usePurchaseOrderMutations();
  const moveAction = useAction();
  const confirmAction = useAction();
  const [arriving, setArriving] = useState<PurchaseOrderSupplier | null>(null);
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
    const to = by === 1 ? nextPoStatus(supplier.status) : previousPoStatus(supplier.status);
    if (!to) return;
    if (to === 'ARRIVED' && by === 1) {
      confirmAction.clear();
      setArriving(supplier);
      return;
    }
    void moveAction.run(() => move(supplier, to));
  };

  const counts = PO_STATUSES.map((value) => ({
    status: value,
    count: detail.suppliers.filter((supplier) => supplier.status === value).length,
  })).filter((entry) => entry.count > 0);
  const shown =
    status === null
      ? detail.suppliers
      : detail.suppliers.filter((supplier) => supplier.status === status);
  const totals = sumOf(detail.suppliers);

  // The groups: one per orderer, the suppliers without one last, each sorted by name already.
  const groups = new Map<number | null, PurchaseOrderSupplier[]>();
  for (const supplier of shown) {
    const list = groups.get(supplier.ordererId) ?? [];
    list.push(supplier);
    groups.set(supplier.ordererId, list);
  }
  const ordered = [...groups.entries()].sort(([a, aList], [b, bList]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return (aList[0]?.ordererName ?? '').localeCompare(bList[0]?.ordererName ?? '');
  });

  return (
    <>
      <PageHeader
        title={detail.number}
        description={detail.note ?? undefined}
        crumbs={[{ label: t('procurement.orders.title'), to: '/procurement/orders' }]}
        meta={
          <>
            {detail.archivedAt !== null ? (
              <Badge variant="outline">{t('procurement.detail.archived')}</Badge>
            ) : null}
            <span className="font-mono">{detail.orderDate}</span>
            {detail.createdBy ? (
              <span>{t('procurement.order.createdBy', { name: detail.createdBy })}</span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw aria-hidden />
              {t('procurement.overview.refresh')}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`${base}/history`}>
                <History aria-hidden />
                {t('procurement.history.title')}
              </Link>
            </Button>
            <Button asChild>
              <Link to={`${base}/detail`}>
                <Table2 aria-hidden />
                {t('procurement.overview.detail')}
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Tile label={t('procurement.overview.suppliers')} value={formatCount(totals.suppliers)} />
        <Tile label={t('procurement.overview.boxes')} value={formatQty(totals.boxes.toFixed())} />
        <Tile label={t('procurement.overview.pieces')} value={formatQty(totals.pieces.toFixed())} />
        <Tile
          label={t('procurement.overview.kg')}
          value={t('procurement.supplier.kg', {
            kg: formatQty(totals.kg.toDecimalPlaces(1).toString()),
          })}
        />
        {canPrices ? (
          <Tile
            label={t('procurement.overview.estimated')}
            value={formatTugrik(totals.estimated.toFixed(2))}
          />
        ) : null}
        {canPrices && !totals.final.isZero() ? (
          <Tile
            label={t('procurement.overview.final')}
            value={formatTugrik(totals.final.toFixed(2))}
          />
        ) : null}
      </div>

      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('procurement.overview.statuses')}
      >
        <FilterToggle
          label={`${t('procurement.overview.all')} · ${formatCount(detail.suppliers.length)}`}
          checked={status === null}
          onCheckedChange={() => setStatus(null)}
        />
        {counts.map((entry) => (
          <FilterToggle
            key={entry.status}
            label={`${t(`procurement.status.${entry.status}`)} · ${formatCount(entry.count)}`}
            checked={status === entry.status}
            onCheckedChange={(checked) => setStatus(checked ? entry.status : null)}
          />
        ))}
      </div>

      <ProblemAlert problem={moveAction.problem} />
      {ordered.length === 0 ? (
        <EmptyState title={t('procurement.overview.empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map(([ordererId, suppliers]) => (
            <OrdererGroup
              key={ordererId ?? 'none'}
              base={base}
              orderId={detail.id}
              ordererId={ordererId}
              name={suppliers[0]?.ordererName ?? null}
              suppliers={suppliers}
              canPrices={canPrices}
              open={ordered.length <= 3}
              onStep={step}
            />
          ))}
        </div>
      )}
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
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
      <p className="font-mono text-[24px] leading-tight font-semibold">{value}</p>
    </section>
  );
}

/** One orderer's suppliers: the header with the group's totals, the rows under it when opened. */
function OrdererGroup(props: {
  base: string;
  orderId: number;
  ordererId: number | null;
  name: string | null;
  suppliers: readonly PurchaseOrderSupplier[];
  canPrices: boolean;
  open: boolean;
  onStep: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(props.open);
  const totals = sumOf(props.suppliers);
  const name = props.name ?? t('procurement.supplier.noOrderer');
  const counts = PO_STATUSES.map((value) => ({
    status: value,
    count: props.suppliers.filter((supplier) => supplier.status === value).length,
  })).filter((entry) => entry.count > 0);

  return (
    <section aria-label={name} className="rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span className="truncate text-[15px] font-semibold">{name}</span>
        </button>
        <span className="text-[13px] text-muted-foreground">
          {t('procurement.overview.groupSummary', {
            suppliers: formatCount(totals.suppliers),
            boxes: formatQty(totals.boxes.toFixed()),
            pieces: formatQty(totals.pieces.toFixed()),
            kg: formatQty(totals.kg.toDecimalPlaces(1).toString()),
          })}
        </span>
        {props.canPrices ? (
          <span className="font-mono text-[13px]">{formatTugrik(totals.estimated.toFixed(2))}</span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5">
          {counts.map((entry) => (
            <StatusCountBadge key={entry.status} status={entry.status} count={entry.count} />
          ))}
        </span>
        {props.ordererId !== null ? (
          <Button variant="ghost" size="sm" className="ml-auto text-link" asChild>
            <Link
              to={`${props.base}/detail?orderer=${props.ordererId}`}
              aria-label={t('procurement.overview.openOrderer', { name })}
            >
              {t('procurement.overview.detail')}
            </Link>
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border/80 p-3">
          {props.suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.supplierId}
              base={props.base}
              orderId={props.orderId}
              supplier={supplier}
              canPrices={props.canPrices}
              onStep={props.onStep}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** A supplier as a card: its status, orderer and totals; «Бараа харах» unfolds its ordered lines. */
function SupplierCard(props: {
  base: string;
  orderId: number;
  supplier: PurchaseOrderSupplier;
  canPrices: boolean;
  onStep: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const [open, setOpen] = useState(false);
  const { supplier } = props;
  const to = `${props.base}/detail?supplier=${supplier.supplierId}`;
  const next = nextPoStatus(supplier.status);
  const previous = previousPoStatus(supplier.status);
  const ordered = new Decimal(supplier.qtyBase);
  const percent = ordered.isZero()
    ? '0'
    : Decimal.min(new Decimal(supplier.shippedBase).div(ordered).times(100).floor(), 100).toFixed();
  return (
    <section
      aria-label={supplier.supplierName}
      className="rounded-lg border border-border/80 bg-background"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <Link to={to} className="text-[14px] font-semibold underline-offset-4 hover:underline">
          {supplier.supplierName}
        </Link>
        <PoStatusBadge status={supplier.status} />
        {canManage ? (
          <OrdererSelect supplierId={supplier.supplierId} current={supplier.ordererId} />
        ) : supplier.ordererName ? (
          <span className="text-[13px] text-muted-foreground">{supplier.ordererName}</span>
        ) : null}
        <span className="text-[13px] text-muted-foreground">
          {t('procurement.overview.supplierSummary', {
            lines: formatCount(supplier.lineCount),
            boxes: formatQty(supplier.boxes),
            kg: formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString()),
          })}
        </span>
        {props.canPrices && supplier.estimatedCost ? (
          <span className="font-mono text-[13px]">{formatTugrik(supplier.estimatedCost)}</span>
        ) : null}
        <span
          className="ml-auto flex items-center gap-1.5"
          aria-label={t('procurement.overview.shippedShare')}
        >
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-fill">
            <span className="block h-full bg-success" style={{ width: `${percent}%` }} />
          </span>
          <span className="font-mono text-[12px] text-muted-foreground">{percent}%</span>
        </span>
        <span className="flex items-center gap-1">
          {supplier.canMoveBack && previous ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('procurement.supplier.backNamed', { name: supplier.supplierName })}
              onClick={() => props.onStep(supplier, -1)}
            >
              {t('procurement.supplier.backTo', { status: t(`procurement.status.${previous}`) })}
            </Button>
          ) : null}
          {supplier.canMoveNext && next ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={t('procurement.supplier.nextNamed', { name: supplier.supplierName })}
              onClick={() => props.onStep(supplier, 1)}
            >
              {t('procurement.supplier.nextTo', { status: t(`procurement.status.${next}`) })}
            </Button>
          ) : null}
          {supplier.lineCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronDown
                aria-hidden
                className={cn('size-4 transition-transform', !open && '-rotate-90')}
              />
              {t(open ? 'common.close' : 'procurement.overview.showLines')}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link
              to={to}
              aria-label={t('procurement.overview.openSupplier', { name: supplier.supplierName })}
            >
              {t('procurement.overview.detail')}
            </Link>
          </Button>
        </span>
      </div>
      {open ? <SupplierLines orderId={props.orderId} supplierId={supplier.supplierId} /> : null}
    </section>
  );
}

/** The supplier's orderer, changed in place by a manager (the supplier's setting, not the order's). */
function OrdererSelect({ supplierId, current }: { supplierId: number; current: number | null }) {
  const { t } = useTranslation();
  const candidates = useOrdererCandidates(true);
  const save = useSetSupplierOrderer(supplierId);
  const action = useAction();
  return (
    <span className="flex items-center gap-2">
      <NativeSelect
        variant="filter"
        aria-label={t('procurement.orderer.field')}
        value={current === null ? '' : String(current)}
        disabled={save.isPending}
        onChange={(event) => {
          const value = event.target.value;
          void action.run(async () => {
            await save.mutateAsync(value === '' ? null : Number.parseInt(value, 10));
          });
        }}
      >
        <option value="">{t('procurement.orderer.none')}</option>
        {(candidates.data ?? []).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.fullName}
          </option>
        ))}
      </NativeSelect>
      <ProblemAlert problem={action.problem} />
    </span>
  );
}

/** The supplier's ordered lines (200 a page): code, name, ordered, shipped and what is still to come. */
function SupplierLines({ orderId, supplierId }: { orderId: number; supplierId: number }) {
  const { t } = useTranslation();
  const rows = usePurchaseOrderRows(orderId, supplierId, { filter: 'ORDERED' });
  const data = rows.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className="border-t border-border/80">
      <ProblemAlert problem={problemFromError(rows.error)} onRetry={rows.refetch} />
      {rows.isPending ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : null}
      {data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('procurement.detail.columns.sku')}</TableHead>
              <TableHead>{t('procurement.detail.columns.name')}</TableHead>
              <TableHead className="text-right">{t('procurement.overview.ordered')}</TableHead>
              <TableHead className="text-right">
                {t('procurement.detail.columns.shipped')}
              </TableHead>
              <TableHead className="text-right">{t('procurement.overview.remaining')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <LineRow key={row.productId} row={row} />
            ))}
          </TableBody>
        </Table>
      ) : null}
      <LoadMore query={rows} />
    </div>
  );
}

function LineRow({ row }: { row: GridRow }) {
  const line = row.line;
  if (!line) return null;
  const unit = row.units.find((candidate) => candidate.id === line.productUnitId);
  const shipped = line.shippedQty === null ? null : new Decimal(line.shippedQty);
  const remaining = shipped === null ? new Decimal(line.qty) : new Decimal(line.qty).minus(shipped);
  return (
    <TableRow>
      <TableCell className="font-mono">{row.sku}</TableCell>
      <TableCell>{row.name}</TableCell>
      <TableCell className="text-right font-mono">
        {formatQty(line.qty)}
        {unit ? ` ${unit.name}` : ''}
      </TableCell>
      <TableCell
        className={cn('text-right font-mono', shipped && !shipped.isZero() && 'text-success')}
      >
        {shipped ? formatQty(shipped.toFixed()) : formatQty('0')}
      </TableCell>
      <TableCell className={cn('text-right font-mono', !remaining.isZero() && 'text-warning')}>
        {formatQty(remaining.toFixed())}
      </TableCell>
    </TableRow>
  );
}
