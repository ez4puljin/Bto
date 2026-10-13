import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { type SupplierSummary, useSuppliers } from './api';

/** What a form keeps of the chosen supplier. */
export type PickedSupplier = Pick<SupplierSummary, 'id' | 'code' | 'name'>;

/**
 * An active supplier by name, code, phone or TIN (goods receipts, product registration): a search
 * box over the first matches, then the chosen supplier with «Солих». Only the control: the caller
 * labels it through `id`.
 */
export function SupplierPicker(props: {
  id: string;
  value: PickedSupplier | null;
  onChange: (supplier: PickedSupplier | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [changing, setChanging] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const q = useDeferredValue(search.trim());
  const suppliers = useSuppliers({ q, status: 'ACTIVE' }, { enabled: props.value === null });
  const rows = (suppliers.data?.pages[0]?.data ?? []).slice(0, 8);

  // «Солих» hands the focus to the search box it brings back.
  useEffect(() => {
    if (changing && props.value === null) {
      searchBox.current?.focus();
      setChanging(false);
    }
  }, [changing, props.value]);

  if (props.value) {
    return (
      <div className="flex gap-2">
        <Input
          id={props.id}
          readOnly
          aria-describedby={props.describedBy}
          value={`${props.value.name} · ${props.value.code}`}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearch('');
            setChanging(true);
            props.onChange(null);
          }}
        >
          {t('partners.supplierPicker.change')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Input
        ref={searchBox}
        id={props.id}
        type="search"
        autoComplete="off"
        placeholder={t('partners.supplierPicker.search')}
        aria-invalid={props.invalid ? true : undefined}
        aria-describedby={props.describedBy}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ProblemAlert problem={problemFromError(suppliers.error)} />
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((supplier) => (
            <li key={supplier.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() =>
                  props.onChange({ id: supplier.id, code: supplier.code, name: supplier.name })
                }
              >
                <span className="font-mono text-muted-foreground">{supplier.code}</span>
                <span>{supplier.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : suppliers.isPending ? null : (
        <p className="text-sm text-muted-foreground">{t('partners.supplierPicker.none')}</p>
      )}
    </div>
  );
}
