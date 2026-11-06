import { Boxes, ChevronDown, Copy, FileBarChart, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Decimal } from '@tugeel/shared/money';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProductLocations, useProductStock } from '@/features/inventory/api';
import { useWarehouseName } from '@/features/inventory/helpers';
import { ProductLocationCard } from '@/features/inventory/product-location-card';
import { ProductSuppliersCard } from '@/features/partners/product-suppliers-card';
import { useProductPrices } from '@/features/pricing/api';
import { ProductPricesCard } from '@/features/pricing/product-prices-card';
import { BINS_SOON, EBARIMT_PER_PRODUCT } from '@/lib/features';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { type ProductDetail, useCatalogMutations, useCategories, useProduct } from './api';
import { categoryPaths } from './category-tree';
import { EbarimtCard } from './ebarimt-card';
import { ImagesCard } from './images-card';
import { ProductForm } from './product-form';
import { ProductHistoryCard } from './product-history-card';
import { type ProductFormValues, productValues, updateBody } from './product-schema';
import { productStage } from './product-stage';
import { ProductStageBadge } from './product-stage-badge';
import { UnitsCard } from './units-card';

/**
 * One product (ADR-0042; relaid 2026-10-31, 2026-11-06): the header names it (code, category,
 * stage) with a pencil for the form and «Тайлан авах»; a strip of tiles holds its facts — the
 * primary barcode, the warehouse price, the home warehouse, the unit, the box, the weight — and
 * where it stands now. The left column then holds the units with their barcodes, the prices and
 * who changed what; the right column the photos, the location and the suppliers.
 */
