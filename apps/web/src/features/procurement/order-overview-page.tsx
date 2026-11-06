import { Decimal } from '@tugeel/shared/money';
import { nextPoStatus, previousPoStatus } from '@tugeel/shared/procurement';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import {
  ArrowRight,
  ChevronDown,
  Ellipsis,
  History,
  PackagePlus,
  RefreshCw,
  ScanSearch,
  Search,
  Table2,
  Truck as TruckIcon,
  UserRound,
} from 'lucide-react';
import { type CSSProperties, useDeferredValue, useState } from 'react';
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
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { AddProductDialog } from './add-product-dialog';
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
import { InvoiceCheckPanel } from './invoice-check-panel';
import { LoadsPanel } from './order-loads-panel';

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
  const canManage = useHasPermission('procurement.orders.manage');
  const [status, setStatus] = useState<PoStatus | null>(null);
  const base = `/procurement/orders/${detail.id}`;
  const truckOfLoad = new Map(detail.loads.map((load) => [load.id, load.truckName]));

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

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
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
                  truckOfLoad={truckOfLoad}
                />
              ))}
            </div>
          )}
        </div>
        <LoadsPanel detail={detail} canManage={canManage && detail.archivedAt === null} />
      </div>
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
      <h2 className="text-[0.8125rem] font-medium text-muted-foreground">{label}</h2>
      <p className="font-mono text-[1.5rem] leading-tight font-semibold">{value}</p>
    </section>
  );
}

