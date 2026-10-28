import { Decimal } from '@tugeel/shared/money';
import { PackageSearch, Printer, TriangleAlert, X } from 'lucide-react';
import { type KeyboardEvent, useDeferredValue, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { parseCount } from '@/features/inventory/helpers';
import { formatCount, formatQty, formatTugrik, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type GridChange,
  type GridFilter,
  type GridRefusalReason,
  type GridRow,
  type GridUnit,
  type PurchaseOrderSupplier,
  usePurchaseOrderMutations,
  usePurchaseOrderRows,
} from './api';

const FILTERS: readonly GridFilter[] = ['ALL', 'ORDERED', 'BELOW_MIN'];

/**
 * A typed cell kept over the server's rows until it is saved: the unit and the text typed, with the
 * line as it was when the cell was first touched (`prev*`), so the server can skip a cell someone
 * else changed meanwhile (ADR-0115).
 */
interface Edit {
  productId: number;
  sku: string;
  name: string;
  units: GridUnit[];
  unitId: number;
  qty: string;
  prevUnitId: number | null;
  prevQty: string | null;
}

/** The largest unit (units come base first, then by factor): people order boxes. */
const defaultUnitId = (units: readonly GridUnit[]) => units[units.length - 1]?.id ?? 0;

/** Empty or 0 removes the line; otherwise a count with at most three decimals. */
function normalize(text: string): { valid: boolean; qty: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: true, qty: null };
  const value = parseCount(trimmed);
  if (value === null) return { valid: false, qty: null };
  return { valid: true, qty: new Decimal(value).isZero() ? null : value };
}

function isDirty(edit: Edit): boolean {
  const { valid, qty } = normalize(edit.qty);
  if (!valid) return true;
  if (qty === null) return edit.prevQty !== null;
  if (edit.prevQty === null) return true;
  return !new Decimal(qty).eq(edit.prevQty) || edit.unitId !== edit.prevUnitId;
}

const isValid = (edit: Edit) => normalize(edit.qty).valid;

function toChange(edit: Edit): GridChange {
  const { qty } = normalize(edit.qty);
  return {
    productId: edit.productId,
    productUnitId: qty === null ? null : edit.unitId,
    qty,
    previousUnitId: edit.prevUnitId,
    previousQty: edit.prevQty,
  };
}

function editOf(row: GridRow): Edit {
  return {
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    units: row.units,
    unitId: row.line?.productUnitId ?? defaultUnitId(row.units),
    qty: row.line ? plainDecimal(row.line.qty) : '',
    prevUnitId: row.line?.productUnitId ?? null,
    prevQty: row.line?.qty ?? null,
  };
}

interface SaveReport {
  conflicts: { productId: number; label: string; qty: string | null; unitName: string | null }[];
  refused: { productId: number; label: string; reason: GridRefusalReason }[];
}

/**
 * One supplier's products with the order's quantities (ADR-0115): beside each row the home
 * warehouse, stock, minimum, last month's outflow and, for price readers, the last price and an
 * estimated cost. Typed cells stay in a sparse map over the rows; «Хадгалах (n)» sends only those.
 */
