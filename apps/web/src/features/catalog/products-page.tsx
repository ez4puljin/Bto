import { EXPORTABLE_PRODUCT_COLUMNS, PRODUCT_LIST_COLUMNS } from '@tugeel/shared/catalog';
import { businessDate } from '@tugeel/shared/time';
import { FileSpreadsheet, Package, Plus, Shapes } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import { EmptyState, FilterBar, ListCard, LoadMore, SearchField } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SelectionBar } from '@/components/selection-bar';
import { Button } from '@/components/ui/button';
import { useWarehouseName } from '@/features/inventory/helpers';
import { saveBlob } from '@/lib/download';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import {
  type ProductExportRequest,
  type ProductStatus,
  useCategories,
  useExportProducts,
  useProductQuery,
} from './api';
import { categoryPaths, categoryTree } from './category-tree';
import { LOCKED_PRODUCT_COLUMNS, PRODUCT_COLUMNS } from './product-columns';
import { ProductFilterMenu } from './product-filter-menu';
import {
  activeFilterFields,
  filterParam,
  PRODUCT_FILTER_FIELDS,
  type ProductFilters,
  readFilters,
  whereOf,
} from './product-filters';
import { type ProductStage } from './product-stage';
import { type ProductSelection, ProductTable, type ProductTableContext } from './product-table';

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

/** The list's name in the column-choice key (ADR-0050). */
const COLUMNS_LIST = 'catalog.products';
const NO_PAGES: readonly { data: never[] }[] = [];
const NO_IDS: ReadonlySet<number> = new Set();

/**
 * Products: search by name in either script, SKU or barcode, filter by category (with its
 * subcategories), status and «Шүүлтүүр» (suppliers, homes, prices, stock, dates, missing data, a
 * segment; ADR-0049), with the count the filters keep. Filters live in the URL so "back" keeps
 * them (SPEC §5.2). Rows can be ticked; «Excel татах» writes the ticked rows, or every row the
 * filters keep, with the visible columns (ADR-0049 #6). Changing a filter clears the ticks.
 * Every piece of product information has a column; each user picks which ones show on their
 * own browser (ADR-0037, ADR-0050).
 */
export function ProductsPage() {
  const { t } = useTranslation();
  const canRegister = useHasPermission('catalog.products.register');
  const canExport = useHasPermission('catalog.products.export');
  const canManageSegments = useHasPermission('segments.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = positiveId(params.get('category'));
  const stageParam = params.get('status');
  const stage = isStage(stageParam) ? stageParam : undefined;
  const filters = useMemo(() => readFilters(params), [params]);
  const where = useMemo(() => whereOf(filters), [filters]);
  const products = useProductQuery({
    q,
    categoryId,
    ...(stage ? STAGE_FILTER[stage] : {}),
    ...(where ? { where } : {}),
    ...(filters.segment ? { segmentId: filters.segment } : {}),
  });
  const total = products.data?.pages[0]?.total;
  const exportProducts = useExportProducts();
  const exporting = useAction();
  // Ticks belong to one set of filters: a change of filter starts with none.
  const filterKey = JSON.stringify([q, categoryId, stage, filters]);
  const [ticks, setTicks] = useState<{ key: string; ids: ReadonlySet<number> }>(() => ({
    key: filterKey,
    ids: NO_IDS,
  }));
  const selected = ticks.key === filterKey ? ticks.ids : NO_IDS;
  const selection = useMemo<ProductSelection>(
    () => ({
      selected,
      toggle: (id, on) => {
        const ids = new Set(selected);
        if (on) ids.add(id);
        else ids.delete(id);
        setTicks({ key: filterKey, ids });
      },
      setAll: (ids, on) => setTicks({ key: filterKey, ids: on ? new Set(ids) : NO_IDS }),
    }),
    [selected, filterKey],
  );
  const clearTicks = () => setTicks({ key: filterKey, ids: NO_IDS });
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const warehouseName = useWarehouseName();
  const columnState = useHiddenColumns(COLUMNS_LIST, PRODUCT_LIST_COLUMNS, LOCKED_PRODUCT_COLUMNS);
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

  /** The ticked products, or every product the filters keep, with the visible columns. */
  const exportExcel = async () => {
    const columns = EXPORTABLE_PRODUCT_COLUMNS.filter((key) => !hidden.has(key));
    const body: ProductExportRequest =
      selected.size > 0
        ? { productIds: [...selected], columns }
        : {
            ...(q ? { q } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(stage ? STAGE_FILTER[stage] : {}),
            ...(where ? { where } : {}),
            ...(filters.segment ? { segmentId: filters.segment } : {}),
            columns,
          };
    await exporting.run(async () => {
      const file = await exportProducts.mutateAsync(body);
      saveBlob(file, `${t('catalog.products.title')} ${businessDate()}.xlsx`);
    });
  };
  const exportButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={exportProducts.isPending}
      onClick={() => void exportExcel()}
    >
      <FileSpreadsheet />
      {exportProducts.isPending
        ? t('catalog.products.export.pending')
        : t('catalog.products.export.button')}
    </Button>
  );
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
  const applyFilters = (next: ProductFilters) =>
    setParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        for (const field of PRODUCT_FILTER_FIELDS) {
          const value = filterParam(field, next);
          if (value === null) params.delete(field);
          else params.set(field, value);
        }
        return params;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title={t('catalog.products.title')}
        meta={
          typeof total === 'number' ? (
            <span className="tabular-nums">
              {t('catalog.products.count', { total: formatCount(total) })}
            </span>
          ) : null
        }
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
          <>
            {canExport && selected.size === 0 ? exportButton : null}
            <ColumnChooser
              keys={PRODUCT_LIST_COLUMNS}
              locked={LOCKED_PRODUCT_COLUMNS}
              label={(key) => t(`catalog.products.columns.${key}`)}
              hidden={hidden}
              toggle={columnState.toggle}
              showAll={columnState.showAll}
            />
          </>
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
        <ProductFilterMenu filters={filters} onChange={applyFilters} />
        {canManageSegments &&
        (q ||
          categoryId ||
          stage ||
          activeFilterFields(filters).some((field) => field !== 'segment')) ? (
          <Button asChild variant="ghost" size="sm" className="text-link">
            <Link to={`/segments/new?entity=PRODUCT&from=${encodeURIComponent(params.toString())}`}>
              <Shapes />
              {t('segments.fromFilters')}
            </Link>
          </Button>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={exporting.problem ?? problemFromError(products.error)} />
      <ListCard>
        <ProductTable
          pages={pages}
          columns={columns}
          context={context}
          {...(canExport ? { selection } : {})}
        />
        {empty ? <EmptyState icon={Package} title={t('catalog.products.empty')} /> : null}
        <LoadMore query={products} />
      </ListCard>
      <SelectionBar count={selected.size} onClear={clearTicks}>
        {canExport ? exportButton : null}
      </SelectionBar>
    </div>
  );
}