/** A status's colours, here only: this board has its own look (owner 2026-11-06). */
const STATUS_TONE: Record<PoStatus, { pill: string; dot: string }> = {
  PREPARING: { pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-300' },
  SENT: { pill: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  SHIPPING: { pill: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  IN_TRANSIT: { pill: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  ARRIVED: { pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  ACCOUNTING: { pill: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  RECEIVED: { pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
};

function StatusPill({ status, count }: { status: PoStatus; count?: number }) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone.pill,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', tone.dot)} />
      {t(`procurement.status.${status}`)}
      {count === undefined ? null : <span className="font-mono">{formatCount(count)}</span>}
    </span>
  );
}

/** Rows drawn at once; a group can hold every supplier of the company. */
const PAGE_ROWS = 30;
type RowTab = 'with' | 'empty' | 'all';

/** A zero says nothing in a long list: it recedes to a dash. */
const orDash = (value: Decimal, text: string) => (value.isZero() ? '—' : text);

function GroupStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[0.6875rem] text-slate-500">{label}</span>
      <span className="font-mono text-[0.875rem] font-semibold text-slate-900">{value}</span>
    </span>
  );
}

/**
 * One orderer's suppliers (owner 2026-11-06: its own look, not the system's): a header that opens
 * and closes with the group's totals; inside, a search and «Бараатай / Бараагүй», then aligned rows
 * under one header. Suppliers with goods come first; a long list draws by the page.
 */
function OrdererGroup(props: {
  base: string;
  orderId: number;
  ordererId: number | null;
  name: string | null;
  suppliers: readonly PurchaseOrderSupplier[];
  canPrices: boolean;
  open: boolean;
  onStep: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
  truckOfLoad: ReadonlyMap<number, string>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(props.open);
  const [tab, setTab] = useState<RowTab>('with');
  const [search, setSearch] = useState('');
  const [shownRows, setShownRows] = useState(PAGE_ROWS);
  const q = useDeferredValue(search.trim());
  const totals = sumOf(props.suppliers);
  const name = props.name ?? t('procurement.supplier.noOrderer');
  const onLoad = props.suppliers.filter((supplier) => supplier.loadIds.length > 0).length;
  const counts = PO_STATUSES.map((value) => ({
    status: value,
    count: props.suppliers.filter((supplier) => supplier.status === value).length,
  })).filter((entry) => entry.count > 0);

  const withLines = props.suppliers.filter((supplier) => supplier.lineCount > 0);
  const withoutLines = props.suppliers.filter((supplier) => supplier.lineCount === 0);
  // A tab with nothing in it is not a place to stay.
  const current: RowTab =
    (tab === 'with' && withLines.length === 0) || (tab === 'empty' && withoutLines.length === 0)
      ? 'all'
      : tab;
  const inTab =
    current === 'with'
      ? withLines
      : current === 'empty'
        ? withoutLines
        : [...withLines, ...withoutLines];
  const terms = queryTerms(q);
  const matches =
    terms.length === 0
      ? inTab
      : inTab.filter((supplier) =>
          matchesQuery(searchKeys(supplier.supplierName, [supplier.supplierCode]), terms),
        );
  const rows = matches.slice(0, shownRows);
  const columns = props.canPrices
    ? 'minmax(11rem,1fr) 6.5rem 8.5rem 3rem 4rem 4.5rem 6rem 5.5rem 11.5rem'
    : 'minmax(11rem,1fr) 6.5rem 8.5rem 3rem 4rem 4.5rem 5.5rem 11.5rem';

  return (
    <section
      aria-label={name}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-slate-400 transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold',
              props.ordererId === null
                ? 'bg-slate-100 text-slate-500'
                : 'bg-indigo-100 text-indigo-700',
            )}
          >
            {props.ordererId === null ? <UserRound className="size-4" /> : name.slice(0, 1)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[0.9375rem] font-semibold text-slate-900">{name}</span>
            <span className="truncate text-xs text-slate-500">
              {t('procurement.overview.groupCount', { count: formatCount(totals.suppliers) })}
              {' · '}
              {t('procurement.overview.onLoad', {
                on: formatCount(onLoad),
                off: formatCount(props.suppliers.length - onLoad),
              })}
            </span>
          </span>
        </button>
        <span className="flex flex-wrap items-center gap-1.5">
          {counts.map((entry) => (
            <StatusPill key={entry.status} status={entry.status} count={entry.count} />
          ))}
        </span>
        <span className="flex items-center gap-5">
          <GroupStat
            label={t('procurement.overview.boxes')}
            value={orDash(totals.boxes, formatQty(totals.boxes.toFixed()))}
          />
          <GroupStat
            label={t('procurement.overview.kg')}
            value={orDash(totals.kg, formatQty(totals.kg.toDecimalPlaces(1).toString()))}
          />
          {props.canPrices ? (
            <GroupStat
              label={t('procurement.overview.amountShort')}
              value={orDash(totals.estimated, formatTugrik(totals.estimated.toFixed(2)))}
            />
          ) : null}
        </span>
        {props.ordererId !== null ? (
          <Link
            to={`${props.base}/detail?orderer=${props.ordererId}`}
            aria-label={t('procurement.overview.openOrderer', { name })}
            className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-indigo-600 hover:text-indigo-800"
          >
            {t('procurement.overview.detail')}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-slate-200">
          {(withLines.length > 0 && withoutLines.length > 0) || props.suppliers.length > 8 ? (
            <div className="flex flex-wrap items-center gap-3 bg-slate-50/70 px-4 py-2">
              {withLines.length > 0 && withoutLines.length > 0 ? (
                <div
                  role="tablist"
                  aria-label={name}
                  className="inline-flex rounded-lg bg-slate-200/60 p-0.5"
                >
                  {(
                    [
                      ['with', withLines.length],
                      ['empty', withoutLines.length],
                      ['all', props.suppliers.length],
                    ] as const
                  ).map(([value, count]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={current === value}
                      className={cn(
                        'rounded-md px-3 py-1 text-[0.8125rem] font-medium',
                        current === value
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                      onClick={() => {
                        setTab(value);
                        setShownRows(PAGE_ROWS);
                      }}
                    >
                      {t(`procurement.overview.tabs.${value}`)}
                      <span className="ml-1.5 font-mono text-xs text-slate-500">
                        {formatCount(count)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {props.suppliers.length > 8 ? (
                <label className="relative ml-auto w-full max-w-72">
                  <span className="sr-only">{t('procurement.overview.searchSuppliers')}</span>
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={search}
                    placeholder={t('procurement.overview.searchSuppliers')}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pr-2 pl-8 text-[0.8125rem] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setShownRows(PAGE_ROWS);
                    }}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="@container" style={{ '--po-columns': columns } as CSSProperties}>
            <div className="hidden items-center gap-x-3 border-y border-slate-100 py-1.5 pr-3 pl-4 text-[0.6875rem] font-medium tracking-wide text-slate-500 uppercase @[68rem]:grid @[68rem]:[grid-template-columns:var(--po-columns)]">
              <span className="pl-6">{t('procurement.overview.suppliers')}</span>
              <span>{t('procurement.overview.columnStatus')}</span>
              <span>{t('procurement.orderer.field')}</span>
              <span className="text-right">{t('procurement.overview.lines')}</span>
              <span className="text-right">{t('procurement.overview.boxes')}</span>
              <span className="text-right">{t('procurement.overview.kg')}</span>
              {props.canPrices ? (
                <span className="text-right">{t('procurement.overview.amountShort')}</span>
              ) : null}
              <span className="pl-2">{t('procurement.overview.shippedShort')}</span>
              <span className="sr-only">{t('common.actions')}</span>
            </div>
            {rows.map((supplier) => (
              <SupplierRow
                key={supplier.supplierId}
                base={props.base}
                orderId={props.orderId}
                supplier={supplier}
                canPrices={props.canPrices}
                onStep={props.onStep}
                truckNames={supplier.loadIds.flatMap((id) => {
                  const truck = props.truckOfLoad.get(id);
                  return truck === undefined ? [] : [truck];
                })}
              />
            ))}
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                {t('procurement.overview.noMatch')}
              </p>
            ) : null}
            {matches.length > rows.length ? (
              <button
                type="button"
                className="w-full border-t border-slate-100 py-2.5 text-[0.8125rem] font-medium text-indigo-600 hover:bg-slate-50"
                onClick={() => setShownRows((value) => value + PAGE_ROWS)}
              >
                {t('procurement.overview.showMore', {
                  count: formatCount(Math.min(PAGE_ROWS, matches.length - rows.length)),
                  left: formatCount(matches.length - rows.length),
                })}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A supplier in one aligned row: a coloured edge for its status, a chevron that unfolds its lines,
 * the numbers in their columns, one main action (the next status, or «Бараа нэмэх» while it has no
 * goods) and the rest behind «⋯».
 */
function SupplierRow(props: {
  base: string;
  orderId: number;
  supplier: PurchaseOrderSupplier;
  canPrices: boolean;
  onStep: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
  truckNames: string[];
}) {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const canCosts = useHasPermission('inventory.costs.manage');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const { supplier } = props;
  const loaded = new Decimal(supplier.loadedBoxes);
  const boxes = new Decimal(supplier.boxes);
  const kg = new Decimal(supplier.weightKg);
  const partlyLoaded = loaded.gt(0) && loaded.lt(boxes);
  const to = `${props.base}/detail?supplier=${supplier.supplierId}`;
  const next = nextPoStatus(supplier.status);
  const previous = previousPoStatus(supplier.status);
  const ordered = new Decimal(supplier.qtyBase);
  const empty = supplier.lineCount === 0;
  const percent = ordered.isZero()
    ? '0'
    : Decimal.min(new Decimal(supplier.shippedBase).div(ordered).times(100).floor(), 100).toFixed();
  const mainIsNext = !empty && supplier.canMoveNext && next !== null;
  const mainIsAdd = !mainIsNext && supplier.canEdit;
  const nextLabel = next
    ? t('procurement.supplier.nextTo', { status: t(`procurement.status.${next}`) })
    : '';

  return (
    <section
      aria-label={supplier.supplierName}
      className="relative border-b border-slate-100 last:border-b-0"
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          empty ? 'bg-slate-200' : STATUS_TONE[supplier.status].dot,
        )}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 pr-3 pl-4 transition-colors hover:bg-slate-50 @[68rem]:grid @[68rem]:[grid-template-columns:var(--po-columns)]">
        <div className="flex w-full min-w-0 items-center gap-1 @[68rem]:w-auto">
          {empty ? (
            <span aria-hidden className="size-5 shrink-0" />
          ) : (
            <button
              type="button"
              aria-expanded={open}
              aria-label={t('procurement.overview.showLinesNamed', {
                name: supplier.supplierName,
              })}
              className="flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronDown
                aria-hidden
                className={cn('size-4 transition-transform', !open && '-rotate-90')}
              />
            </button>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              to={to}
              title={supplier.supplierName}
              className={cn(
                'line-clamp-2 text-[0.875rem] leading-snug underline-offset-4 hover:underline',
                empty ? 'text-slate-600' : 'font-semibold text-slate-900',
              )}
            >
              {supplier.supplierName}
            </Link>
            {props.truckNames.length > 0 || partlyLoaded ? (
              <span className="flex flex-wrap items-center gap-1">
                {props.truckNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[0.6875rem] text-slate-600"
                  >
                    <TruckIcon aria-hidden className="size-3" />
                    {name}
                  </span>
                ))}
                {partlyLoaded ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[0.6875rem] text-amber-700">
                    {t('procurement.overview.loadedOf', {
                      loaded: formatQty(loaded.toFixed()),
                      boxes: formatQty(supplier.boxes),
                    })}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill status={supplier.status} />
        <div className="w-40 max-w-full min-w-0 @[68rem]:w-auto">
          {canManage ? (
            <OrdererSelect supplierId={supplier.supplierId} current={supplier.ordererId} />
          ) : (
            <span className="truncate text-[0.8125rem] text-slate-500">
              {supplier.ordererName ?? '—'}
            </span>
          )}
        </div>
        {/* A narrow window has no columns: the numbers read as one line. */}
        {empty ? (
          <span
            className={cn(
              'text-xs text-slate-400',
              props.canPrices ? '@[68rem]:col-span-5' : '@[68rem]:col-span-4',
            )}
          >
            {t('procurement.overview.noGoods')}
          </span>
        ) : (
          <>
            <span className="text-xs text-slate-500 @[68rem]:hidden">
              {t('procurement.overview.supplierSummary', {
                lines: formatCount(supplier.lineCount),
                boxes: formatQty(supplier.boxes),
                kg: formatQty(kg.toDecimalPlaces(1).toString()),
              })}
            </span>
            <NumberCell text={formatCount(supplier.lineCount)} />
            <NumberCell text={orDash(boxes, formatQty(supplier.boxes))} />
            <NumberCell text={orDash(kg, formatQty(kg.toDecimalPlaces(1).toString()))} />
            {props.canPrices ? (
              <NumberCell
                text={
                  supplier.estimatedCost && !new Decimal(supplier.estimatedCost).isZero()
                    ? formatTugrik(supplier.estimatedCost)
                    : '—'
                }
              />
            ) : null}
            <span
              className="hidden items-center gap-1.5 pl-2 @[68rem]:flex"
              aria-label={t('procurement.overview.shippedShare')}
            >
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full bg-emerald-500" style={{ width: `${percent}%` }} />
              </span>
              <span className="w-8 text-right font-mono text-[0.6875rem] text-slate-500">
                {percent}%
              </span>
            </span>
          </>
        )}
        <span className="ml-auto flex items-center justify-end gap-1">
          {mainIsNext ? (
            <button
              type="button"
              aria-label={t('procurement.supplier.nextNamed', { name: supplier.supplierName })}
              title={nextLabel}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-white hover:bg-indigo-700"
              onClick={() => props.onStep(supplier, 1)}
            >
              <ArrowRight aria-hidden className="size-3.5" />
              {next ? t(`procurement.status.${next}`) : null}
            </button>
          ) : mainIsAdd ? (
            <button
              type="button"
              aria-label={t('procurement.overview.addProductNamed', {
                name: supplier.supplierName,
              })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
              onClick={() => setAdding(true)}
            >
              <PackagePlus aria-hidden className="size-4" />
              {t('procurement.overview.addProduct')}
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('procurement.overview.moreNamed', { name: supplier.supplierName })}
              className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            >
              <Ellipsis aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!mainIsNext && supplier.canMoveNext && next ? (
                <DropdownMenuItem onSelect={() => props.onStep(supplier, 1)}>
                  {nextLabel}
                </DropdownMenuItem>
              ) : null}
              {supplier.canMoveBack && previous ? (
                <DropdownMenuItem onSelect={() => props.onStep(supplier, -1)}>
                  {t('procurement.supplier.backTo', {
                    status: t(`procurement.status.${previous}`),
                  })}
                </DropdownMenuItem>
              ) : null}
              {!mainIsAdd && supplier.canEdit ? (
                <DropdownMenuItem onSelect={() => setAdding(true)}>
                  <PackagePlus aria-hidden className="size-4" />
                  {t('procurement.overview.addProduct')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setChecking((value) => !value)}>
                <ScanSearch aria-hidden className="size-4" />
                {t('procurement.overview.invoice')}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={to}>
                  <Table2 aria-hidden className="size-4" />
                  {t('procurement.overview.detail')}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {open ? <SupplierLines orderId={props.orderId} supplierId={supplier.supplierId} /> : null}
      {checking ? (
        <InvoiceCheckPanel
          orderId={props.orderId}
          supplierId={supplier.supplierId}
          supplierName={supplier.supplierName}
          canRun={canManage || canCosts || supplier.canEdit || supplier.canShip}
          canPrices={props.canPrices}
        />
      ) : null}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding ? (
          <AddProductDialog
            orderId={props.orderId}
            supplier={supplier}
            onClose={() => setAdding(false)}
            onAdded={() => setOpen(true)}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function NumberCell({ text }: { text: string }) {
  return (
    <span
      className={cn(
        'hidden text-right font-mono text-[0.8125rem] @[68rem]:block',
        text === '—' ? 'text-slate-300' : 'text-slate-800',
      )}
    >
      {text}
    </span>
  );
}

/** The supplier's orderer, changed in place by a manager (the supplier's setting, not the order's). */
function OrdererSelect({ supplierId, current }: { supplierId: number; current: number | null }) {
  const { t } = useTranslation();
  const candidates = useOrdererCandidates(true);
  const save = useSetSupplierOrderer(supplierId);
  const action = useAction();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <NativeSelect
        variant="filter"
        active={false}
        className={cn(
          'h-8 w-full max-w-full',
          current === null &&
            'border-transparent bg-transparent text-slate-500 shadow-none hover:border-slate-200',
        )}
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
