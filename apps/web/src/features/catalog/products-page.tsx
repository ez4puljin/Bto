import {
  EXPORTABLE_PRODUCT_COLUMNS,
  MAX_SELECTED_PRODUCTS,
  PRODUCT_LIST_COLUMNS,
} from '@tugeel/shared/catalog';
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
import { SegmentActions } from '@/features/segments/segment-actions';
import { saveBlob } from '@/lib/download';
import { formatCount } from '@/lib/money';
import { ApiProblem, problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import {
  productQueryBody,
  type ProductQueryFilter,
  type ProductStatus,
  useCategories,
  useExportProducts,
  useProductIds,
  useProductQuery,
} from './api';
import { categoryPaths, categoryTree } from './category-tree';
import { BulkActions } from './bulk-actions';
import {
  DEFAULT_HIDDEN_PRODUCT_COLUMNS,
  LOCKED_PRODUCT_COLUMNS,
  PRODUCT_COLUMNS,
  WIDE_DEFAULT_HIDDEN_PRODUCT_COLUMNS,
} from './product-columns';
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
import { useProductSelection } from './use-product-selection';

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

/**
 * Products: search by name in either script, SKU or barcode, filter by category (with its
 * subcategories), status and «Шүүлтүүр» (suppliers, homes, prices, stock, dates, missing data, a
 * segment; ADR-0049), with the count the filters keep. Filters live in the URL so "back" keeps
 * them (SPEC §5.2). Rows can be ticked; the ticks stay while the search and the filters change,
 * so the ticks of several searches go together, and «Таарсан бүгдийг сонгох» ticks every product
 * the filters keep beyond the loaded rows (ADR-0052). «Excel татах» writes the ticked rows, or
 * every row the filters keep, with the visible columns (ADR-0049 #6); «Засах» changes the ticked
 * products together (ADR-0051).
 * Every piece of product information has a column; each user picks which ones show on their
 * own browser (ADR-0037, ADR-0050).
 */
export function ProductsPage() {
  const { t } = useTranslation();
  const canRegister = useHasPermission('catalog.products.register');
  const canExport = useHasPermission('catalog.products.export');
  const canManageSegments = useHasPermission('segments.manage');
  // Rows can be ticked by whoever may export them, change them together (ADR-0051 #3) or make
  // a hand-picked segment of them (ADR-0052).
  const canSelect = [
    canExport,
    canManageSegments,
    useHasPermission('catalog.products.manage'),
    useHasPermission('partners.suppliers.manage'),
    useHasPermission('pricing.prices.manage'),
    useHasPermission('inventory.setup.manage'),
  ].some(Boolean);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = positiveId(params.get('category'));
  const stageParam = params.get('status');
  const stage = isStage(stageParam) ? stageParam : undefined;
  const filters = useMemo(() => readFilters(params), [params]);
  const where = useMemo(() => whereOf(filters), [filters]);
  const filter: ProductQueryFilter = {
    q,
    ...(categoryId ? { categoryId } : {}),
    ...(stage ? STAGE_FILTER[stage] : {}),
    ...(where ? { where } : {}),
    ...(filters.segment ? { segmentId: filters.segment } : {}),
  };
  const products = useProductQuery(filter);
  const total = products.data?.pages[0]?.total;
  const exportProducts = useExportProducts();
  const exporting = useAction();
  const ticks = useProductSelection();
  const { selected } = ticks;
  // «Таарсан бүгдийг сонгох»: the ids the current filters keep, once asked for (ADR-0052).
  const filterKey = JSON.stringify(productQueryBody(filter));
  const [matching, setMatching] = useState<{ key: string; ids: readonly number[] } | null>(null);
  const matchingIds = matching?.key === filterKey ? matching.ids : null;
  const productIds = useProductIds();
  const selecting = useAction();
  const selection = useMemo<ProductSelection>(
    () => ({
      selected,
      toggle: (id, on) => ticks.set([id], on),
      // Unticking the header after «Таарсан бүгдийг сонгох» unticks every match, loaded or not.
      setAll: (ids, on) => ticks.set(on || !matchingIds ? ids : [...ids, ...matchingIds], on),
    }),
    [selected, ticks, matchingIds],
  );
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const warehouseName = useWarehouseName();
  const columnState = useHiddenColumns(
    COLUMNS_LIST,
    PRODUCT_LIST_COLUMNS,
    LOCKED_PRODUCT_COLUMNS,
    DEFAULT_HIDDEN_PRODUCT_COLUMNS,
    WIDE_DEFAULT_HIDDEN_PRODUCT_COLUMNS,
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
  const loaded = pages.flatMap((page) => page.data);
  const tickedRows = loaded.filter((row) => selected.has(row.id));

  /** Every product the filters keep joins the ticks, never past the limit (ADR-0052). */
  const selectMatching = async () => {
    await selecting.run(async () => {
      const ids = await productIds.mutateAsync(filter);
      const count = selected.size + ids.filter((id) => !selected.has(id)).length;
      if (count > MAX_SELECTED_PRODUCTS) {
        throw new ApiProblem({
          type: 'about:blank',
          title: 'Selection too large',
          status: 422,
          code: 'SELECTION_TOO_LARGE',
          params: { count, limit: MAX_SELECTED_PRODUCTS },
        });
      }
      setMatching({ key: filterKey, ids });
      ticks.set(ids, true);
    });
  };
  const everyLoadedTicked = loaded.length > 0 && tickedRows.length === loaded.length;
  const moreThanLoaded = typeof total === 'number' && total > loaded.length;
  const matchingNote =
    everyLoadedTicked && moreThanLoaded ? (
      matchingIds?.every((id) => selected.has(id)) ? (
        <span className="px-1 text-sm text-muted-foreground">
          {t('catalog.products.selection.allMatchingDone', { total: formatCount(total) })}
        </span>
      ) : total > MAX_SELECTED_PRODUCTS ? (
        <span className="px-1 text-sm text-muted-foreground">
          {t('catalog.products.selection.tooMany', {
            total: formatCount(total),
            limit: formatCount(MAX_SELECTED_PRODUCTS),
          })}
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-link"
          disabled={productIds.isPending}
          onClick={() => void selectMatching()}
        >
          {productIds.isPending
            ? t('catalog.products.selection.selecting')
            : t('catalog.products.selection.allMatching', { total: formatCount(total) })}
        </Button>
      )
    ) : null;

  /** The ticked products, or every product the filters keep, with the visible columns. */
  const exportExcel = async () => {
    const columns = EXPORTABLE_PRODUCT_COLUMNS.filter((key) => !hidden.has(key));
    const body =
      selected.size > 0
        ? { productIds: [...selected], columns }
        : { ...productQueryBody(filter), columns };
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
  const filtered = Boolean(q || categoryId || stage || activeFilterFields(filters).length > 0);

  const setParam = useSetParam();
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };
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
          // One search width across the lists (15rem): the filters keep one row at 1366px.
          className="sm:w-60"
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
      <ProblemAlert
        problem={exporting.problem ?? selecting.problem ?? problemFromError(products.error)}
      />
      <ListCard scroll>
        <ProductTable
          pages={pages}
          columns={columns}
          context={context}
          {...(canSelect ? { selection } : {})}
        />
        {empty ? (
          <EmptyState
            icon={Package}
            title={t('catalog.products.empty')}
            {...(filtered ? { onClearFilters: clearFilters } : {})}
          />
        ) : null}
        <LoadMore query={products} />
      </ListCard>
      <SelectionBar count={selected.size} onClear={ticks.clear}>
        {matchingNote}
        {canExport ? exportButton : null}
        <BulkActions ids={[...selected]} rows={tickedRows} onDone={ticks.clear} />
        {canManageSegments ? (
          <SegmentActions
            ids={[...selected]}
            {...(filters.segment ? { segmentId: filters.segment } : {})}
            onDone={ticks.clear}
          />
        ) : null}
      </SelectionBar>
    </div>
  );
}