export function OrderGrid(props: {
  orderId: number;
  supplier: PurchaseOrderSupplier;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { orderId, supplier, onDirtyChange } = props;
  const canPrices = useHasPermission('procurement.prices.read');
  const canEdit = useHasPermission('procurement.orders.edit') && supplier.canEdit;
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [filter, setFilter] = useState<GridFilter>('ALL');
  const rows = usePurchaseOrderRows(orderId, supplier.supplierId, { q, filter });
  const loaded = rows.data?.pages.flatMap((page) => page.data) ?? [];
  const firstPage = rows.data?.pages[0];
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [edits, setEdits] = useState<ReadonlyMap<number, Edit>>(new Map());
  const [report, setReport] = useState<SaveReport | null>(null);
  const table = useRef<HTMLDivElement>(null);

  const pending = [...edits.values()].filter(isDirty);
  const invalid = pending.filter((edit) => !isValid(edit)).length;
  const dirty = pending.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const change = (row: GridRow, patch: Partial<Pick<Edit, 'unitId' | 'qty'>>) =>
    setEdits((current) => {
      const next = new Map(current);
      next.set(row.productId, { ...(current.get(row.productId) ?? editOf(row)), ...patch });
      return next;
    });

  const save = () =>
    void action.run(async () => {
      const snapshot = edits;
      const sent = [...snapshot.values()].filter(isDirty);
      const result = await mutations.saveLines.mutateAsync({
        id: orderId,
        supplierId: supplier.supplierId,
        changes: sent.map(toChange),
      });
      const label = (edit: Edit | undefined, productId: number) =>
        edit ? `${edit.sku} ${edit.name}` : String(productId);
      setReport(
        result.conflicts.length + result.refused.length > 0
          ? {
              conflicts: result.conflicts.map((conflict) => {
                const edit = snapshot.get(conflict.productId);
                return {
                  productId: conflict.productId,
                  label: label(edit, conflict.productId),
                  qty: conflict.qty,
                  unitName:
                    edit?.units.find((unit) => unit.id === conflict.productUnitId)?.name ?? null,
                };
              }),
              refused: result.refused.map((refusal) => ({
                productId: refusal.productId,
                label: label(snapshot.get(refusal.productId), refusal.productId),
                reason: refusal.reason,
              })),
            }
          : null,
      );
      // Cells typed while the request ran are kept; the rest now show the server's values.
      setEdits((current) => {
        const next = new Map(current);
        for (const [productId, edit] of snapshot) {
          if (next.get(productId) === edit) next.delete(productId);
        }
        return next;
      });
      if (result.applied > 0) {
        toast.success(t('procurement.grid.saved', { count: result.applied }));
      }
    });

  /** Enter in a quantity goes to the next row's quantity. */
  const nextQty = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = [
      ...(table.current?.querySelectorAll<HTMLInputElement>('input[data-po-qty]:not(:disabled)') ??
        []),
    ];
    const next = inputs[inputs.indexOf(event.currentTarget) + 1];
    if (next) {
      next.focus();
      next.select();
    }
  };

  const conflicted = new Set(report?.conflicts.map((conflict) => conflict.productId));
  const columns = 8 + (canPrices ? 2 : 0);
  const outflowTitle = firstPage
    ? t('procurement.grid.lastMonthOutTitle', {
        from: firstPage.outflowFrom,
        to: firstPage.outflowTo,
      })
    : undefined;

  return (
    <div>
      <FilterBar
        end={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link
                to={`/procurement/orders/${orderId}/print?supplierId=${supplier.supplierId}`}
                target="_blank"
                rel="noreferrer"
              >
                <Printer />
                {t('procurement.grid.print')}
              </Link>
            </Button>
            {canEdit ? (
              <Button
                size="sm"
                pending={mutations.saveLines.isPending}
                disabled={!dirty || invalid > 0}
                onClick={save}
              >
                {t('procurement.grid.save', { count: pending.length })}
              </Button>
            ) : null}
          </>
        }
      >
        <SearchField
          aria-label={t('procurement.grid.search')}
          placeholder={t('procurement.grid.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SegmentedControl
          name={t('procurement.grid.filter')}
          options={FILTERS}
          value={filter}
          label={(value) => t(`procurement.grid.filters.${value}`)}
          onChange={setFilter}
        />
        {firstPage ? (
          <span className="text-[13px] text-muted-foreground">
            {t('procurement.grid.total', { count: formatCount(firstPage.total) })}
          </span>
        ) : null}
      </FilterBar>
      {!canEdit ? (
        <p className="mb-3 text-[13px] text-muted-foreground">{t('procurement.grid.readOnly')}</p>
      ) : null}
      {invalid > 0 ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          {t('procurement.grid.invalid', { count: invalid })}
        </p>
      ) : null}
      <ProblemAlert problem={action.problem} />
      <ProblemAlert problem={problemFromError(rows.error)} onRetry={rows.refetch} />
      {report ? (
        <Alert className="mb-3 border-transparent bg-warning-soft shadow-none!">
          <TriangleAlert />
          <AlertTitle>{t('procurement.grid.notSavedTitle')}</AlertTitle>
          <AlertDescription>
            {report.conflicts.length > 0 ? (
              <>
                <p>{t('procurement.grid.conflictsTitle')}</p>
                <ul className="list-disc pl-5">
                  {report.conflicts.map((conflict) => (
                    <li key={conflict.productId}>
                      {conflict.qty && !new Decimal(conflict.qty).isZero()
                        ? t('procurement.grid.conflictLine', {
                            product: conflict.label,
                            qty: formatQty(conflict.qty),
                            unit: conflict.unitName ?? '',
                          })
                        : t('procurement.grid.conflictRemoved', { product: conflict.label })}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.refused.length > 0 ? (
              <>
                <p>{t('procurement.grid.refusedTitle')}</p>
                <ul className="list-disc pl-5">
                  {report.refused.map((refusal) => (
                    <li key={refusal.productId}>
                      {t('procurement.grid.refusedLine', {
                        product: refusal.label,
                        reason: t(`procurement.grid.refusal.${refusal.reason}`),
                      })}
                    </li>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('procurement.grid.sku')}</TableHead>
                <TableHead>{t('procurement.grid.name')}</TableHead>
                <TableHead>{t('procurement.grid.warehouse')}</TableHead>
                <TableHead className="text-right">{t('procurement.grid.onHand')}</TableHead>
                <TableHead className="text-right">{t('procurement.grid.minQty')}</TableHead>
                <TableHead className="text-right" title={outflowTitle}>
                  {t('procurement.grid.lastMonthOut')}
                </TableHead>
                {canPrices ? (
                  <TableHead className="text-right">{t('procurement.grid.lastPrice')}</TableHead>
                ) : null}
                <TableHead>{t('procurement.grid.unit')}</TableHead>
                <TableHead className="text-right">{t('procurement.grid.qty')}</TableHead>
                {canPrices ? (
                  <TableHead className="text-right">
                    {t('procurement.grid.estimatedCost')}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.isPending ? <SkeletonRows columns={columns} /> : null}
              {loaded.map((row) => {
                const edit = edits.get(row.productId);
                const shown = edit ?? editOf(row);
                const typed = normalize(shown.qty);
                const unit = row.units.find((candidate) => candidate.id === shown.unitId);
                const below = row.minQty !== null && new Decimal(row.onHand).lt(row.minQty);
                const disabled = !canEdit || !row.editable;
                const cost =
                  canPrices && row.lastBasePrice && typed.qty && unit
                    ? new Decimal(typed.qty)
                        .times(unit.factor)
                        .times(row.lastBasePrice)
                        .toDecimalPlaces(2)
                        .toString()
                    : null;
                const named = `${row.sku} ${row.name}`;
                return (
                  <TableRow
                    key={row.productId}
                    className={cn(
                      conflicted.has(row.productId) && 'bg-warning-soft',
                      edit && isDirty(edit) && 'bg-secondary/40',
                    )}
                  >
                    <TableCell className="font-mono">{row.sku}</TableCell>
                    <TruncateCell text={row.name} />
                    <TableCell className="text-muted-foreground">
                      {row.homeWarehouseName ?? t('procurement.grid.noHome')}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        below && 'font-semibold text-destructive',
                      )}
                      title={below ? t('procurement.grid.belowMin') : undefined}
                    >
                      {formatQty(row.onHand)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.minQty === null ? t('common.none') : formatQty(row.minQty)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(row.lastMonthOut)}
                    </TableCell>
                    {canPrices ? (
                      <TableCell
                        className="text-right font-mono"
                        title={row.lastPriceDate ?? undefined}
                      >
                        {row.lastBasePrice ? formatTugrik(row.lastBasePrice) : t('common.none')}
                      </TableCell>
                    ) : null}
                    <TableCell className="py-1">
                      <NativeSelect
                        aria-label={t('procurement.grid.unitOf', { product: named })}
                        className="h-8 w-28"
                        disabled={disabled}
                        value={String(shown.unitId)}
                        onChange={(event) =>
                          change(row, { unitId: Number.parseInt(event.target.value, 10) })
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
                        data-po-qty=""
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={t('procurement.grid.qtyOf', { product: named })}
                        aria-invalid={typed.valid ? undefined : true}
                        className="ml-auto h-8 w-24 text-right font-mono"
                        disabled={disabled}
                        value={shown.qty}
                        onChange={(event) => change(row, { qty: event.target.value })}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={nextQty}
                      />
                    </TableCell>
                    {canPrices ? (
                      <TableCell className="text-right font-mono">
                        {cost ? formatTugrik(cost) : ''}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!rows.isPending && loaded.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title={t(
                q || filter !== 'ALL' ? 'procurement.grid.emptyFiltered' : 'procurement.grid.empty',
              )}
              onClearFilters={
                q || filter !== 'ALL'
                  ? () => {
                      setSearch('');
                      setFilter('ALL');
                    }
                  : undefined
              }
            />
          ) : null}
          <LoadMore query={rows} />
        </ListCard>
      </div>
    </div>
  );
}
