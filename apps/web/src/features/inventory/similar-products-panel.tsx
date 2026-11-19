import { Decimal } from '@tugeel/shared/money';
import { presetRange } from '@tugeel/shared/reports';
import { addDays, businessDate } from '@tugeel/shared/time';
import { ChevronDown, FileBarChart, History, Sparkles } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ListTable, TruncateCell } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { onHandIn, type ProductStock, useSimilarProducts, useStockWarehouses } from './api';
import { useWarehouseName } from './helpers';

const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------------------------
// «Тайлан»: a product's stock report and movements over a period, in one click (owner 2026-11-20)

type Period = 'thisMonth' | 'lastMonth' | 'last7' | 'thisYear';
const PERIODS: readonly Period[] = ['thisMonth', 'lastMonth', 'last7', 'thisYear'];

function rangeOf(period: Period): { from: string; to: string } {
  const today = businessDate();
  if (period === 'last7') return { from: addDays(today, -6), to: today };
  return presetRange(period, today);
}

/**
 * «Бараа материалын үлдэгдэл» of these products over a period: `pr` once per product, and its
 * label `prn` in the same place when every product has one (the report's prompt shows them).
 */
function stockReportHref(
  productIds: readonly number[],
  range: { from: string; to: string },
  labels: readonly string[],
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  for (const id of productIds) params.append('pr', String(id));
  if (labels.length === productIds.length) {
    for (const label of labels) params.append('prn', label);
  }
  return `/reports/stock-balance?${params.toString()}`;
}

/** The movement history of one product over a period. */
function movementsHref(productId: number, range: { from: string; to: string }): string {
  const params = new URLSearchParams({
    product: String(productId),
    from: range.from,
    to: range.to,
  });
  return `/inventory/movements?${params.toString()}`;
}

/**
 * The «Тайлан» menu of a product (or of the ticked similar products): the stock report over this
 * month, last month, the last 7 days, this year or chosen dates, each in a new tab; for one product
 * also its movements over the same periods, and «Төстэй бараа (AI)» when `onSimilar` is given.
 * It stops its clicks, so a list row it stands in does not open.
 */
