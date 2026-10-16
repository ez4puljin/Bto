import type { TFunction } from 'i18next';
import { Check, ListFilter } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterChip } from '@/components/list';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWarehouseName } from '@/features/inventory/helpers';
import { useSuppliersByIds } from '@/features/partners/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { useSegments } from '@/features/segments/api';
import { formatMnt } from '@/lib/money';
import { ProductFilterDialog } from './product-filter-dialog';
import {
  activeFilterFields,
  type DateFilter,
  PRODUCT_FILTER_FIELDS,
  missingLabelKey,
  type ProductFilterField,
  type ProductFilters,
  withFilter,
} from './product-filters';

/** Shown while a chip's names load. */
const LOADING = '…';

/**
 * «Шүүлтүүр» and the chips of the active filters (ADR-0049): the menu lists every field (a tick on
 * the active ones); a chip names its filter and values, opens the field's dialog on a click, and
 * its button removes the filter. «Бүгдийг арилгах» clears every filter of the menu.
 */
export function ProductFilterMenu(props: {
  filters: ProductFilters;
  onChange: (next: ProductFilters) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ProductFilterField | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = activeFilterFields(props.filters);
  const close = () => {
    setOpen(null);
    // The menu item is gone by the time the dialog closes: the focus goes back to the menu button.
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="outline" size="sm">
            <ListFilter />
            {t('catalog.products.filters.menu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {PRODUCT_FILTER_FIELDS.map((field) => (
            <DropdownMenuItem key={field} onSelect={() => setOpen(field)}>
              {t(`catalog.products.filters.fields.${field}`)}
              {active.includes(field) ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active.map((field) => (
        <ActiveFilter
          key={field}
          field={field}
          filters={props.filters}
          onEdit={() => setOpen(field)}
          onRemove={() => props.onChange(withFilter(props.filters, field, undefined))}
        />
      ))}
      {active.length > 1 ? (
        <Button variant="ghost" size="sm" className="text-link" onClick={() => props.onChange({})}>
          {t('catalog.products.filters.clearAll')}
        </Button>
      ) : null}
      {open ? (
        <ProductFilterDialog
          field={open}
          filters={props.filters}
          apply={(next) => {
            props.onChange(next);
            close();
          }}
          close={close}
        />
      ) : null}
    </>
  );
}

function ActiveFilter(props: {
  field: ProductFilterField;
  filters: ProductFilters;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name =
    props.field === 'supplier' && props.filters.supplier?.main
      ? t('catalog.products.filters.supplierModes.MAIN_IN')
      : t(`catalog.products.filters.fields.${props.field}`);
  return (
    <FilterChip clearLabel={t('catalog.products.filters.clear', { name })} onClear={props.onRemove}>
      <button type="button" className="cursor-pointer" onClick={props.onEdit}>
        {name}: <FilterValue field={props.field} filters={props.filters} />
      </button>
    </FilterChip>
  );
}

function FilterValue({ field, filters }: { field: ProductFilterField; filters: ProductFilters }) {
  const { t } = useTranslation();
  switch (field) {
    case 'segment':
      return <SegmentName id={filters.segment} />;
    case 'supplier':
      return <SupplierNames ids={filters.supplier?.ids ?? []} />;
    case 'home':
      return <WarehouseNames ids={filters.home ?? []} />;
    case 'profile':
      return <ProfileNames ids={filters.profile ?? []} />;
    case 'price':
      return priceText(t, filters.price);
    case 'stock':
      return <StockText stock={filters.stock} />;
    case 'created':
    case 'updated':
      return dateText(t, filters[field]);
    case 'missing':
      return (filters.missing ?? []).map((choice) => t(missingLabelKey(choice))).join(', ');
  }
}

function SegmentName({ id }: { id: number | undefined }) {
  const segments = useSegments('PRODUCT');
  return segments.data?.find((segment) => segment.id === id)?.name ?? LOADING;
}

function SupplierNames({ ids }: { ids: number[] }) {
  const suppliers = useSuppliersByIds(ids);
  return suppliers.data ? suppliers.data.map((supplier) => supplier.name).join(', ') : LOADING;
}

function WarehouseNames({ ids }: { ids: number[] }) {
  const warehouseName = useWarehouseName();
  return ids.map(warehouseName).join(', ');
}

function ProfileNames({ ids }: { ids: number[] }) {
  const profiles = usePriceProfileChoices();
  if (!profiles.data) return LOADING;
  const names = new Map(profiles.data.map((profile) => [profile.id, profile.name]));
  return ids.map((id) => names.get(id) ?? `#${id}`).join(', ');
}

function StockText({ stock }: { stock: ProductFilters['stock'] }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  if (!stock) return null;
  const kind = t(`catalog.products.filters.stockKinds.${stock.kind}`);
  return stock.warehouseId ? `${kind} · ${warehouseName(stock.warehouseId)}` : kind;
}

function priceText(t: TFunction, price: ProductFilters['price']): string {
  const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
  return rangeText(
    t,
    price?.min ? money(price.min) : undefined,
    price?.max ? money(price.max) : undefined,
  );
}

function dateText(t: TFunction, filter: DateFilter | undefined): string {
  if (!filter) return '';
  if ('days' in filter) {
    return filter.days === 1
      ? t('catalog.products.filters.today')
      : t('catalog.products.filters.lastDays', { count: filter.days });
  }
  return rangeText(t, filter.from, filter.to);
}

function rangeText(t: TFunction, from: string | undefined, to: string | undefined): string {
  if (from && to) return t('catalog.products.filters.between', { from, to });
  if (from) return t('catalog.products.filters.atLeast', { value: from });
  return t('catalog.products.filters.atMost', { value: to ?? '' });
}
