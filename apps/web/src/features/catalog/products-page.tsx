import { PRODUCT_LIST_COLUMNS } from '@tugeel/shared/catalog';
import { Package, Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import { EmptyState, FilterBar, ListCard, LoadMore, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { useWarehouseName } from '@/features/inventory/helpers';
import { problemFromError } from '@/lib/problem';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { type ProductStatus, useCategories, useProducts } from './api';
import { categoryPaths, categoryTree } from './category-tree';
import { LOCKED_PRODUCT_COLUMNS, PRODUCT_COLUMNS } from './product-columns';
import { type ProductStage } from './product-stage';
import { ProductTable, type ProductTableContext } from './product-table';

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};
/** The status pill: complete, waiting for prices (ADR-0044) or not in use. */
const STAGES: readonly ProductStage[] = ['ACTIVE', 'PENDING', 'INACTIVE'];
const isStage = (value: string | null): value is ProductStage =>
  STAGES.some((stage) => stage === value);
const STAGE_FILTER: Record<ProductStage, { status: ProductStatus; saleReady?: boolean }> = {
  ACTIVE: { status: 'ACTIVE', saleReady: true },
  PENDING: { status: 'ACTIVE', saleReady: false },
  INACTIVE: { status: 'INACTIVE' },
};

const COLUMNS_STORAGE_KEY = 'tugeel.catalog.products.hiddenColumns.v1';
const NO_PAGES: readonly { data: never[] }[] = [];

/**
 * Products: search by name in either script, SKU or barcode, filter by category (with its
 * subcategories) and status. Filters live in the URL so "back" keeps them (SPEC §5.2).
 * Every piece of product information has a column; the user picks which ones show (ADR-0037).
 */
export function ProductsPage() {
  const { t } = useTranslation();
  const canRegister = useHasPermission('catalog.products.register');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = positiveId(params.get('category'));
  const stageParam = params.get('status');
  const stage = isStage(stageParam) ? stageParam : undefined;
  const products = useProducts({ q, categoryId, ...(stage ? STAGE_FILTER[stage] : {}) });
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const warehouseName = useWarehouseName();
  const columnState = useHiddenColumns(
    COLUMNS_STORAGE_KEY,
    PRODUCT_LIST_COLUMNS,
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
      warehouseName,
    }),
    [t, paths, warehouseName],
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
          canRegister ? (
            <Button asChild>
              <Link to="/catalog/products/new">
                <Plus />
                {t('catalog.products.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar
        end={
          <ColumnChooser
            keys={PRODUCT_LIST_COLUMNS}
            locked={LOCKED_PRODUCT_COLUMNS}
            label={(key) => t(`catalog.products.columns.${key}`)}
            hidden={hidden}
            toggle={columnState.toggle}
            showAll={columnState.showAll}
          />
        }
      >
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('catalog.products.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
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
        <NativeSelect
          variant="filter"
          aria-label={t('catalog.product.status')}
          value={stage ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('catalog.products.allStatuses')}</option>
          {STAGES.map((value) => (
            <option key={value} value={value}>
              {t(`catalog.products.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(products.error)} />
      <ListCard>
        <ProductTable pages={pages} columns={columns} context={context} />
        {empty ? <EmptyState icon={Package} title={t('catalog.products.empty')} /> : null}
        <LoadMore query={products} />
      </ListCard>
    </div>
  );
}
