import { Columns3, Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWarehouseName } from '@/features/inventory/helpers';
import { problemFromError } from '@/lib/problem';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { type ProductStatus, useBrands, useCategories, useProducts } from './api';
import { categoryPaths, categoryTree } from './category-tree';
import {
  LOCKED_PRODUCT_COLUMNS,
  PRODUCT_COLUMN_KEYS,
  PRODUCT_COLUMNS,
  type ProductColumnKey,
} from './product-columns';
import { PRODUCT_STATUSES } from './product-schema';
import { ProductTable, type ProductTableContext } from './product-table';

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};
const isStatus = (value: string | null): value is ProductStatus =>
  PRODUCT_STATUSES.some((status) => status === value);

const COLUMNS_STORAGE_KEY = 'tugeel.catalog.products.hiddenColumns.v1';
const NO_PAGES: readonly { data: never[] }[] = [];

/**
 * Products: search by name in either script, SKU or barcode, filter by category (with its
 * subcategories), brand and status. Filters live in the URL so "back" keeps them (SPEC §5.2).
 * Every piece of product information has a column; the user picks which ones show (ADR-0037).
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
  const brandNames = useMemo(
    () => new Map((brands.data ?? []).map((brand) => [brand.id, brand.name])),
    [brands.data],
  );
  const warehouseName = useWarehouseName();
  const columnState = useHiddenColumns(
    COLUMNS_STORAGE_KEY,
    PRODUCT_COLUMN_KEYS,
    LOCKED_PRODUCT_COLUMNS,
  );
  const { hidden } = columnState;
  const columns = useMemo(
    () => PRODUCT_COLUMNS.filter((column) => !hidden.has(column.key)),
    [hidden],
  );
  const context = useMemo<ProductTableContext>(
    () => ({
      t,
      categoryPath: (id) => paths.get(id),
      brandName: (id) => brandNames.get(id),
      warehouseName,
    }),
    [t, paths, brandNames, warehouseName],
  );
  const pages = products.data?.pages ?? NO_PAGES;
  const empty = !products.isPending && pages.every((page) => page.data.length === 0);

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
          <div className="flex flex-wrap gap-2">
            <ColumnChooser
              hidden={hidden}
              toggle={columnState.toggle}
              showAll={columnState.showAll}
            />
            {canManage ? (
              <Button asChild>
                <Link to="/catalog/products/new">
                  <Plus />
                  {t('catalog.products.create')}
                </Link>
              </Button>
            ) : null}
          </div>
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
      <ProductTable pages={pages} columns={columns} context={context} canManage={canManage} />
      {empty ? (
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

/** «Баганууд»: show or hide each column; the code and the name always show. */
function ColumnChooser(props: {
  hidden: ReadonlySet<string>;
  toggle: (key: ProductColumnKey) => void;
  showAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3 />
          {t('catalog.products.columnsButton')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {PRODUCT_COLUMN_KEYS.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={!props.hidden.has(key)}
            disabled={LOCKED_PRODUCT_COLUMNS.includes(key)}
            onCheckedChange={() => props.toggle(key)}
            // Keep the menu open while several columns are picked.
            onSelect={(event) => event.preventDefault()}
          >
            {t(`catalog.products.columns.${key}`)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={props.hidden.size === 0} onSelect={props.showAll}>
          {t('catalog.products.showAllColumns')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
