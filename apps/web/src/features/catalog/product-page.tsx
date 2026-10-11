import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductLocationCard } from '@/features/inventory/product-location-card';
import { ProductSuppliersCard } from '@/features/partners/product-suppliers-card';
import { problemFromError } from '@/lib/problem';
import { useBrands, useCatalogMutations, useCategories, useProduct, useUoms } from './api';
import { ImagesCard } from './images-card';
import { ProductForm } from './product-form';
import { type ProductFormValues, productValues, updateBody } from './product-schema';
import { UnitsCard } from './units-card';

/**
 * One product: its data and e-Barimt attributes, units with barcodes, photos (SPEC §5.2) and the
 * suppliers it is ordered from (SPEC §5.3, ADR-0032).
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
  const [saved, setSaved] = useState(false);

  const loadProblem = problemFromError(
    product.error ?? uoms.error ?? categories.error ?? brands.error,
  );
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!product.data || !uoms.data || !categories.data || !brands.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = product.data;

  const save = async (values: ProductFormValues) => {
    setSaved(false);
    try {
      await mutations.updateProduct.mutateAsync({ id, body: updateBody(values) });
      setSaved(true);
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.name}
        actions={
          <Button variant="outline" asChild>
            <Link to="/catalog/products">{t('common.back')}</Link>
          </Button>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-muted-foreground">{detail.sku}</span>
        <Badge variant={detail.status === 'ACTIVE' ? 'secondary' : 'outline'}>
          {t(`catalog.products.status.${detail.status}`)}
        </Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('catalog.product.info')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductForm
            // A saved product comes back with a new updatedAt: start from the stored values.
            key={detail.updatedAt}
            mode="edit"
            defaultValues={productValues(detail)}
            uoms={uoms.data}
            categories={categories.data}
            brands={brands.data}
            readOnly={!canManage}
            submitLabel={t('common.save')}
            saved={saved}
            onSubmit={save}
          />
        </CardContent>
      </Card>
      <UnitsCard product={detail} canManage={canManage} />
      <ImagesCard product={detail} canManage={canManage} />
      <ProductSuppliersCard productId={detail.id} />
      <ProductLocationCard productId={detail.id} />
    </div>
  );
}
