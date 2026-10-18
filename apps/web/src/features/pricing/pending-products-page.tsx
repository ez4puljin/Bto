import { CircleCheck, Tags } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  SearchField,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type ProductSummary, useCategories, useProducts } from '@/features/catalog/api';
import { categoryPaths, categoryTree } from '@/features/catalog/category-tree';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useCurrentPricesOf, usePricingMutations } from './api';
import { PriceEntryDialog } from './price-entry-dialog';

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * Products waiting for their prices (ADR-0044 #3), the price clerk's list: each with its warehouse
 * price and price profile in force today (ADR-0048), «Үнэ оруулах» per row, and the ticked rows
 * completed at once. A completed product leaves the list and appears in every order; the focus then
 * goes to the next row's «Үнэ оруулах», so the clerk goes on down the list.
 */
export function PendingProductsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const categoryId = positiveId(params.get('category'));
  const products = useProducts({ q, categoryId, status: 'ACTIVE', saleReady: false });
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const prices = useCurrentPricesOf(
    rows.map((row) => row.id),
    true,
  );
  const categories = useCategories();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const mutations = usePricingMutations();
  const completion = useAction();
  const [key, setKey] = useState(randomUuid);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [entering, setEntering] = useState<ProductSummary | null>(null);
  // The row a completed product stood on: its next row's «Үнэ оруулах» takes the focus.
  const [completedAt, setCompletedAt] = useState<{ id: number; index: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!completedAt || rows.some((row) => row.id === completedAt.id)) return;
    setCompletedAt(null);
    const next = rows[completedAt.index] ?? rows[completedAt.index - 1];
    if (!next) return;
    const label = t('pricing.pending.enterPrices', { sku: next.sku });
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? [];
    Array.from(buttons)
      .find((button) => button.getAttribute('aria-label') === label)
      ?.focus();
  }, [completedAt, rows, t]);

  const chosen = rows.filter((row) => selected.has(row.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const termsOf = (productId: number) =>
    prices.data?.find((terms) => terms.productId === productId);
  // A refused completion names the products without terms; the generic message would repeat it.
  const missing =
    completion.problem?.code === 'PRICE_MISSING'
      ? (completion.problem.errors ?? []).map((error) => error.message)
      : [];
  const filtered = Boolean(q || categoryId);

  const toggle = (id: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const complete = async () => {
    const productIds = chosen.map((row) => row.id);
    let count = 0;
    const ok = await completion.run(async () => {
      const result = await mutations.completeProducts.mutateAsync({ key, productIds });
      count = result.completed.length + result.alreadyComplete.length;
    });
    if (ok) {
      toast.success(t('pricing.saleReady.completedMany', { count }));
      setSelected(new Set());
      setKey(randomUuid());
    }
  };

  return (
    <div>
      <PageHeader
        title={t('pricing.pending.title')}
        description={t('pricing.pending.description')}
        actions={
          // A disabled button shows no tooltip: its wrapper says why it waits.
          <span title={chosen.length === 0 ? t('pricing.pending.selectHint') : undefined}>
            <Button
              disabled={chosen.length === 0 || mutations.completeProducts.isPending}
              onClick={() => void complete()}
            >
              <CircleCheck />
              {chosen.length > 0
                ? t('pricing.pending.completeSelected', { count: chosen.length })
                : t('pricing.saleReady.complete')}
            </Button>
          </span>
        }
      />
      <FilterBar>
        <SearchField
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
      </FilterBar>
      {missing.length > 0 ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>
            {t('pricing.pending.missing', { skus: missing.join(', ') })}
          </AlertDescription>
        </Alert>
      ) : (
        <ProblemAlert problem={completion.problem ?? problemFromError(products.error)} />
      )}
      <div ref={list}>
        <ListCard scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t('pricing.pending.selectAll')}
                    checked={allChosen ? true : chosen.length > 0 ? 'indeterminate' : false}
                    disabled={rows.length === 0}
                    onCheckedChange={(checked) =>
                      setSelected(checked === true ? new Set(rows.map((row) => row.id)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>{t('catalog.products.columns.sku')}</TableHead>
                <TableHead>{t('catalog.products.columns.name')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('catalog.products.columns.category')}
                </TableHead>
                <TableHead className="text-right">
                  {t('catalog.products.columns.warehousePrice')}
                </TableHead>
                <TableHead>{t('catalog.products.columns.priceProfile')}</TableHead>
                <SpacerHead />
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.isPending ? <SkeletonRows columns={8} /> : null}
              {rows.map((row) => {
                const terms = termsOf(row.id);
                return (
                  <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                    <TableCell className="w-10 p-0 first:pl-0">
                      {/* The whole cell ticks the row (docs/ui.md), in line with the header box. */}
                      <label className="flex cursor-pointer items-center py-2.5 pr-3 pl-4">
                        <Checkbox
                          aria-label={t('pricing.pending.select', { sku: row.sku })}
                          checked={selected.has(row.id)}
                          onCheckedChange={(checked) => toggle(row.id, checked === true)}
                        />
                      </label>
                    </TableCell>
                    <TableCell className="font-mono">{row.sku}</TableCell>
                    <TruncateCell text={row.name} className="max-w-80">
                      <Link
                        to={`/catalog/products/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TruncateCell>
                    <TruncateCell
                      text={paths.get(row.categoryId) ?? ''}
                      className="hidden max-w-56 text-muted-foreground md:table-cell min-[1440px]:max-w-80"
                    />
                    <TableCell className="text-right font-mono">
                      {terms ? (
                        t('pricing.money', { amount: formatMnt(terms.warehousePrice) })
                      ) : (
                        // The price this list asks for: an orange pill, the work still to do.
                        <Badge variant="warning" className="font-sans">
                          {t('pricing.card.none')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {terms?.profileName ?? t('common.none')}
                    </TableCell>
                    <SpacerCell />
                    <RowActions>
                      <RowAction
                        label={t('pricing.pending.enterPrices', { sku: row.sku })}
                        icon={Tags}
                        onClick={() => setEntering(row)}
                      />
                    </RowActions>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!products.isPending && rows.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              title={t('pricing.pending.empty')}
              {...(filtered
                ? {
                    onClearFilters: () => {
                      setSearch('');
                      setParams(new URLSearchParams(), { replace: true });
                    },
                  }
                : {})}
            />
          ) : null}
          <LoadMore query={products} />
        </ListCard>
      </div>
      {entering ? (
        <PriceEntryDialog
          productId={entering.id}
          productLabel={`${entering.sku} ${entering.name}`}
          pending
          onCompleted={() =>
            setCompletedAt({
              id: entering.id,
              index: rows.findIndex((row) => row.id === entering.id),
            })
          }
          onClose={() => setEntering(null)}
        />
      ) : null}
    </div>
  );
}
