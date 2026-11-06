import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchSelect } from '@/components/search-select';
import { useCustomers, useSuppliers } from './api';
import type { PickedCustomer } from './customer-picker';
import type { PickedSupplier } from './supplier-picker';

/** Rows offered at once; the name, code, phone or TIN typed narrows them on the server. */
const ROWS = 20;

interface PartyProps<T> {
  id: string;
  value: T | null;
  onChange: (party: T | null) => void;
  invalid?: boolean;
}

const labelOf = (party: { code: string; name: string }) => `${party.name} · ${party.code}`;

/**
 * An active customer typed straight into the field, like an account (owner 2026-11-05, ADR-0152):
 * nothing lists until a letter is typed, arrows move, Enter takes the row, ✕ clears it.
 */
export function CustomerSelect(props: PartyProps<PickedCustomer>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const customers = useCustomers({ q, status: 'ACTIVE' }, { enabled: q !== '', limit: ROWS });
  const rows = q === '' ? [] : (customers.data?.pages[0]?.data ?? []);
  return (
    <SearchSelect
      id={props.id}
      invalid={props.invalid}
      value={props.value ? String(props.value.id) : ''}
      chosenLabel={props.value ? labelOf(props.value) : ''}
      placeholder={t('partners.customerPicker.search')}
      options={rows.map((row) => ({ value: String(row.id), label: labelOf(row) }))}
      searching={customers.isFetching}
      onSearch={setSearch}
      onClear={() => props.onChange(null)}
      onChange={(value) => {
        const row = rows.find((entry) => String(entry.id) === value);
        if (row) props.onChange({ id: row.id, code: row.code, name: row.name });
      }}
    />
  );
}

/** The same for an active supplier. */
export function SupplierSelect(
  props: PartyProps<PickedSupplier> & {
    /** Inactive suppliers too (a report that still lists them, ADR-0170). */
    includeInactive?: boolean;
    /** Enter takes a row at once: offer only rows of what is typed now, never the last search's. */
    freshOnly?: boolean;
  },
) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const suppliers = useSuppliers(
    { q, status: props.includeInactive ? undefined : 'ACTIVE' },
    { enabled: q !== '', limit: ROWS },
  );
  const stale = props.freshOnly === true && (q !== search.trim() || suppliers.isPlaceholderData);
  const rows = q === '' || stale ? [] : (suppliers.data?.pages[0]?.data ?? []);
  return (
    <SearchSelect
      id={props.id}
      invalid={props.invalid}
      value={props.value ? String(props.value.id) : ''}
      chosenLabel={props.value ? labelOf(props.value) : ''}
      placeholder={t('partners.supplierPicker.search')}
      options={rows.map((row) => ({ value: String(row.id), label: labelOf(row) }))}
      searching={suppliers.isFetching}
      onSearch={setSearch}
      onClear={() => props.onChange(null)}
      onChange={(value) => {
        const row = rows.find((entry) => String(entry.id) === value);
        if (row) props.onChange({ id: row.id, code: row.code, name: row.name });
      }}
    />
  );
}
