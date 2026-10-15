import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { type CustomerSummary, useCustomers } from './api';

/** What a form keeps of the chosen customer. */
export type PickedCustomer = Pick<CustomerSummary, 'id' | 'code' | 'name'>;

/**
 * An active customer by name, code, phone or TIN (customer orders, ADR-0055): a search
 * box over the first matches, then the chosen customer with «Солих». Only the control: the caller
 * labels it through `id`.
 */
export function CustomerPicker(props: {
  id: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [changing, setChanging] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const q = useDeferredValue(search.trim());
  const customers = useCustomers({ q, status: 'ACTIVE' }, { enabled: props.value === null });
  const rows = (customers.data?.pages[0]?.data ?? []).slice(0, 8);

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
          {t('partners.customerPicker.change')}
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
        placeholder={t('partners.customerPicker.search')}
        aria-invalid={props.invalid ? true : undefined}
        aria-describedby={props.describedBy}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ProblemAlert problem={problemFromError(customers.error)} />
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() =>
                  props.onChange({ id: customer.id, code: customer.code, name: customer.name })
                }
              >
                <span className="font-mono text-muted-foreground">{customer.code}</span>
                <span>{customer.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : customers.isPending ? null : (
        <p className="text-sm text-muted-foreground">{t('partners.customerPicker.none')}</p>
      )}
    </div>
  );
}