export function StockReportMenu(props: {
  productIds: readonly number[];
  /** «SKU - name» of one product, shown on the report's prompt. */
  label?: string;
  /** «SKU - name» of each product, in the order of `productIds` (several products). */
  labels?: readonly string[];
  trigger: 'icon' | 'button';
  /** The trigger's text when it is a button (default «Тайлан»). */
  text?: string;
  onSimilar?: () => void;
}) {
  const { t } = useTranslation();
  const canReports = useHasPermission('reports.view');
  const [choosing, setChoosing] = useState(false);
  const single = props.productIds.length === 1 ? props.productIds[0] : undefined;
  const labels = props.labels ?? (props.label === undefined ? [] : [props.label]);
  if (!canReports && single === undefined && !props.onSimilar) return null;
  const text = props.text ?? t('inventory.stock.report.action');
  const periodLabel = (period: Period) => t(`inventory.stock.report.periods.${period}`);
  return (
    // Portals bubble through React: the menu's and the dialog's clicks stay out of the row.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {props.trigger === 'icon' ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground touch:after:w-full!"
              aria-label={props.label ? `${text}: ${props.label}` : text}
              title={text}
            >
              <FileBarChart />
            </Button>
          ) : (
            <Button type="button" variant="outline">
              <FileBarChart />
              {text}
              <ChevronDown aria-hidden className="size-4 opacity-60" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canReports ? (
            <>
              <DropdownMenuLabel>{t('nav.reportsStockBalance')}</DropdownMenuLabel>
              {PERIODS.map((period) => (
                <DropdownMenuItem key={period} asChild>
                  <Link
                    to={stockReportHref(props.productIds, rangeOf(period), labels)}
                    target="_blank"
                  >
                    {periodLabel(period)}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setChoosing(true)}>
                {t('inventory.stock.report.periods.choose')}
              </DropdownMenuItem>
            </>
          ) : null}
          {single !== undefined ? (
            <>
              {canReports ? <DropdownMenuSeparator /> : null}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <History />
                  {t('inventory.stock.report.movements')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {PERIODS.map((period) => (
                    <DropdownMenuItem key={period} asChild>
                      <Link to={movementsHref(single, rangeOf(period))} target="_blank">
                        {periodLabel(period)}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => setChoosing(true)}>
                    {t('inventory.stock.report.periods.choose')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
          {props.onSimilar ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={props.onSimilar}>
                <Sparkles />
                {t('inventory.stock.similar.action')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <RangeDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        productIds={props.productIds}
        labels={labels}
        canReports={canReports}
      />
    </span>
  );
}

/** «Хугацаа сонгох…»: dates from – to, then the report or the movements over them. */
function RangeDialog(props: {
  open: boolean;
  onClose: () => void;
  productIds: readonly number[];
  labels: readonly string[];
  canReports: boolean;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState(() => rangeOf('thisMonth'));
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const single = props.productIds.length === 1 ? props.productIds[0] : undefined;
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="sm" guard={false}>
        <DialogHeader>
          <DialogTitle>{t('inventory.stock.report.rangeTitle')}</DialogTitle>
          <DialogDescription>
            {props.labels.length === 1 ? props.labels[0] : t('inventory.stock.report.rangeHint')}
          </DialogDescription>
        </DialogHeader>
        <DateRangeFilter
          label={t('inventory.stock.report.range')}
          fromLabel={t('inventory.stock.report.from')}
          toLabel={t('inventory.stock.report.to')}
          from={range.from}
          to={range.to}
          onFrom={(from) => setRange((current) => ({ ...current, from: from ?? '' }))}
          onTo={(to) => setRange((current) => ({ ...current, to: to ?? '' }))}
        />
        <DialogFooter>
          {single !== undefined ? (
            <OpenButton
              variant="outline"
              to={valid ? movementsHref(single, range) : null}
              onOpen={props.onClose}
            >
              <History />
              {t('inventory.stock.report.movements')}
            </OpenButton>
          ) : null}
          {props.canReports ? (
            <OpenButton
              variant="default"
              to={valid ? stockReportHref(props.productIds, range, props.labels) : null}
              onOpen={props.onClose}
            >
              <FileBarChart />
              {t('inventory.stock.report.action')}
            </OpenButton>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A link in a new tab that looks like a button; a disabled button while it has nowhere to go. */
function OpenButton(props: {
  variant: 'default' | 'outline';
  to: string | null;
  onOpen: () => void;
  children: ReactNode;
}) {
  if (props.to === null) {
    return (
      <Button variant={props.variant} disabled>
        {props.children}
      </Button>
    );
  }
  return (
    <Button variant={props.variant} asChild>
      <Link to={props.to} target="_blank" onClick={props.onOpen}>
        {props.children}
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// «Төстэй бараа (AI)» (ADR-0231)

/**
 * The product and those of its kind and size (all kinds of «Лапша 3кг»), their on hand per
 * warehouse with the warehouses holding none left out, and a total of the ticked ones. A product
 * can be unticked; «Бүгдийн тайлан» opens the stock report of the ticked ones.
 */
export function SimilarProductsDialog(props: {
  productId: number | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={props.productId !== undefined}
      onOpenChange={(open) => (open ? undefined : props.onClose())}
    >
      <DialogContent size="xl" guard={false}>
        {props.productId === undefined ? null : (
          <SimilarProductsBody key={props.productId} productId={props.productId} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimilarProductsBody({ productId }: { productId: number }) {
  const { t } = useTranslation();
  const similar = useSimilarProducts(productId);
  const rows = useMemo(() => similar.data?.data ?? [], [similar.data]);
  const warehouses = useStockWarehouses(rows);
  const warehouseName = useWarehouseName();
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  const ticked = rows.filter((row) => !unticked.has(row.product.id));
  const source = rows.find((row) => row.product.id === productId);
  const columns: ColumnSpec[] = [
    { key: 'check', kind: 'check' },
    { key: 'product', kind: 'text', weight: 3, min: 12 },
    ...warehouses.map((id): ColumnSpec => ({ key: `w${id}`, kind: 'qty', width: 7 })),
    { key: 'onHand', kind: 'qty', width: 8.5 },
  ];
  const total = (pick: (row: ProductStock) => string | null) =>
    ticked.reduce((sum, row) => sum.plus(pick(row) ?? ZERO), ZERO).toFixed();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('inventory.stock.similar.title')}</DialogTitle>
        <DialogDescription>
          {source ? source.product.name : null}
          {similar.data ? (
            <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {similar.data.method === 'AI'
                ? t('inventory.stock.similar.byAi')
                : t('inventory.stock.similar.byName')}
            </span>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <ProblemAlert problem={problemFromError(similar.error)} onRetry={similar.refetch} />
      {similar.isPending ? (
        <p className="text-sm text-muted-foreground">{t('inventory.stock.similar.loading')}</p>
      ) : null}
      {similar.data ? (
        <div className="min-w-0 overflow-x-auto">
          <ListTable columns={columns}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">{t('inventory.stock.similar.pick')}</span>
                </TableHead>
                <TableHead>{t('inventory.product')}</TableHead>
                {warehouses.map((id) => (
                  <TableHead key={id} className="truncate text-right" title={warehouseName(id)}>
                    {warehouseName(id)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t('inventory.stock.onHand')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const checked = !unticked.has(row.product.id);
                return (
                  <TableRow key={row.product.id} data-state={checked ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        aria-label={`${t('inventory.stock.similar.pick')}: ${row.product.name}`}
                        onCheckedChange={(value) =>
                          setUnticked((current) => {
                            const next = new Set(current);
                            if (value === true) next.delete(row.product.id);
                            else next.add(row.product.id);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TruncateCell text={`${row.product.sku} · ${row.product.name}`}>
                      <Link
                        to={`/inventory/stock/${row.product.id}`}
                        target="_blank"
                        className="underline-offset-4 hover:underline"
                      >
                        <span className="font-mono text-muted-foreground">{row.product.sku}</span>{' '}
                        <span
                          className={row.product.id === productId ? 'font-semibold' : undefined}
                        >
                          {row.product.name}
                        </span>
                      </Link>
                    </TruncateCell>
                    {warehouses.map((id) => {
                      const qty = onHandIn(row, id);
                      return (
                        <TableCell key={id} className="text-right font-mono">
                          {qty === null ? '' : formatQty(qty)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', {
                        qty: formatQty(row.onHand),
                        unit: row.product.baseUnitName,
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell />
                <TableCell className="font-medium">
                  {t('inventory.stock.similar.total', { count: ticked.length })}
                </TableCell>
                {warehouses.map((id) => (
                  <TableCell key={id} className="text-right font-mono font-medium">
                    {formatQty(total((row) => onHandIn(row, id)))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono font-medium">
                  {formatQty(total((row) => row.onHand))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </ListTable>
          {rows.length <= 1 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('inventory.stock.similar.none')}
            </p>
          ) : null}
        </div>
      ) : null}
      {ticked.length > 0 ? <ReportAll rows={ticked} /> : null}
    </>
  );
}

/** «Бүгдийн тайлан»: the stock report of the ticked products over a period. */
function ReportAll({ rows }: { rows: readonly ProductStock[] }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <StockReportMenu
        productIds={rows.map((row) => row.product.id)}
        labels={rows.map((row) => `${row.product.sku} - ${row.product.name}`)}
        trigger="button"
        text={t('inventory.stock.similar.reportAll')}
      />
    </div>
  );
}
