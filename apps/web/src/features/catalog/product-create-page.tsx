import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { problemFromError } from '@/lib/problem';
import { useBrands, useCatalogMutations, useCategories, useNextSku, useUoms } from './api';
import { ProductForm } from './product-form';
import { createBody, emptyProduct, type ProductFormValues } from './product-schema';

/**
 * A new product with its base unit, other units and barcodes in one step (SPEC §5.2). The SKU field
 * starts with the next free number; the admin may type the code from the Excel sheet instead.
 */
export function ProductCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const uoms = useUoms();
  const categories = useCategories();
  const brands = useBrands();
  const nextSku = useNextSku(true);
  const mutations = useCatalogMutations();

  const create = async (values: ProductFormValues) => {
    try {
      const product = await mutations.createProduct.mutateAsync(createBody(values));
      await navigate(`/catalog/products/${product.id}`);
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };
  const loadProblem = problemFromError(uoms.error ?? categories.error ?? brands.error);
  const pieces = uoms.data?.find((uom) => uom.code === 'PCS') ?? uoms.data?.[0];

  return (
    <div>
      <PageHeader
        title={t('catalog.product.newTitle')}
        actions={
          <Button variant="outline" asChild>
            <Link to="/catalog/products">{t('common.back')}</Link>
          </Button>
        }
      />
      <ProblemAlert problem={loadProblem} />
      {uoms.data && categories.data && brands.data && !nextSku.isPending ? (
        <Card>
          <CardContent>
            <ProductForm
              mode="create"
              defaultValues={emptyProduct(nextSku.data ?? '', pieces ? String(pieces.id) : '')}
              uoms={uoms.data}
              categories={categories.data}
              brands={brands.data}
              submitLabel={t('common.save')}
              onSubmit={create}
            />
          </CardContent>
        </Card>
      ) : loadProblem ? null : (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
    </div>
  );
}
