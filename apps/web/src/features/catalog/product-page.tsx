import { Boxes, History } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DetailCard, FieldList } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ProductLocationCard } from '@/features/inventory/product-location-card';
import { ProductSuppliersCard } from '@/features/partners/product-suppliers-card';
import { ProductPricesCard } from '@/features/pricing/product-prices-card';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import {
  type Brand,
  type ProductDetail,
  useBrands,
  useCatalogMutations,
  useCategories,
  useProduct,
  useUoms,
} from './api';
import { categoryPaths } from './category-tree';
import { ImagesCard } from './images-card';
import { ProductForm } from './product-form';
import { cityTaxChoice, type ProductFormValues, productValues, updateBody } from './product-schema';
import { UnitsCard } from './units-card';

/**
 * One product: its data and e-Barimt attributes (read first, «Засах» to change them, ADR-0042),
 * units with barcodes, prices, photos (SPEC §5.2), the suppliers it is ordered from (SPEC §5.3,
 * ADR-0032) and where it is kept. On a wide screen the side column holds the photos and suppliers.
 */
export function ProductPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('catalog.products.manage');
  const product = useProduct(id);
  const uoms = useUoms();
  const categories = useCategories();
  const brands = useBrands();
  const mutations = useCatalogMutations();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);

  const loadProblem = problemFromError(
    product.error ?? uoms.error ?? categories.error ?? brands.error,
  );
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!product.data || !uoms.data || !categories.data || !brands.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = product.data;
  const loadedUoms = uoms.data;
  const loadedCategories = categories.data;
  const loadedBrands = brands.data;

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
        meta={
          <>
            <span className="font-mono">{detail.sku}</span>
            <Badge variant={detail.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {t(`catalog.products.status.${detail.status}`)}
            </Badge>
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
            view={
              <ProductFacts
                detail={detail}
                categoryPath={paths.get(detail.categoryId)}
                brands={loadedBrands}
              />
            }
            edit={(close) => (
              <ProductForm
                mode="edit"
                defaultValues={productValues(detail)}
                uoms={loadedUoms}
                categories={loadedCategories}
                brands={loadedBrands}
                submitLabel={t('common.save')}
                onCancel={close}
                onSubmit={(values) => save(values, close)}
              />
            )}
          />
          <UnitsCard product={detail} canManage={canManage} />
          <ProductPricesCard productId={detail.id} />
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

/** The reading side of the product's card: its data, then its e-Barimt attributes. */
function ProductFacts(props: {
  detail: ProductDetail;
  categoryPath: string | undefined;
  brands: readonly Brand[];
}) {
  const { t } = useTranslation();
  const { detail } = props;
  const brand = props.brands.find((item) => item.id === detail.brandId);
  return (
    <div className="flex flex-col gap-5">
      <FieldList
        items={[
          {
            label: t('catalog.product.sku'),
            value: <span className="font-mono">{detail.sku}</span>,
          },
          { label: t('catalog.product.name'), value: detail.name },
          { label: t('catalog.product.category'), value: props.categoryPath },
          { label: t('catalog.product.brand'), value: brand?.name },
          {
            label: t('catalog.product.weight'),
            value: detail.weightKg ? <span className="font-mono">{detail.weightKg}</span> : null,
          },
          {
            label: t('catalog.product.status'),
            value: t(`catalog.products.status.${detail.status}`),
          },
        ]}
      />
      <Separator />
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold">{t('catalog.product.ebarimt')}</p>
        <FieldList
          items={[
            {
              label: t('catalog.product.vatType'),
              value: t(`catalog.product.vatTypes.${detail.vatType}`),
            },
            {
              label: t('catalog.product.cityTax'),
              value: t(`catalog.product.cityTaxValues.${cityTaxChoice(detail.cityTax)}`),
            },
            {
              label: t('catalog.product.classificationCode'),
              value: detail.classificationCode ? (
                <span className="font-mono">{detail.classificationCode}</span>
              ) : null,
            },
            {
              label: t('catalog.product.taxProductCode'),
              value: detail.taxProductCode ? (
                <span className="font-mono">{detail.taxProductCode}</span>
              ) : null,
            },
          ]}
        />
      </div>
    </div>
  );
}
