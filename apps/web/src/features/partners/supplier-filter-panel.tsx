import { Settings2, SlidersHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FilterChoices, FilterOption, FilterSection } from '@/components/filter-panel';
import { FilterTree } from '@/components/filter-tree';
import { ListCard } from '@/components/list';
import { useCategories } from '@/features/catalog/api';
import { CategoryFilterTree } from '@/features/catalog/category-filter-tree';
import { useSegments } from '@/features/segments/api';
import { type PartnerStatus, useSupplierCategories } from './api';
import { PARTNER_STATUSES } from './partner-schema';

/**
 * The supplier list's left side, like the product list's (owner 2026-11-06): what they sell on top,
 * each tree with a box that finds a category, then their own category, status and segments.
 */
export function SupplierFilterPanel(props: {
  productCategoryId: number | undefined;
  onProductCategory: (id: number | undefined) => void;
  categoryId: number | undefined;
  onCategory: (id: number | undefined) => void;
  status: PartnerStatus | undefined;
  onStatus: (status: PartnerStatus | null) => void;
  segmentId: number | undefined;
  onSegment: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const productCategories = useCategories();
  const categories = useSupplierCategories();
  const segments = useSegments('SUPPLIER');
  // A retired category leaves the side, unless the list stands on it.
  const rows = useMemo(
    () =>
      (categories.data ?? [])
        .filter((category) => category.active || category.id === props.categoryId)
        .map((category) => ({
          id: category.id,
          parentId: category.parentId,
          title: category.name,
          name: category.name,
          count: category.supplierCount,
        })),
    [categories.data, props.categoryId],
  );
  const find = t('partners.suppliers.panel.findCategory');
  const noMatch = t('partners.suppliers.panel.noMatch');
  const segmentRows = segments.data ?? [];

  return (
    <aside
      aria-label={t('partners.suppliers.panel.label')}
      className="hidden w-64 shrink-0 lg:block"
    >
      <ListCard scroll beside>
        <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
          <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
          {t('partners.suppliers.panel.title')}
        </div>
        <FilterSection
          title={t('partners.suppliers.productCategory')}
          defaultOpen
          active={props.productCategoryId !== undefined}
        >
          <CategoryFilterTree
            categories={productCategories.data ?? []}
            selected={props.productCategoryId}
            onPick={props.onProductCategory}
            searchLabel={find}
            noMatchLabel={noMatch}
          />
        </FilterSection>
        <FilterSection
          title={t('partners.suppliers.panel.supplierCategory')}
          defaultOpen
          active={props.categoryId !== undefined}
        >
          {rows.length > 0 ? (
            <FilterTree
              rows={rows}
              selected={props.categoryId}
              onPick={props.onCategory}
              allLabel={t('partners.suppliers.allCategories')}
              searchLabel={t('partners.suppliers.panel.findSupplierCategory')}
              noMatchLabel={noMatch}
            />
          ) : (
            <p className="px-2 py-1 text-[0.8125rem] text-muted-foreground">
              {t('partners.supplierCategories.empty')}
            </p>
          )}
          <Link
            to="/partners/supplier-categories"
            className="mt-1 inline-flex items-center gap-1.5 px-2 py-1 text-xs text-link underline-offset-4 hover:underline"
          >
            <Settings2 aria-hidden className="size-3.5" />
            {t('partners.suppliers.panel.settings')}
          </Link>
        </FilterSection>
        <FilterSection
          title={t('partners.supplier.status')}
          defaultOpen
          active={props.status !== undefined}
        >
          <FilterChoices
            options={PARTNER_STATUSES}
            label={(value) => t(`partners.status.${value}`)}
            value={props.status ?? null}
            onChange={props.onStatus}
          />
        </FilterSection>
        {segmentRows.length > 0 ? (
          <FilterSection
            title={t('catalog.products.filters.fields.segment')}
            active={props.segmentId !== undefined}
          >
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {segmentRows.map((segment) => (
                <FilterOption
                  key={segment.id}
                  label={segment.name}
                  active={props.segmentId === segment.id}
                  onClick={() =>
                    props.onSegment(props.segmentId === segment.id ? undefined : segment.id)
                  }
                />
              ))}
            </div>
          </FilterSection>
        ) : null}
      </ListCard>
    </aside>
  );
}
