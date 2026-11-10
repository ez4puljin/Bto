import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FilterOption as Option, FilterSection as Section } from '@/components/filter-panel';
import { ListCard } from '@/components/list';
import { useWarehouses } from '@/features/identity/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { useSegments } from '@/features/segments/api';
import type { Category } from './api';
import { CategoryFilterTree } from './category-filter-tree';
import { ProductFilterDialog } from './product-filter-dialog';
import {
  DATE_PRESETS,
  type DateFilter,
  filterParam,
  MISSING_CHOICES,
  missingLabelKey,
  type ProductFilterField,
  type ProductFilters,
  STOCK_KINDS,
  withFilter,
} from './product-filters';
import type { ProductStage } from './product-stage';

const SELLING_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];

const toggled = (ids: readonly number[] | undefined, id: number) =>
  ids?.includes(id) ? ids.filter((value) => value !== id) : [...(ids ?? []), id];

const sameDays = (filter: DateFilter | undefined, days: number) =>
  filter !== undefined && 'days' in filter && filter.days === days;

/** The panel's sections: the category tree, the status, and one per filter of the address. */
export type ProductPanelSection = 'category' | 'status' | ProductFilterField;
const ALL_SECTIONS: readonly ProductPanelSection[] = [
  'category',
  'segment',
  'status',
  'supplier',
  'home',
  'profile',
  'price',
  'stock',
  'created',
  'updated',
  'missing',
];

/**
 * The product list's left side, after erxes (owner 2026-11-06): the categories on top with their
 * counts, then every filter with its choices in sight. A filter whose choices cannot be listed
 * (suppliers, a price range, chosen dates) opens its dialog. It writes what the list already reads
 * from the address, so a link and «back» keep working. Another list of products (the stock list,
 * owner 2026-11-10) shows the sections that make sense for it, in this order.
 */
