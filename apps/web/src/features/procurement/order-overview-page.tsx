import { Decimal } from '@tugeel/shared/money';
import { ChevronDown, History, RefreshCw, Table2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ChevronHead, EmptyState, FilterToggle, LinkRow, TruncateCell } from '@/components/list';
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
import { cn } from '@/lib/utils';
import {
  PO_STATUSES,
  type PoStatus,
  type PurchaseOrderDetail,
  type PurchaseOrderSupplier,
  usePurchaseOrder,
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

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

      {ordered.length === 0 ? (
        <EmptyState title={t('procurement.overview.empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map(([ordererId, suppliers]) => (
            <OrdererGroup
              key={ordererId ?? 'none'}
              base={base}
              ordererId={ordererId}
              name={suppliers[0]?.ordererName ?? null}
              suppliers={suppliers}
              canPrices={canPrices}
              open={ordered.length <= 3}
            />
          ))}
        </div>
      )}
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
  ordererId: number | null;
  name: string | null;
  suppliers: readonly PurchaseOrderSupplier[];
  canPrices: boolean;
  open: boolean;
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('procurement.overview.suppliers')}</TableHead>
              <TableHead>{t('procurement.orders.status')}</TableHead>
              <TableHead className="text-right">{t('procurement.overview.lines')}</TableHead>
              <TableHead className="text-right">{t('procurement.overview.boxes')}</TableHead>
              <TableHead className="text-right">{t('procurement.overview.pieces')}</TableHead>
              <TableHead className="text-right">{t('procurement.detail.columns.kg')}</TableHead>
              {props.canPrices ? (
                <TableHead className="text-right">{t('procurement.overview.estimated')}</TableHead>
              ) : null}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.suppliers.map((supplier) => (
              <LinkRow
                key={supplier.supplierId}
                to={`${props.base}/detail?supplier=${supplier.supplierId}`}
              >
                <TruncateCell text={supplier.supplierName}>
                  <Link
                    to={`${props.base}/detail?supplier=${supplier.supplierId}`}
                    className="font-medium underline-offset-4 hover:underline"
                    aria-label={t('procurement.overview.openSupplier', {
                      name: supplier.supplierName,
                    })}
                  >
                    {supplier.supplierName}
                  </Link>
                </TruncateCell>
                <TableCell>
                  <PoStatusBadge status={supplier.status} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCount(supplier.lineCount)}
                </TableCell>
                <TableCell className="text-right font-mono">{formatQty(supplier.boxes)}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatQty(supplier.qtyBase)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString())}
                </TableCell>
                {props.canPrices ? (
                  <TableCell className="text-right font-mono">
                    {supplier.estimatedCost ? formatTugrik(supplier.estimatedCost) : ''}
                  </TableCell>
                ) : null}
              </LinkRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
