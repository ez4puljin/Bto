import { Boxes, History } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
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
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
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
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const inStock = params.get('all') !== '1';
  const warehouses = useWarehouseOptions(STOCK_KINDS);
  const stock = useStock({ q, warehouseId, inStock });
  const rows = stock.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader title={t('inventory.stock.title')} />
      {isAdmin ? <DriftBanner /> : null}
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('inventory.stock.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <FilterToggle
          label={t('inventory.stock.inStock')}
          checked={inStock}
          onCheckedChange={(checked) => setParam('all', checked ? '' : '1')}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(stock.error)} onRetry={stock.refetch} />
      <ListCard scroll>
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
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.isPending ? <SkeletonRows columns={canSeeCosts ? 6 : 5} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.product.id} to={`/inventory/stock/${row.product.id}`}>
                <TableCell className="font-mono">{row.product.sku}</TableCell>
                <TruncateCell text={row.product.name} fill>
                  <Link
                    to={`/inventory/stock/${row.product.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.product.name}
                  </Link>
                </TruncateCell>
                <TableCell className="text-right font-mono">
                  {t('inventory.qtyWithUnit', {
                    qty: formatQty(row.onHand),
                    unit: row.product.baseUnitName,
                  })}
                </TableCell>
                <TableCell className="text-right font-mono">{formatQty(row.available)}</TableCell>
                {canSeeCosts ? (
                  <TableCell className="text-right font-mono">
                    {row.value === undefined ? t('common.none') : formatTugrik(row.value)}
                  </TableCell>
                ) : null}
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!stock.isPending && rows.length === 0 ? (
          <EmptyState icon={Boxes} title={t('inventory.stock.empty')} />
        ) : null}
        <LoadMore query={stock} />
      </ListCard>
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
    <div className="space-y-4">
      <PageHeader
        title={detail.product.name}
        meta={<span className="font-mono">{detail.product.sku}</span>}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/inventory/movements?product=${detail.product.id}`}>
                <History />
                {t('inventory.movements.history')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/catalog/products/${detail.product.id}`}>
                {t('inventory.stock.productCard')}
              </Link>
            </Button>
          </>
        }
      />
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
                      {t('inventory.qtyWithUnit', { qty: formatQty(row.onHand), unit })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(row.sellableOnHand)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(row.reserved)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatQty(row.available)}
                    </TableCell>
                    {canSeeCosts ? (
                      <>
                        <TableCell className="text-right font-mono">
                          {row.avgCost === undefined ? t('common.none') : formatTugrik(row.avgCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.value === undefined ? t('common.none') : formatTugrik(row.value)}
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
                  <TableHead>
                    <span className="sr-only">{t('inventory.movements.history')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.bins.map((row) => (
                  <TableRow key={`${row.binId}:${row.lotId ?? ''}`}>
                    <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                    <TableCell className="font-mono">{row.binCode}</TableCell>
                    <TableCell>{t(`inventory.binTypes.${row.binType}`)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', { qty: formatQty(row.onHand), unit })}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/inventory/movements?product=${detail.product.id}&warehouse=${row.warehouseId}&bin=${row.binId}`}
                        className="text-sm text-link underline-offset-4 hover:underline"
                        aria-label={`${t('inventory.movements.history')}: ${row.binCode}`}
                      >
                        {t('inventory.movements.binHistory')}
                      </Link>
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