export function ProductFilterPanel(props: {
  categories: readonly Category[];
  categoryId: number | undefined;
  onCategory: (id: number | undefined) => void;
  stages: readonly ProductStage[];
  stage: ProductStage | undefined;
  onStage: (stage: ProductStage | undefined) => void;
  filters: ProductFilters;
  onChange: (next: ProductFilters) => void;
  /** The sections shown (default: all). */
  sections?: readonly ProductPanelSection[];
  /** false: the stock section's warehouse is the page's own, so no warehouse choice here. */
  stockWarehouse?: boolean;
}) {
  const { t } = useTranslation();
  const { filters } = props;
  const [dialog, setDialog] = useState<ProductFilterField | null>(null);
  const segments = useSegments('PRODUCT');
  const warehouses = useWarehouses();
  const profiles = usePriceProfileChoices();
  const selling = (warehouses.data ?? []).filter(
    (warehouse) => warehouse.status === 'ACTIVE' && SELLING_KINDS.includes(warehouse.kind),
  );
  const set = <F extends ProductFilterField>(field: F, value: ProductFilters[F] | undefined) =>
    props.onChange(withFilter(filters, field, value));
  const inUse = (field: ProductFilterField) => filterParam(field, filters) !== null;
  const shown = new Set(props.sections ?? ALL_SECTIONS);
  const more = (field: ProductFilterField, label: string) => (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.8125rem] font-medium text-link hover:bg-accent"
      onClick={() => setDialog(field)}
    >
      <SlidersHorizontal aria-hidden className="size-3.5" />
      {label}
    </button>
  );
  const dateSection = (field: 'created' | 'updated') => (
    <Section
      key={field}
      title={t(`catalog.products.filters.fields.${field}`)}
      active={inUse(field)}
    >
      {DATE_PRESETS.map((days) => (
        <Option
          key={days}
          label={
            days === 1
              ? t('catalog.products.filters.today')
              : t('catalog.products.filters.lastDays', { count: days })
          }
          active={sameDays(filters[field], days)}
          onClick={() => set(field, sameDays(filters[field], days) ? undefined : { days })}
        />
      ))}
      {more(field, t('catalog.products.panel.chooseDates'))}
    </Section>
  );

  return (
    <aside aria-label={t('catalog.products.panel.label')} className="hidden w-72 shrink-0 lg:block">
      <ListCard scroll beside>
        {shown.has('category') ? (
          <Section title={t('catalog.product.category')} defaultOpen>
            <CategoryFilterTree
              categories={props.categories}
              selected={props.categoryId}
              onPick={props.onCategory}
            />
          </Section>
        ) : null}
        {shown.has('segment') ? (
          <Section title={t('catalog.products.filters.fields.segment')} active={inUse('segment')}>
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {(segments.data ?? []).map((segment) => (
                <Option
                  key={segment.id}
                  label={segment.name}
                  active={filters.segment === segment.id}
                  onClick={() =>
                    set('segment', filters.segment === segment.id ? undefined : segment.id)
                  }
                />
              ))}
            </div>
            <Link
              to="/segments"
              className="rounded-md px-2 py-1 text-[0.8125rem] font-medium text-link hover:bg-accent"
            >
              {t('catalog.products.panel.manageSegments')}
            </Link>
          </Section>
        ) : null}
        {shown.has('status') ? (
          <Section
            title={t('catalog.product.status')}
            active={props.stage !== undefined}
            defaultOpen
          >
            {props.stages.map((value) => (
              <Option
                key={value}
                label={t(`catalog.products.status.${value}`)}
                active={props.stage === value}
                onClick={() => props.onStage(props.stage === value ? undefined : value)}
              />
            ))}
          </Section>
        ) : null}
        {shown.has('supplier') ? (
          <Section title={t('catalog.products.filters.fields.supplier')} active={inUse('supplier')}>
            {more('supplier', t('catalog.products.panel.chooseSuppliers'))}
          </Section>
        ) : null}
        {shown.has('home') ? (
          <Section title={t('catalog.products.filters.fields.home')} active={inUse('home')}>
            {selling.map((warehouse) => (
              <Option
                key={warehouse.id}
                label={warehouse.name}
                active={filters.home?.includes(warehouse.id) ?? false}
                onClick={() => {
                  const next = toggled(filters.home, warehouse.id);
                  set('home', next.length > 0 ? next : undefined);
                }}
              />
            ))}
          </Section>
        ) : null}
        {shown.has('profile') ? (
          <Section title={t('catalog.products.filters.fields.profile')} active={inUse('profile')}>
            {(profiles.data ?? []).map((profile) => (
              <Option
                key={profile.id}
                label={profile.name}
                active={filters.profile?.includes(profile.id) ?? false}
                onClick={() => {
                  const next = toggled(filters.profile, profile.id);
                  set('profile', next.length > 0 ? next : undefined);
                }}
              />
            ))}
          </Section>
        ) : null}
        {shown.has('price') ? (
          <Section title={t('catalog.products.filters.fields.price')} active={inUse('price')}>
            {more('price', t('catalog.products.panel.choosePrice'))}
          </Section>
        ) : null}
        {shown.has('stock') ? (
          <Section
            title={t('catalog.products.filters.fields.stock')}
            active={inUse('stock')}
            defaultOpen={props.stockWarehouse === false}
          >
            {STOCK_KINDS.map((kind) => (
              <Option
                key={kind}
                label={t(`catalog.products.filters.stockKinds.${kind}`)}
                active={filters.stock?.kind === kind}
                onClick={() => set('stock', filters.stock?.kind === kind ? undefined : { kind })}
              />
            ))}
            {props.stockWarehouse === false
              ? null
              : more('stock', t('catalog.products.panel.chooseWarehouse'))}
          </Section>
        ) : null}
        {shown.has('created') ? dateSection('created') : null}
        {shown.has('updated') ? dateSection('updated') : null}
        {shown.has('missing') ? (
          <Section title={t('catalog.products.filters.fields.missing')} active={inUse('missing')}>
            {MISSING_CHOICES.map((choice) => {
              const chosen = filters.missing ?? [];
              const active = chosen.includes(choice);
              return (
                <Option
                  key={choice}
                  label={t(missingLabelKey(choice))}
                  active={active}
                  onClick={() => {
                    const next = active
                      ? chosen.filter((value) => value !== choice)
                      : [...chosen, choice];
                    set('missing', next.length > 0 ? next : undefined);
                  }}
                />
              );
            })}
          </Section>
        ) : null}
      </ListCard>
      {dialog ? (
        <ProductFilterDialog
          field={dialog}
          filters={filters}
          apply={(next) => {
            props.onChange(next);
            setDialog(null);
          }}
          close={() => setDialog(null)}
        />
      ) : null}
    </aside>
  );
}
