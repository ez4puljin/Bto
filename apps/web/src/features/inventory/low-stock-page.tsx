import { PackageMinus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, FilterBar, ListCard, LoadMore, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProductSuppliersOf } from '@/features/partners/api';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type LowStockRow, useLowStock, useTransferMutations } from './api';
import { useCanWrite, useWarehouseName, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const WHOLESALE = ['WHOLESALE'] as const;

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/** The warehouse most of the rows call home: where a store asks for them. */
function commonHome(rows: readonly LowStockRow[]): number | undefined {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.homeWarehouseId !== null) {
      counts.set(row.homeWarehouseId, (counts.get(row.homeWarehouseId) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The low-stock list (SPEC §8.2 #4, ADR-0039): what a warehouse has run out of or holds at or
 * below its minimum, with the quantity up to the maximum. At the supermarket the clerk picks rows
 * and asks a wholesale warehouse for them in one transfer request; a wholesale list shows the main
 * supplier.
 */
export function LowStockPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const warehouses = useWarehouseOptions(SHELF_KINDS);
  const mine = useWarehouseOptions(SHELF_KINDS, true);
  const warehouseName = useWarehouseName();
  const canRequest = useHasPermission('inventory.transfers.manage');
  const canWrite = useCanWrite();
  // A worker who writes for one warehouse sees it at once.
  const warehouseId =
    positiveId(params.get('warehouseId')) ??
    (mine.options.length === 1 ? mine.options[0]?.id : undefined);
  const warehouse = warehouses.options.find((option) => option.id === warehouseId);
  const low = useLowStock(warehouseId);
  const rows = low.data?.pages.flatMap((page) => page.data) ?? [];
  const isStore = warehouse?.kind === 'STORE';
  const suppliers = useProductSuppliersOf(
    rows.map((row) => row.product.id),
    warehouse?.kind === 'WHOLESALE',
  );
  const supplierOf = (productId: number) => {
    const links = (suppliers.data ?? []).filter((link) => link.productId === productId);
    return (links.find((link) => link.isMain) ?? links[0])?.supplier.name;
  };
  const requestable = isStore && canRequest && warehouseId !== undefined && canWrite(warehouseId);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const chosen = rows.filter((row) => selected.has(row.product.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  const pickWarehouse = (id: number | undefined) => {
    setSelected(new Set());
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id === undefined) next.delete('warehouseId');
        else next.set('warehouseId', String(id));
        return next;
      },
      { replace: true },
    );
  };
  const toggle = (productId: number, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(productId);
      else next.delete(productId);
      return next;
    });

  const wholesale = warehouse?.kind === 'WHOLESALE';
  const columns = 6 + (requestable ? 1 : 0) + (isStore ? 1 : 0) + (wholesale ? 1 : 0);

  return (
    <div>
      <PageHeader
        title={t('inventory.lowStock.title')}
        meta={<p className="max-w-3xl">{t('inventory.lowStock.intro')}</p>}
      />
      <FilterBar
        end={
          requestable && warehouseId !== undefined ? (
            <RequestTransfer
              storeId={warehouseId}
              rows={chosen}
              onCreated={() => setSelected(new Set())}
            />
          ) : null
        }
      >
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.pickWarehouse')}
          onChange={pickWarehouse}
        />
      </FilterBar>
      {warehouseId === undefined ? (
        <ListCard>
          <EmptyState icon={PackageMinus} title={t('inventory.lowStock.pickWarehouse')} />
        </ListCard>
      ) : (
        <>
          <ProblemAlert problem={problemFromError(low.error)} />
          <ListCard>
            <Table>
              <TableHeader>
                <TableRow>
                  {requestable ? (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={t('inventory.lowStock.selectAll')}
                        checked={allChosen}
                        onCheckedChange={(on) =>
                          setSelected(
                            on === true ? new Set(rows.map((row) => row.product.id)) : new Set(),
                          )
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>{t('inventory.lowStock.columns.product')}</TableHead>
                  <TableHead>{t('inventory.lowStock.columns.status')}</TableHead>
                  <TableHead className="text-right">
                    {t('inventory.lowStock.columns.onHand')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('inventory.lowStock.columns.min')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('inventory.lowStock.columns.max')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('inventory.lowStock.columns.suggested')}
                  </TableHead>
                  {isStore ? <TableHead>{t('inventory.lowStock.columns.home')}</TableHead> : null}
                  {wholesale ? (
                    <TableHead>{t('inventory.lowStock.columns.supplier')}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {low.isPending ? <SkeletonRows columns={columns} /> : null}
                {rows.map((row) => (
                  <TableRow
                    key={row.product.id}
                    data-state={selected.has(row.product.id) ? 'selected' : undefined}
                  >
                    {requestable ? (
                      <TableCell>
                        <Checkbox
                          aria-label={t('inventory.lowStock.select', { name: row.product.name })}
                          checked={selected.has(row.product.id)}
                          onCheckedChange={(on) => toggle(row.product.id, on === true)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="min-w-48 whitespace-normal">
                      <Link
                        to={`/inventory/stock/${row.product.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        <span className="font-mono text-muted-foreground">{row.product.sku}</span>{' '}
                        {row.product.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'OUT' ? 'destructive' : 'warning'}>
                        {t(`inventory.lowStock.statuses.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', {
                        qty: row.onHand,
                        unit: row.product.baseUnitName,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.minQty ?? t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.maxQty ?? t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {row.suggestedQty ?? t('common.none')}
                    </TableCell>
                    {isStore ? (
                      <TableCell>
                        {row.homeWarehouseId === null
                          ? t('common.none')
                          : warehouseName(row.homeWarehouseId)}
                      </TableCell>
                    ) : null}
                    {wholesale ? (
                      <TableCell>{supplierOf(row.product.id) ?? t('common.none')}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!low.isPending && rows.length === 0 ? (
              <EmptyState icon={PackageMinus} title={t('inventory.lowStock.empty')} />
            ) : null}
            <LoadMore query={low} />
          </ListCard>
        </>
      )}
    </div>
  );
}

/**
 * The store asks a wholesale warehouse for the chosen rows: one request draft, each row in its
 * base unit at the suggested quantity (1 without one), edited on the transfer page before sending.
 */
function RequestTransfer(props: {
  storeId: number;
  rows: readonly LowStockRow[];
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sources = useWarehouseOptions(WHOLESALE);
  const mutations = useTransferMutations();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(randomUuid);
  const [source, setSource] = useState<number | undefined>();

  const ask = () => {
    action.clear();
    setKey(randomUuid());
    setSource(commonHome(props.rows) ?? sources.options[0]?.id);
    setOpen(true);
  };
  const create = () =>
    void action.run(async () => {
      if (source === undefined) return;
      const transfer = await mutations.create.mutateAsync({
        key,
        origin: 'REQUEST',
        sourceWarehouseId: source,
        destWarehouseId: props.storeId,
        lines: props.rows.map((row) => ({
          productUnitId: row.baseUnitId,
          qty: row.suggestedQty ?? '1',
        })),
      });
      setOpen(false);
      props.onCreated();
      await navigate(`/inventory/transfers/${transfer.id}`);
    });

  return (
    <>
      <Button disabled={props.rows.length === 0} onClick={ask}>
        {t('inventory.lowStock.request', { count: props.rows.length })}
      </Button>
      <ConfirmDialog
        open={open}
        variant="default"
        title={t('inventory.lowStock.requestTitle')}
        description={t('inventory.lowStock.requestDescription', { count: props.rows.length })}
        confirmLabel={t('inventory.lowStock.createRequest')}
        pending={mutations.create.isPending}
        disabled={source === undefined}
        problem={action.problem}
        onConfirm={create}
        onClose={() => setOpen(false)}
      >
        <WarehouseSelect
          label={t('inventory.lowStock.source')}
          options={sources.options}
          value={source}
          emptyLabel={t('inventory.transfers.pickFrom')}
          onChange={setSource}
        />
      </ConfirmDialog>
    </>
  );
}
