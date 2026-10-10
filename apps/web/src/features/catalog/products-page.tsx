import { ImageOff, Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { type ProductStatus, useBrands, useCategories, useProducts } from './api';
import { categoryPaths, categoryTree } from './category-tree';
import { PRODUCT_STATUSES } from './product-schema';

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};
const isStatus = (value: string | null): value is ProductStatus =>
  PRODUCT_STATUSES.some((status) => status === value);

/**
 * Products: search by name in either script, SKU or barcode, filter by category (with its
 * subcategories), brand and status. Filters live in the URL so "back" keeps them (SPEC §5.2).
 */
export function ProductsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('catalog.products.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = positiveId(params.get('category'));
  const brandId = positiveId(params.get('brand'));
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const products = useProducts({ q, categoryId, brandId, status });
  const categories = useCategories();
  const brands = useBrands();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const rows = products.data?.pages.flatMap((page) => page.data) ?? [];

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
      <PageHeader
        title={t('catalog.products.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/catalog/products/new">
                <Plus />
                {t('catalog.products.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          aria-label={t('common.search')}
          placeholder={t('catalog.products.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
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
        <NativeSelect
          aria-label={t('catalog.product.brand')}
          value={brandId === undefined ? '' : String(brandId)}
          onChange={(event) => setParam('brand', event.target.value)}
        >
          <option value="">{t('catalog.products.allBrands')}</option>
          {(brands.data ?? []).map((brand) => (
            <option key={brand.id} value={String(brand.id)}>
              {brand.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('catalog.product.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('catalog.products.allStatuses')}</option>
          {PRODUCT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`catalog.products.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ProblemAlert problem={problemFromError(products.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">{t('catalog.products.columns.image')}</TableHead>
            <TableHead>{t('catalog.products.columns.sku')}</TableHead>
            <TableHead>{t('catalog.products.columns.name')}</TableHead>
            <TableHead>{t('catalog.products.columns.category')}</TableHead>
            <TableHead>{t('catalog.products.columns.baseUnit')}</TableHead>
            <TableHead>{t('catalog.products.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((product) => (
            <TableRow key={product.id}>
              <TableCell>
                {product.thumbUrl ? (
                  <img
                    src={product.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="size-10 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                    <ImageOff className="size-4 text-muted-foreground" />
                  </div>
                )}
              </TableCell>
              <TableCell className="font-mono">{product.sku}</TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to={`/catalog/products/${product.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {product.name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {paths.get(product.categoryId) ?? t('common.none')}
              </TableCell>
              <TableCell>{product.baseUnit.uomName}</TableCell>
              <TableCell>
                <Badge variant={product.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                  {t(`catalog.products.status.${product.status}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!products.isPending && rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t('catalog.products.empty')}</p>
      ) : null}
      {products.hasNextPage ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={products.isFetchingNextPage}
          onClick={() => void products.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
