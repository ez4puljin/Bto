import {
  EXPIRY_LIABILITY_TYPES,
  EXPIRY_VIEWS,
  type ExpiryLiabilityType,
  type ExpiryView,
} from '@tugeel/shared/expiry';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilterChoices, FilterOption, FilterSection } from '@/components/filter-panel';
import { ListCard } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import type { ExpiryFilter, ExpiryFilterOptions } from './helpers';

/** One way to change one filter; an empty value lifts it. */
export type SetExpiryFilter = (
  param: 'view' | 'supplier' | 'warehouse' | 'author' | 'liability',
  value: string,
) => void;

/** A filter's long list of choices keeps its own scroll, so the panel stays short. */
const LONG_LIST = 'flex max-h-56 flex-col gap-0.5 overflow-y-auto';

/** The list's left side from `lg`, like the supplier list's (owner 2026-11-06). */
export function ExpiryFilterPanel(props: {
  filter: ExpiryFilter;
  options: ExpiryFilterOptions;
  /** The choices have arrived: until then an empty list says nothing. */
  loaded: boolean;
  onChange: SetExpiryFilter;
}) {
  const { t } = useTranslation();
  const { filter, options, onChange } = props;
  const empty = props.loaded ? (
    <p className="px-2 py-1 text-[0.8125rem] text-muted-foreground">
      {t('expiry.filters.noOptions')}
    </p>
  ) : null;
  return (
    <aside aria-label={t('expiry.filters.label')} className="hidden w-64 shrink-0 lg:block">
      <ListCard scroll beside>
        <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
          <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
          {t('expiry.filters.title')}
        </div>
        <FilterSection
          title={t('expiry.filters.view')}
          defaultOpen
          active={filter.view !== 'ACTIVE'}
        >
          <FilterChoices<ExpiryView>
            options={EXPIRY_VIEWS}
            label={(view) => t(`expiry.views.${view}`)}
            value={filter.view}
            onChange={(view) => onChange('view', view && view !== 'ACTIVE' ? view : '')}
          />
        </FilterSection>
        <FilterSection
          title={t('expiry.filters.supplier')}
          defaultOpen
          active={filter.supplierId !== undefined}
        >
          <div className={LONG_LIST}>
            {options.suppliers.map((supplier) => (
              <FilterOption
                key={supplier.id}
                label={supplier.name}
                active={filter.supplierId === supplier.id}
                onClick={() =>
                  onChange('supplier', filter.supplierId === supplier.id ? '' : String(supplier.id))
                }
              />
            ))}
            {options.suppliers.length === 0 ? empty : null}
          </div>
        </FilterSection>
        <FilterSection
          title={t('expiry.filters.warehouse')}
          defaultOpen
          active={filter.warehouseId !== undefined}
        >
          <div className={LONG_LIST}>
            {options.warehouses.map((warehouse) => (
              <FilterOption
                key={warehouse.id}
                label={warehouse.name}
                active={filter.warehouseId === warehouse.id}
                onClick={() =>
                  onChange(
                    'warehouse',
                    filter.warehouseId === warehouse.id ? '' : String(warehouse.id),
                  )
                }
              />
            ))}
            {options.warehouses.length === 0 ? empty : null}
          </div>
        </FilterSection>
        <FilterSection
          title={t('expiry.filters.author')}
          active={filter.createdByName !== undefined}
        >
          <div className={LONG_LIST}>
            {options.creators.map((name) => (
              <FilterOption
                key={name}
                label={name}
                active={filter.createdByName === name}
                onClick={() => onChange('author', filter.createdByName === name ? '' : name)}
              />
            ))}
            {options.creators.length === 0 ? empty : null}
          </div>
        </FilterSection>
        <FilterSection
          title={t('expiry.filters.liability')}
          active={filter.liability !== undefined}
        >
          <FilterChoices<ExpiryLiabilityType>
            options={EXPIRY_LIABILITY_TYPES}
            label={(type) => t(`expiry.liabilityType.${type}`)}
            value={filter.liability ?? null}
            onChange={(type) => onChange('liability', type ?? '')}
          />
        </FilterSection>
      </ListCard>
    </aside>
  );
}

/** The same filters in the filter bar below `lg`, where the left side gives way. */
export function ExpiryFilterSelects(props: {
  filter: ExpiryFilter;
  options: ExpiryFilterOptions;
  onChange: SetExpiryFilter;
}) {
  const { t } = useTranslation();
  const { filter, options, onChange } = props;
  return (
    <>
      <NativeSelect
        className="lg:hidden"
        variant="filter"
        active={filter.view !== 'ACTIVE'}
        aria-label={t('expiry.filters.view')}
        value={filter.view}
        onChange={(event) =>
          onChange('view', event.target.value === 'ACTIVE' ? '' : event.target.value)
        }
      >
        {EXPIRY_VIEWS.map((view) => (
          <option key={view} value={view}>
            {t(`expiry.views.${view}`)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        className="lg:hidden"
        variant="filter"
        aria-label={t('expiry.filters.supplier')}
        value={filter.supplierId ?? ''}
        onChange={(event) => onChange('supplier', event.target.value)}
      >
        <option value="">{t('expiry.filters.allSuppliers')}</option>
        {options.suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        className="lg:hidden"
        variant="filter"
        aria-label={t('expiry.filters.warehouse')}
        value={filter.warehouseId ?? ''}
        onChange={(event) => onChange('warehouse', event.target.value)}
      >
        <option value="">{t('expiry.filters.allWarehouses')}</option>
        {options.warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        className="lg:hidden"
        variant="filter"
        aria-label={t('expiry.filters.author')}
        value={filter.createdByName ?? ''}
        onChange={(event) => onChange('author', event.target.value)}
      >
        <option value="">{t('expiry.filters.allAuthors')}</option>
        {options.creators.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        className="lg:hidden"
        variant="filter"
        aria-label={t('expiry.filters.liability')}
        value={filter.liability ?? ''}
        onChange={(event) => onChange('liability', event.target.value)}
      >
        <option value="">{t('expiry.filters.allLiability')}</option>
        {EXPIRY_LIABILITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`expiry.liabilityType.${type}`)}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}
