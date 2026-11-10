import { ComingSoonNote } from '@/components/coming-soon';
import { BINS_SOON } from '@/lib/features';
import { Boxes, History } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
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
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
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
import { useCategories } from '@/features/catalog/api';
import { categoryTree } from '@/features/catalog/category-tree';
import { ProductFilterMenu } from '@/features/catalog/product-filter-menu';
import {
  ProductFilterPanel,
  type ProductPanelSection,
} from '@/features/catalog/product-filter-panel';
import {
  activeFilterFields,
  type ProductFilters,
  readFilters,
  whereOf,
  writeFilters,
} from '@/features/catalog/product-filters';
import { listStageOf, PRODUCT_STAGES, STAGE_FILTER } from '@/features/catalog/product-stage';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useProductStock, useReconciliation, useStock } from './api';
import { useWarehouseName, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const STOCK_KINDS = ['WHOLESALE', 'STORE', 'VEHICLE', 'TRANSIT'] as const;

/** The stock list's columns (ADR-0119); the value only for cost holders. */
const STOCK_COLUMNS: readonly ColumnSpec[] = [
  { key: 'sku', kind: 'code' },
  { key: 'product', kind: 'text', weight: 3, min: 14 },
  { key: 'onHand', kind: 'qty', width: 8.5 },
  { key: 'available', kind: 'qty' },
  { key: 'value', kind: 'money' },
  { key: 'chevron', kind: 'chevron' },
];
const STOCK_COLUMNS_NO_COSTS = STOCK_COLUMNS.filter((column) => column.key !== 'value');

/** The left panel's sections on the stock list (owner 2026-11-10): what says which products. */
const STOCK_PANEL_SECTIONS: readonly ProductPanelSection[] = [
  'category',
  'segment',
  'status',
  'supplier',
  'home',
  'stock',
];

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * Stock by product (SPEC §5.4): search as in the catalog, or browse the products holding stock;
 * averages and values only for cost holders. Admins see a red banner when the last reconciliation
 * found the caches off the ledger. The left panel is the product list's (owner 2026-11-10):
 * category, segment, status, supplier, home warehouse and «in stock / out / at the minimum» in the
 * chosen warehouse; the server picks the products, so the count and «Цааш үзэх» stay right.
 */
export function StockPage() {
  const { t } = useTranslation();
  const canSeeCosts = useHasPermission('inventory.costs.manage');
  const isAdmin = useHasPermission('inventory.setup.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const warehouseId = positiveId(params.get('warehouseId'));
  const categoryId = positiveId(params.get('category'));
  const stage = listStageOf(params.get('status'));
  const filters = useMemo(() => readFilters(params), [params]);
  // The stock choice counts in the warehouse the page shows (any selling one without a choice).
  const where = useMemo(
    () =>
      whereOf(
        filters.stock
          ? {
              ...filters,
              stock: { kind: filters.stock.kind, ...(warehouseId ? { warehouseId } : {}) },
            }
          : filters,
      ),
    [filters, warehouseId],
  );
  // «Зөвхөн үлдэгдэлтэй» gives way to a stock choice of the panel.
  const inStock = params.get('all') !== '1' && filters.stock === undefined;
  const warehouses = useWarehouseOptions(STOCK_KINDS);
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const stock = useStock({
    q,
    warehouseId,
    inStock,
    ...(categoryId ? { categoryId } : {}),
    ...(stage ? STAGE_FILTER[stage] : {}),
    ...(where ? { where } : {}),
    ...(filters.segment ? { segmentId: filters.segment } : {}),
  });
  const rows = stock.data?.pages.flatMap((page) => page.data) ?? [];
  const total = stock.data?.pages[0]?.total;
  const filtered = Boolean(q || categoryId || stage || activeFilterFields(filters).length > 0);

  const applyFilters = (next: ProductFilters) =>
    setParams(
      (previous) => {
        const written = writeFilters(previous, next);
        // A stock choice lists every product it keeps, not only those holding stock.
        if (next.stock) written.set('all', '1');
        return written;
      },
      { replace: true },
    );
  const clearFilters = () => {
    setSearch('');
    setParams(
      (previous) => {
        const kept = new URLSearchParams();
        for (const key of ['warehouseId', 'all']) {
          const value = previous.get(key);
          if (value) kept.set(key, value);
        }
        return kept;
      },
      { replace: true },
    );
  };

  return (
    <div>
      <PageHeader
        title={t('inventory.stock.title')}
        meta={
          typeof total === 'number' ? (
            <span className="tabular-nums">
              {t('catalog.products.count', { total: formatCount(total) })}
            </span>
          ) : null
        }
      />
      {isAdmin ? <DriftBanner /> : null}
      <div className="flex items-start gap-4">
        <ProductFilterPanel
          categories={categories.data ?? []}
          categoryId={categoryId}
          onCategory={(id) => setParam('category', id === undefined ? '' : String(id))}
          stages={PRODUCT_STAGES}
          stage={stage}
          onStage={(value) => setParam('status', value ?? '')}
          filters={filters}
          onChange={applyFilters}
          sections={STOCK_PANEL_SECTIONS}
          stockWarehouse={false}
        />
        <div className="min-w-0 flex-1">
          <FilterBar>
            <SearchField
              className="sm:w-60"
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
            {/* The left side holds the category from `lg`; a narrow window keeps it here. */}
            <NativeSelect
              className="lg:hidden"
              variant="filter"
              aria-label={t('catalog.product.category')}
              value={categoryId === undefined ? '' : String(categoryId)}
              onChange={(event) => setParam('category', event.target.value)}
            >
              <option value="">{t('catalog.products.allCategories')}</option>
              {tree.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
            <ProductFilterMenu filters={filters} onChange={applyFilters} />
            <FilterToggle
              label={t('inventory.stock.inStock')}
              checked={inStock}
              onCheckedChange={(checked) =>
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    if (checked) {
                      next.delete('all');
                      next.delete('stock');
                    } else {
                      next.set('all', '1');
                    }
                    return next;
                  },
                  { replace: true },
                )
              }
            />
          </FilterBar>
          <ProblemAlert problem={problemFromError(stock.error)} onRetry={stock.refetch} />
          <ListCard scroll beside>
            <ListTable columns={canSeeCosts ? STOCK_COLUMNS : STOCK_COLUMNS_NO_COSTS}>
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
                    <TruncateCell text={row.product.name}>
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
                    <TableCell className="text-right font-mono">
                      {formatQty(row.available)}
                    </TableCell>
                    {canSeeCosts ? (
                      <TableCell className="text-right font-mono">
                        {row.value === undefined ? t('common.none') : formatTugrik(row.value)}
                      </TableCell>
                    ) : null}
                  </LinkRow>
                ))}
              </TableBody>
            </ListTable>
            {!stock.isPending && rows.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={t('inventory.stock.empty')}
                {...(filtered ? { onClearFilters: clearFilters } : {})}
              />
            ) : null}
            <LoadMore query={stock} />
          </ListCard>
        </div>
      </div>
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
      {/* By warehouse beside by shelf from xl (owner 2026-10-30). */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
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
                            {row.avgCost === undefined
                              ? t('common.none')
                              : formatTugrik(row.avgCost)}
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
            {BINS_SOON ? (
              <ComingSoonNote />
            ) : detail.bins.length === 0 ? (
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
    </div>
  );
}
