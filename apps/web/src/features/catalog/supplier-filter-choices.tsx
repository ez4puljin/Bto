import { X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_CONDITION_IDS } from '@tugeel/shared/segments';
import { CheckboxGroup } from '@/components/checkbox-group';
import { FilterTree } from '@/components/filter-tree';
import { SearchField } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { useSupplierCategories, useSuppliers, useSuppliersByIds } from '@/features/partners/api';
import { problemFromError } from '@/lib/problem';

/** Browse suppliers by their own category, keeping the selection across searches and pages. */
export function SupplierFilterChoices(props: { ids: number[]; onChange: (ids: number[]) => void }) {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [browsingAll, setBrowsingAll] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const categories = useSupplierCategories();
  const categoryRows = useMemo(
    () =>
      (categories.data ?? [])
        .filter((category) => category.active)
        .map((category) => ({
          id: category.id,
          parentId: category.parentId,
          title: category.name,
          name: category.name,
          count: category.supplierCount,
        })),
    [categories.data],
  );
  // Start with the categories. A direct search or "all" works without choosing a category.
  const browsing =
    categoryId !== undefined ||
    browsingAll ||
    q.length > 0 ||
    (categories.isSuccess && categoryRows.length === 0);
  const found = useSuppliers({ q, categoryId }, { limit: 20, enabled: browsing });
  const chosen = useSuppliersByIds(props.ids);
  // keepPreviousData must not show a different category's rows under the newly chosen one.
  const rows = found.isPlaceholderData
    ? []
    : (found.data?.pages.flatMap((page) => page.data) ?? []);
  const names = new Map(
    [...(chosen.data ?? []), ...rows].map((supplier) => [supplier.id, supplier.name]),
  );
  const loading = browsing && (found.isPending || found.isPlaceholderData);
  const atLimit = props.ids.length >= MAX_CONDITION_IDS;
  const pickCategory = (id: number | undefined) => {
    setCategoryId(id);
    setBrowsingAll(id === undefined);
  };

  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        // Enter searches/browses here; applying the surrounding form is an explicit action.
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement &&
          event.target.type === 'search'
        ) {
          event.preventDefault();
        }
      }}
    >
      {props.ids.length > 0 ? (
        <section
          aria-label={t('catalog.products.filters.selectedSuppliers')}
          className="flex flex-col gap-2"
        >
          <p className="text-sm font-medium">
            {t('catalog.products.filters.selectedSupplierCount', { count: props.ids.length })}
          </p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {props.ids.map((id) => {
              const name = names.get(id);
              return name ? (
                <Button
                  key={id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                  aria-label={t('catalog.products.filters.removeSupplier', { name })}
                  onClick={() => props.onChange(props.ids.filter((value) => value !== id))}
                >
                  <span className="min-w-0 break-words">{name}</span>
                  <X aria-hidden className="size-3.5 shrink-0" />
                </Button>
              ) : null;
            })}
          </div>
          <ProblemAlert problem={problemFromError(chosen.error)} onRetry={() => chosen.refetch()} />
        </section>
      ) : null}
      {atLimit ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('catalog.products.filters.supplierLimit', { count: MAX_CONDITION_IDS })}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section
          aria-label={t('partners.suppliers.panel.supplierCategory')}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 className="text-sm font-medium">{t('partners.suppliers.panel.supplierCategory')}</h3>
          <ProblemAlert
            problem={problemFromError(categories.error)}
            onRetry={() => categories.refetch()}
          />
          {categories.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border p-2">
              <FilterTree
                rows={categoryRows}
                selected={categoryId}
                onPick={pickCategory}
                allLabel={t('partners.suppliers.allCategories')}
                searchLabel={t('partners.suppliers.panel.findSupplierCategory')}
                noMatchLabel={t('catalog.products.filters.noMatches')}
              />
            </div>
          )}
        </section>
        <section
          aria-label={t('catalog.products.filters.fields.supplier')}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 className="text-sm font-medium">{t('catalog.products.filters.fields.supplier')}</h3>
          <SearchField
            className="sm:w-full"
            aria-label={t('catalog.products.filters.searchSupplier')}
            placeholder={t('catalog.products.filters.searchSupplier')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ProblemAlert problem={problemFromError(found.error)} onRetry={() => found.refetch()} />
          <div className="max-h-64 overflow-y-auto rounded-lg border p-3" aria-busy={loading}>
            {!browsing ? (
              <p className="text-sm text-muted-foreground">
                {t('catalog.products.filters.browseSuppliersHint')}
              </p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : rows.length === 0 && !found.isError ? (
              <p className="text-sm text-muted-foreground">
                {t('catalog.products.filters.noMatches')}
              </p>
            ) : (
              <CheckboxGroup
                name="filter-supplier"
                options={rows.map((row) => ({
                  value: row.id,
                  label: row.name,
                  disabled: atLimit && !props.ids.includes(row.id),
                }))}
                value={props.ids}
                onChange={(ids) => {
                  if (ids.length <= MAX_CONDITION_IDS) props.onChange(ids);
                }}
              />
            )}
            {browsing && !found.isPlaceholderData && found.hasNextPage ? (
              <div className="mt-2 flex justify-center border-t pt-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  pending={found.isFetchingNextPage}
                  onClick={() => void found.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
