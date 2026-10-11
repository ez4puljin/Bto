import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useProductStock, useReconciliation, useStock } from './api';
import { useWarehouseName, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const STOCK_KINDS = ['WHOLESALE', 'STORE', 'VEHICLE', 'TRANSIT'] as const;

/**
 * Stock by product (SPEC §5.4): search as in the catalog, or browse the products holding stock;
 * averages and values only for cost holders. Admins see a red banner when the last reconciliation
 * found the caches off the ledger.
 */
export function StockPage() {
  const { t } = useTranslation();
  const canSeeCosts = useHasPermission('inventory.costs.manage');
  const isAdmin = useHasPermission('inventory.setup.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const inStock = params.get('all') !== '1';
  const warehouses = useWarehouseOptions(STOCK_KINDS);
  const stock = useStock({ q, warehouseId, inStock });
  const rows = stock.data?.pages.flatMap((page) => page.data) ?? [];

  const setParam = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader title={t('inventory.stock.title')} />
      {isAdmin ? <DriftBanner /> : null}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          aria-label={t('common.search')}
          placeholder={t('inventory.stock.searchPlaceholder')}
          className="lg:col-span-2"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <WarehouseSelect
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="stock-in-stock"
            checked={inStock}
            onCheckedChange={(checked) => setParam('all', checked === true ? '' : '1')}
          />
          <Label htmlFor="stock-in-stock">{t('inventory.stock.inStock')}</Label>
        </div>
      </div>
      <ProblemAlert problem={problemFromError(stock.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('inventory.sku')}</TableHead>
            <TableHead>{t('inventory.product')}</TableHead>
            <TableHead className="text-right">{t('inventory.stock.onHand')}</TableHead>
            <TableHead className="text-right">{t('inventory.stock.available')}</TableHead>
            {canSeeCosts ? (
              <TableHead className="text-right">{t('inventory.stock.value')}</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.product.id}>
              <TableCell className="font-mono">{row.product.sku}</TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to={`/inventory/stock/${row.product.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.product.name}
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">
                {t('inventory.qtyWithUnit', { qty: row.onHand, unit: row.product.baseUnitName })}
              </TableCell>
              <TableCell className="text-right font-mono">{row.available}</TableCell>
              {canSeeCosts ? (
                <TableCell className="text-right font-mono">
                  {row.value === undefined ? t('common.none') : formatMnt(row.value)}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!stock.isPending && rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t('inventory.stock.empty')}</p>
      ) : null}
      {stock.hasNextPage ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={stock.isFetchingNextPage}
          onClick={() => void stock.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** The red banner of a drifting reconciliation (§5.3 D10). */
function DriftBanner() {
  const { t } = useTranslation();
  const run = useReconciliation(true);
  if (run.data?.status !== 'DRIFT') return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription>
        {t('inventory.stock.drift', {
          count: run.data.diffCount,
          date: formatUbDateTime(Date.parse(run.data.startedAt)),
        })}
      </AlertDescription>
    </Alert>
  );
}

/** One product's stock by warehouse and by bin. */
export function StockProductPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canSeeCosts = useHasPermission('inventory.costs.manage');
  const stock = useProductStock(id);
  const warehouseName = useWarehouseName();

  const loadProblem = problemFromError(stock.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!stock.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = stock.data;
  const unit = detail.product.baseUnitName;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.product.name}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/catalog/products/${detail.product.id}`}>
                {t('inventory.stock.productCard')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/inventory/stock">{t('common.back')}</Link>
            </Button>
          </>
        }
      />
      <div className="-mt-2 font-mono text-sm text-muted-foreground">{detail.product.sku}</div>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.stock.byWarehouse')}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.warehouses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.stock.noStock')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.warehouse')}</TableHead>
                  <TableHead className="text-right">{t('inventory.stock.onHand')}</TableHead>
                  <TableHead className="text-right">{t('inventory.stock.sellable')}</TableHead>
                  <TableHead className="text-right">{t('inventory.stock.reserved')}</TableHead>
                  <TableHead className="text-right">{t('inventory.stock.available')}</TableHead>
                  {canSeeCosts ? (
                    <>
                      <TableHead className="text-right">{t('inventory.stock.avgCost')}</TableHead>
                      <TableHead className="text-right">{t('inventory.stock.value')}</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.warehouses.map((row) => (
                  <TableRow key={row.warehouseId}>
                    <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', { qty: row.onHand, unit })}
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.sellableOnHand}</TableCell>
                    <TableCell className="text-right font-mono">{row.reserved}</TableCell>
                    <TableCell className="text-right font-mono">{row.available}</TableCell>
                    {canSeeCosts ? (
                      <>
                        <TableCell className="text-right font-mono">
                          {row.avgCost === undefined ? t('common.none') : formatMnt(row.avgCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.value === undefined ? t('common.none') : formatMnt(row.value)}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.stock.byBin')}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.bins.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.stock.noStock')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.warehouse')}</TableHead>
                  <TableHead>{t('inventory.bin')}</TableHead>
                  <TableHead>{t('inventory.bins.type')}</TableHead>
                  <TableHead className="text-right">{t('inventory.stock.onHand')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.bins.map((row) => (
                  <TableRow key={`${row.binId}:${row.lotId ?? ''}`}>
                    <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                    <TableCell className="font-mono">{row.binCode}</TableCell>
                    <TableCell>{t(`inventory.binTypes.${row.binType}`)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', { qty: row.onHand, unit })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
