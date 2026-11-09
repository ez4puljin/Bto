import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { SearchSelect } from '@/components/search-select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSuppliers } from '@/features/partners/api';
import { useCustomerLookup, useUserLookup } from './api';
import {
  type StockCountAccountChoice,
  type StockCountPartyKind,
  type StockCountSettlement,
} from './counts-api';
import { type SettlementDraft } from './stock-count-helpers';

// Where a count's difference goes (ADR-0176 #6): an account, a party and, for a shortage, whether
// the party pays for it.

const PARTY_KINDS: readonly StockCountPartyKind[] = ['USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'];

export function SettlementFields(props: {
  value: SettlementDraft;
  onChange: (value: SettlementDraft) => void;
  accounts: readonly StockCountAccountChoice[];
  /** Only a shortage may be charged to its party. */
  mayCharge: boolean;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const { value, onChange } = props;
  return (
    <div className="flex flex-col gap-3">
      <FormField
        label={t('inventory.counts.settlement.account')}
        htmlFor={`${ids}-account`}
        hint={props.accounts.length === 0 ? t('inventory.counts.settlement.noAccounts') : undefined}
      >
        <NativeSelect
          id={`${ids}-account`}
          value={value.accountCode}
          onChange={(event) => onChange({ ...value, accountCode: event.target.value })}
        >
          <option value="">{t('inventory.counts.settlement.defaultAccount')}</option>
          {props.accounts.map((account) => (
            <option key={account.code} value={account.code}>
              {`${account.code} · ${account.name}`}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={t('inventory.counts.settlement.partyKind')} htmlFor={`${ids}-kind`}>
        <NativeSelect
          id={`${ids}-kind`}
          value={value.kind}
          onChange={(event) =>
            onChange({
              ...value,
              kind: PARTY_KINDS.find((kind) => kind === event.target.value) ?? '',
              partyId: null,
              name: '',
              charged: event.target.value === '' ? false : value.charged,
            })
          }
        >
          <option value="">{t('inventory.counts.settlement.noParty')}</option>
          {PARTY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`inventory.counts.partyKinds.${kind}`)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {value.kind === 'OTHER' ? (
        <FormField label={t('inventory.counts.settlement.party')} htmlFor={`${ids}-name`}>
          <Input
            id={`${ids}-name`}
            value={value.name}
            maxLength={200}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
          />
        </FormField>
      ) : value.kind !== '' ? (
        <FormField label={t('inventory.counts.settlement.party')} htmlFor={`${ids}-party`}>
          <PartySearch
            id={`${ids}-party`}
            kind={value.kind}
            partyId={value.partyId}
            name={value.name}
            onChange={(partyId, name) => onChange({ ...value, partyId, name })}
          />
        </FormField>
      ) : null}
      {props.mayCharge && value.kind !== '' ? (
        <label className="flex items-start gap-3 text-sm">
          <Switch
            className="mt-0.5"
            checked={value.charged}
            onCheckedChange={(charged) => onChange({ ...value, charged })}
          />
          <span className="flex flex-col">
            <span className="font-medium">{t('inventory.counts.settlement.charged')}</span>
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.counts.settlement.chargedHint')}
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

/** A staff member, a customer or a supplier, found by typing. */
function PartySearch(props: {
  id: string;
  kind: Exclude<StockCountPartyKind, 'OTHER'>;
  partyId: number | null;
  name: string;
  onChange: (partyId: number | null, name: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const typed = q.trim() !== '';
  const users = useUserLookup(q, props.kind === 'USER' && typed);
  const customers = useCustomerLookup(q, props.kind === 'CUSTOMER' && typed);
  const suppliers = useSuppliers(
    { q, status: 'ACTIVE' },
    { enabled: props.kind === 'SUPPLIER' && typed, limit: 20 },
  );
  const options =
    props.kind === 'USER'
      ? (users.data ?? []).map((row) => ({ value: String(row.id), label: row.fullName }))
      : props.kind === 'CUSTOMER'
        ? (customers.data ?? []).map((row) => ({
            value: String(row.id),
            label: `${row.name} · ${row.code}`,
          }))
        : (suppliers.data?.pages[0]?.data ?? []).map((row) => ({
            value: String(row.id),
            label: `${row.name} · ${row.code}`,
          }));
  return (
    <SearchSelect
      id={props.id}
      value={props.partyId === null ? '' : String(props.partyId)}
      options={options}
      placeholder={t('inventory.counts.settlement.partySearch')}
      onSearch={setQ}
      searching={users.isFetching || customers.isFetching || suppliers.isFetching}
      chosenLabel={props.name}
      onChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen) props.onChange(Number.parseInt(chosen.value, 10), chosen.label);
        else props.onChange(null, '');
      }}
      onClear={() => props.onChange(null, '')}
    />
  );
}

/** «313011 · Иван (ажилтан) · төлүүлнэ», or «—» when the difference goes where it always did. */
export function SettlementText({ value }: { value: StockCountSettlement | null }) {
  const { t } = useTranslation();
  if (!value || (value.accountCode === null && value.party === null)) {
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  }
  const parts = [
    value.accountCode,
    value.party
      ? t('inventory.counts.settlement.partyLine', {
          name: value.party.name,
          kind: t(`inventory.counts.partyKinds.${value.party.kind}`),
        })
      : null,
    value.charged ? t('inventory.counts.settlement.chargedShort') : null,
  ].filter((part): part is string => part !== null && part !== '');
  return <span>{parts.join(' · ')}</span>;
}
