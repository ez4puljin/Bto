import { Boxes, Copy, History, Package } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { useProductLocations, useProductStock } from '@/features/inventory/api';
import { useWarehouseName } from '@/features/inventory/helpers';
import { ProductLocationCard } from '@/features/inventory/product-location-card';
import { ProductSuppliersCard } from '@/features/partners/product-suppliers-card';
import { useProductPrices } from '@/features/pricing/api';
import { ProductPricesCard } from '@/features/pricing/product-prices-card';
import { EBARIMT_PER_PRODUCT } from '@/lib/features';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { type ProductDetail, useCatalogMutations, useCategories, useProduct } from './api';
import { categoryPaths } from './category-tree';
import { EbarimtCard } from './ebarimt-card';
import { ImagesCard } from './images-card';
import { ProductForm } from './product-form';
import { type ProductFormValues, productValues, updateBody } from './product-schema';
import { productStage } from './product-stage';
import { ProductStageBadge } from './product-stage-badge';
import { UnitsCard } from './units-card';

/**
 * One product (ADR-0042; relaid 2026-10-31 after a UI/UX review): the header names it (code,
 * category, stage) and a strip of key figures answers what people open it for — the primary
 * barcode, the warehouse price, what is on hand, the home warehouse. The left column then holds
 * the units with their barcodes, the prices and the card of the remaining facts («Засах» opens
 * the form); the right column the photos, the location and the suppliers.
 */
export function ProductPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('catalog.products.manage');
  const product = useProduct(id);
  const categories = useCategories();
  const mutations = useCatalogMutations();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);

  const loadProblem = problemFromError(product.error ?? categories.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!product.data || !categories.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = product.data;
  const loadedCategories = categories.data;
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
        media={<ProductThumb detail={detail} />}
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
            <Button variant="outline" asChild>
              <Link to={`/inventory/movements?product=${detail.id}`}>
                <History />
                {t('catalog.product.viewMovements')}
              </Link>
            </Button>
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
          <DetailCard
            title={t('catalog.product.info')}
            canEdit={canManage}
            view={<ProductFacts detail={detail} />}
            edit={(close) => (
              <ProductForm
                defaultValues={productValues(detail)}
                categories={loadedCategories}
                submitLabel={t('common.save')}
                onCancel={close}
                onSubmit={(values) => save(values, close)}
              />
            )}
          />
          {EBARIMT_PER_PRODUCT ? <EbarimtCard product={detail} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ImagesCard product={detail} canManage={canManage} />
          <ProductLocationCard productId={detail.id} stockLink={false} />
          <ProductSuppliersCard productId={detail.id} />
        </div>
      </div>
    </div>
  );
}

/**
 * The strip under the header: the primary barcode (copied with one click), the warehouse price
 * when the reader may see prices, what is on hand over every warehouse, the home warehouse.
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
  const onHand = stock.data?.onHand ?? null;
  const copy = () => {
    if (!primary) return;
    void navigator.clipboard?.writeText(primary.code).then(
      () => toast.success(t('catalog.product.key.copied', { code: primary.code })),
      () => undefined,
    );
  };
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
      <Figure label={t('catalog.product.key.onHand')}>
        {onHand !== null ? (
          <span className="font-mono tabular-nums">
            {t('inventory.qtyWithUnit', {
              qty: formatQty(onHand),
              unit: stock.data?.product.baseUnitName ?? base?.uomName ?? '',
            })}
          </span>
        ) : (
          <Muted>{t('common.none')}</Muted>
        )}
      </Figure>
      <Figure label={t('catalog.product.key.home')}>
        {home ? (
          <span className="truncate">{warehouseName(home.warehouseId)}</span>
        ) : (
          <Muted>{t('inventory.location.noHome')}</Muted>
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

/** The reading side of the product's card: what the header does not already show. */
function ProductFacts({ detail }: { detail: ProductDetail }) {
  const { t } = useTranslation();
  const base = detail.units.find((unit) => unit.isBase);
  const box = detail.units.find((unit) => !unit.isBase && unit.uomCode === 'BOX');
  return (
    <FieldList
      items={[
        {
          label: t('catalog.product.name'),
          value: detail.name,
        },
        {
          label: t('catalog.product.baseUnit'),
          value: base?.uomName ?? null,
        },
        {
          label: t('catalog.product.boxFactor'),
          value: box ? (
            <span className="font-mono">
              {t('catalog.product.boxOf', { factor: box.factorToBase, unit: base?.uomName ?? '' })}
            </span>
          ) : null,
        },
        {
          label: t('catalog.product.weight'),
          value: detail.weightKg ? (
            <span className="font-mono">{t('catalog.product.kg', { kg: detail.weightKg })}</span>
          ) : null,
        },
        {
          label: t('catalog.product.status'),
          value: t(`catalog.products.status.${productStage(detail)}`),
        },
      ]}
    />
  );
}

/** The product's primary photo beside its name, or a quiet placeholder. */
function ProductThumb({ detail }: { detail: ProductDetail }) {
  const { t } = useTranslation();
  const primary = detail.images.find((image) => image.isPrimary) ?? detail.images[0];
  const src = primary?.thumbUrl ?? primary?.url;
  return src ? (
    <img
      src={src}
      alt={t('catalog.images.alt', { name: detail.name })}
      className="size-14 rounded-xl object-cover shadow-card ring-1 ring-black/[0.06]"
    />
  ) : (
    <span className="grid size-14 place-items-center rounded-xl bg-fill text-muted-foreground">
      <Package aria-hidden className="size-6" />
    </span>
  );
}
