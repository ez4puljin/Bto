import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { ProductSearch } from '@/features/inventory/shared';
import { useSuppliersByIds } from '@/features/partners/api';
import { SupplierSelect } from '@/features/partners/party-select';
import type { Choice } from './program-choices';

/** What has been chosen, each with its ✕. */
export function Chips(props: { items: readonly Choice[]; onRemove: (id: number) => void }) {
  const { t } = useTranslation();
  if (props.items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 pt-1.5">
      {props.items.map((item) => (
        <li
          key={item.id}
          className="flex max-w-full items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-[0.8125rem] text-secondary-foreground"
        >
          <span className="min-w-0 truncate">{item.label}</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-5 text-muted-foreground"
            aria-label={t('pricing.programs.removeChoice', { name: item.label })}
            title={t('pricing.programs.removeChoice', { name: item.label })}
            onClick={() => props.onRemove(item.id)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Choices typed into a field: each one taken joins the chips and leaves the list. */
export function ChoicesPicker(props: {
  id: string;
  options: readonly Choice[];
  ids: readonly number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const chosen = new Set(props.ids);
  const labels = new Map(props.options.map((option) => [option.id, option.label]));
  return (
    <div className="min-w-0">
      <SearchSelect
        id={props.id}
        value=""
        {...(props.placeholder ? { placeholder: props.placeholder } : {})}
        options={props.options
          .filter((option) => !chosen.has(option.id))
          .map((option) => ({ value: String(option.id), label: option.label }))}
        onChange={(value) => {
          const id = Number.parseInt(value, 10);
          if (!Number.isNaN(id)) props.onChange([...props.ids, id]);
        }}
      />
      <Chips
        items={props.ids.map((id) => ({ id, label: labels.get(id) ?? String(id) }))}
        onRemove={(id) => props.onChange(props.ids.filter((own) => own !== id))}
      />
    </div>
  );
}

/** Suppliers, searched on the server; their names read by id. */
export function SuppliersPicker(props: {
  id: string;
  ids: readonly number[];
  onChange: (ids: number[]) => void;
}) {
  const suppliers = useSuppliersByIds(props.ids);
  const names = new Map((suppliers.data ?? []).map((row) => [row.id, row.name]));
  return (
    <div className="min-w-0">
      <SupplierSelect
        id={props.id}
        value={null}
        onChange={(picked) => {
          if (picked && !props.ids.includes(picked.id)) props.onChange([...props.ids, picked.id]);
        }}
      />
      <Chips
        items={props.ids.map((id) => ({ id, label: names.get(id) ?? String(id) }))}
        onRemove={(id) => props.onChange(props.ids.filter((own) => own !== id))}
      />
    </div>
  );
}

export interface NamedProduct {
  id: number;
  sku: string;
  name: string;
  /** Known when it was just picked: thresholds start in it. */
  baseUnit?: { id: number; uomName: string };
}

/** Products found by name, SKU or barcode; the form holds their names. */
export function ProductsPicker(props: {
  id: string;
  products: readonly NamedProduct[];
  onChange: (products: NamedProduct[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <ProductSearch
        id={props.id}
        className="max-w-md"
        pickLabel={t('pricing.programs.pickProduct')}
        onPick={(picked) => {
          if (props.products.some((own) => own.id === picked.id)) return;
          props.onChange([
            ...props.products,
            { id: picked.id, sku: picked.sku, name: picked.name, baseUnit: picked.baseUnit },
          ]);
        }}
      />
      <Chips
        items={props.products.map((own) => ({ id: own.id, label: `${own.sku} ${own.name}` }))}
        onRemove={(id) => props.onChange(props.products.filter((own) => own.id !== id))}
      />
    </div>
  );
}
