import { Boxes, History, Package } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { ProductLocationCard } from '@/features/inventory/product-location-card';
import { ProductSuppliersCard } from '@/features/partners/product-suppliers-card';
import { ProductPricesCard } from '@/features/pricing/product-prices-card';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { type ProductDetail, useCatalogMutations, useCategories, useProduct, useUoms } from './api';
import { categoryPaths } from './category-tree';
import { EbarimtCard } from './ebarimt-card';
import { ImagesCard } from './images-card';
import { ProductForm } from './product-form';
import { type ProductFormValues, productValues, updateBody } from './product-schema';
import { productStage } from './product-stage';
import { ProductStageBadge } from './product-stage-badge';
import { UnitsCard } from './units-card';

/**
 * One product: its data (read first, «Засах» to change them, ADR-0042), units with barcodes,
 * prices (and «Бүрэн болгох» while it waits for them, ADR-0044), its e-Barimt data for the
 * accountant, photos (SPEC §5.2), the suppliers it is ordered from (SPEC §5.3, ADR-0032) and where
 * it is kept. On a wide screen the side column holds the photos and suppliers.
 */
export function ProductPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('catalog.products.manage');
  const product = useProduct(id);
  const uoms = useUoms();
  const categories = useCategories();
  const mutations = useCatalogMutations();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);

  const loadProblem = problemFromError(product.error ?? uoms.error ?? categories.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!product.data || !uoms.data || !categories.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = product.data;
  const loadedUoms = uoms.data;
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
              <Link to={`/inventory/stock/${detail.id}`}>
                <Boxes />
                {t('catalog.product.viewStock')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/inventory/movements?product=${detail.id}`}>
                <History />
                {t('catalog.product.viewMovements')}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <DetailCard
            title={t('catalog.product.info')}
            canEdit={canManage}
            view={<ProductFacts detail={detail} categoryPath={categoryPath} />}
            edit={(close) => (
              <ProductForm
                mode="edit"
                defaultValues={productValues(detail)}
                uoms={loadedUoms}
                categories={loadedCategories}
                submitLabel={t('common.save')}
                onCancel={close}
                onSubmit={(values) => save(values, close)}
              />
            )}
          />
          <UnitsCard product={detail} canManage={canManage} />
          <ProductPricesCard productId={detail.id} pending={productStage(detail) === 'PENDING'} />
          <EbarimtCard product={detail} />
          <ProductLocationCard productId={detail.id} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ImagesCard product={detail} canManage={canManage} />
          <ProductSuppliersCard productId={detail.id} />
        </div>
      </div>
    </div>
  );
}

/** The reading side of the product's card (the e-Barimt data has its own card). */
function ProductFacts(props: { detail: ProductDetail; categoryPath: string | undefined }) {
  const { t } = useTranslation();
  const { detail } = props;
  return (
    <div className="flex flex-col gap-5">
      <FieldList
        title={t('catalog.product.sectionGeneral')}
        items={[
          {
            label: t('catalog.product.sku'),
            value: <span className="font-mono">{detail.sku}</span>,
          },
          { label: t('catalog.product.name'), value: detail.name },
          { label: t('catalog.product.category'), value: props.categoryPath },
          {
            label: t('catalog.product.weight'),
            value: detail.weightKg ? <span className="font-mono">{detail.weightKg}</span> : null,
          },
          {
            label: t('catalog.product.status'),
            value: t(`catalog.products.status.${productStage(detail)}`),
          },
        ]}
      />
    </div>
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
