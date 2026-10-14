import { CircleCheck, Tags } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
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
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
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
 * completed at once. A completed product leaves the list and appears in every order.
 */
export function PendingProductsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
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

  const chosen = rows.filter((row) => selected.has(row.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const termsOf = (productId: number) =>
    prices.data?.find((terms) => terms.productId === productId);
  const missing =
    completion.problem?.code === 'PRICE_MISSING'
      ? (completion.problem.errors ?? []).map((error) => error.message)
      : [];

  const setParam = (name: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
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
        actions={
          <Button
            disabled={chosen.length === 0 || mutations.completeProducts.isPending}
            onClick={() => void complete()}
          >
            <CircleCheck />
            {chosen.length > 0
              ? t('pricing.pending.completeSelected', { count: chosen.length })
              : t('pricing.saleReady.complete')}
          </Button>
        }
      />
      <FilterBar>
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
      </FilterBar>
      <ProblemAlert problem={completion.problem ?? problemFromError(products.error)} />
      {missing.length > 0 ? (
        <p className="mb-3 text-sm text-destructive">
          {t('pricing.pending.missing', { skus: missing.join(', ') })}
        </p>
      ) : null}
      <ListCard>
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
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => (
              <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={t('pricing.pending.select', { sku: row.sku })}
                    checked={selected.has(row.id)}
                    onCheckedChange={(checked) => toggle(row.id, checked === true)}
                  />
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{row.sku}</TableCell>
                <TableCell>
                  <Link to={`/catalog/products/${row.id}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {paths.get(row.categoryId)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {termsOf(row.id) ? (
                    t('pricing.money', {
                      amount: formatMnt(termsOf(row.id)?.warehousePrice ?? '0'),
                    })
                  ) : (
                    <span className="font-sans text-xs text-warning">{t('pricing.card.none')}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {termsOf(row.id)?.profileName ?? t('common.none')}
                </TableCell>
                <RowActions>
                  <RowAction
                    label={t('pricing.pending.enterPrices', { sku: row.sku })}
                    icon={Tags}
                    onClick={() => setEntering(row)}
                  />
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!products.isPending && rows.length === 0 ? (
          <EmptyState icon={CircleCheck} title={t('pricing.pending.empty')} />
        ) : null}
        <LoadMore query={products} />
      </ListCard>
      {entering ? (
        <PriceEntryDialog
          productId={entering.id}
          productLabel={`${entering.sku} ${entering.name}`}
          pending
          onClose={() => setEntering(null)}
        />
      ) : null}
    </div>
  );
}