export function ProductPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('catalog.products.manage');
  const product = useProduct(id);
  const categories = useCategories();
  const mutations = useCatalogMutations();
  const [editing, setEditing] = useState(false);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);

  const loadProblem = problemFromError(product.error ?? categories.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!product.data || !categories.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = product.data;
  const categoryPath = paths.get(detail.categoryId);

  const save = async (values: ProductFormValues, close: () => void) => {
    try {
      await mutations.updateProduct.mutateAsync({ id, body: updateBody(values) });
      toast.success(t('catalog.product.saved'));
      close();
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div>
      <PageHeader
        title={detail.name}
        titleAction={
          canManage ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={`${t('common.edit')}: ${t('catalog.product.info')}`}
              title={t('common.edit')}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          ) : null
        }
        meta={
          <>
            <span className="font-mono">{detail.sku}</span>
            {categoryPath ? (
              <span className="flex items-center gap-2">
                <span aria-hidden className="opacity-50">
                  {'·'}
                </span>
                {categoryPath}
              </span>
            ) : null}
            <ProductStageBadge product={detail} />
          </>
        }
        actions={
          <>
            <ReportMenu detail={detail} />
            <Button asChild>
              <Link to={`/inventory/stock/${detail.id}`}>
                <Boxes />
                {t('catalog.product.viewStock')}
              </Link>
            </Button>
          </>
        }
      />
      <KeyFigures detail={detail} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <UnitsCard product={detail} canManage={canManage} />
          <ProductPricesCard productId={detail.id} pending={productStage(detail) === 'PENDING'} />
          {EBARIMT_PER_PRODUCT ? <EbarimtCard product={detail} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ImagesCard product={detail} canManage={canManage} />
          <ProductLocationCard productId={detail.id} stockLink={false} />
          <ProductSuppliersCard productId={detail.id} />
          {canManage ? (
            <ProductHistoryCard productId={detail.id} categoryPath={(value) => paths.get(value)} />
          ) : null}
        </div>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        {editing ? (
          <DialogContent closeLabel={t('common.close')} size="lg">
            <DialogHeader>
              <DialogTitle>{detail.name}</DialogTitle>
            </DialogHeader>
            <ProductForm
              defaultValues={productValues(detail)}
              categories={categories.data}
              submitLabel={t('common.save')}
              onCancel={() => setEditing(false)}
              onSubmit={(values) => save(values, () => setEditing(false))}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/**
 * «Тайлан авах» (owner 2026-11-06): the kinds of report on this product. Each opens in a new tab
 * with the product already chosen in its prompt, where the reader sets the rest.
 */
function ReportMenu({ detail }: { detail: ProductDetail }) {
  const { t } = useTranslation();
  const canReports = useHasPermission('reports.view');
  const chosen = new URLSearchParams({
    pr: String(detail.id),
    prn: `${detail.sku} - ${detail.name}`,
  }).toString();
  const reports = [
    ...(canReports
      ? [
          { to: `/reports/stock-balance?${chosen}`, label: t('nav.reportsStockBalance') },
          { to: `/reports/stock-documents?${chosen}`, label: t('nav.reportsStockDocuments') },
          { to: `/reports/product-sales?${chosen}`, label: t('nav.reportsProductSales') },
        ]
      : []),
    { to: `/inventory/movements?product=${detail.id}`, label: t('nav.movements') },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <FileBarChart />
          {t('catalog.product.reports')}
          <ChevronDown aria-hidden className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {reports.map((report) => (
          <DropdownMenuItem key={report.to} asChild>
            <Link to={report.to} target="_blank">
              {report.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The strip under the header: the primary barcode (copied with one click), the warehouse price when
 * the reader may see prices, the home warehouse, the unit, the box and the weight, and beside them
 * every place the product stands now. The stock comes from the balances' cache in one read.
 */
function KeyFigures({ detail }: { detail: ProductDetail }) {
  const { t } = useTranslation();
  const stock = useProductStock(detail.id);
  const locations = useProductLocations(detail.id);
  const prices = useProductPrices(detail.id);
  const warehouseName = useWarehouseName();
  const base = detail.units.find((unit) => unit.isBase);
  const primary =
    detail.units.flatMap((unit) => unit.barcodes).find((barcode) => barcode.isPrimary) ??
    base?.barcodes[0] ??
    null;
  const home = (locations.data ?? []).find((row) => row.isHome) ?? null;
  const current = prices.data?.current ?? null;
  const box = detail.units.find((unit) => !unit.isBase && unit.uomCode === 'BOX');
  const unitName = stock.data?.product.baseUnitName ?? base?.uomName ?? '';
  const places = (stock.data?.warehouses ?? []).filter((row) => new Decimal(row.onHand).gt(0));
  const shelvesOf = (warehouseId: number) =>
    BINS_SOON
      ? []
      : (stock.data?.bins ?? [])
          .filter((bin) => bin.warehouseId === warehouseId)
          .map((bin) => bin.binCode);
  const copy = () => {
    if (!primary) return;
    void navigator.clipboard?.writeText(primary.code).then(
      () => toast.success(t('catalog.product.key.copied', { code: primary.code })),
      () => undefined,
    );
  };
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <section
        aria-label={t('catalog.product.key.onHandNow')}
        className="flex min-w-0 flex-col gap-1 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06] xl:col-start-4 xl:row-span-2 xl:row-start-1"
      >
        <span className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">
          {t('catalog.product.key.onHandNow')}
        </span>
        {stock.isPending ? (
          <Muted>{t('common.loading')}</Muted>
        ) : places.length === 0 ? (
          <Muted>{t('catalog.product.key.noStock')}</Muted>
        ) : (
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {places.map((place) => {
              const shelves = shelvesOf(place.warehouseId);
              return (
                <li key={place.warehouseId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[0.9375rem]">
                    {warehouseName(place.warehouseId)}
                    {shelves.length > 0 ? (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {shelves.join(', ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[0.9375rem] font-semibold tabular-nums">
                    {t('inventory.qtyWithUnit', {
                      qty: formatQty(place.onHand),
                      unit: unitName,
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Figure label={t('catalog.product.key.barcode')}>
        {primary ? (
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono tabular-nums">{primary.code}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={t('catalog.product.key.copy')}
              title={t('catalog.product.key.copy')}
              onClick={copy}
            >
              <Copy />
            </Button>
          </span>
        ) : (
          <Muted>{t('catalog.units.noBarcodes')}</Muted>
        )}
      </Figure>
      <Figure label={t('catalog.product.key.price')}>
        {current ? (
          <span className="font-mono tabular-nums">
            {t('pricing.card.pricePerUnit', {
              amount: formatMnt(current.warehousePrice),
              unit: base?.uomName ?? '',
            })}
          </span>
        ) : (
          <Muted>{t('catalog.product.key.noPrice')}</Muted>
        )}
      </Figure>
      <Figure label={t('catalog.product.key.home')}>
        {home ? (
          <span className="truncate">{warehouseName(home.warehouseId)}</span>
        ) : (
          <Muted>{t('inventory.location.noHome')}</Muted>
        )}
      </Figure>
      <Figure label={t('catalog.product.baseUnit')}>
        {base?.uomName ?? <Muted>{t('common.none')}</Muted>}
      </Figure>
      <Figure label={t('catalog.product.boxFactor')}>
        {box ? (
          <span className="font-mono tabular-nums">
            {t('catalog.product.boxOf', { factor: box.factorToBase, unit: base?.uomName ?? '' })}
          </span>
        ) : (
          <Muted>{t('common.none')}</Muted>
        )}
      </Figure>
      <Figure label={t('catalog.products.columns.weight')}>
        {detail.weightKg ? (
          <span className="font-mono tabular-nums">{detail.weightKg}</span>
        ) : (
          <Muted>{t('common.none')}</Muted>
        )}
      </Figure>
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <span className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate text-[1.0625rem] font-semibold">{children}</span>
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn('text-[0.9375rem] font-normal text-muted-foreground')}>{children}</span>
  );
}
