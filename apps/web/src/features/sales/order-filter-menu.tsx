import { FULFILMENTS, ORDER_CHANNELS, PAYMENT_METHODS } from '@tugeel/shared/sales';
import type { TFunction } from 'i18next';
import { Check, ListFilter } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import { FilterChip, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWarehouseName, useWarehouseOptions } from '@/features/inventory/helpers';
import { useCustomer } from '@/features/partners/api';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import {
  activeOrderFilters,
  ORDER_FILTER_FIELDS,
  type OrderFilterField,
  type OrderFilters,
  withoutField,
} from './order-filters';

const CHANNELS = ORDER_CHANNELS.filter((channel) => channel !== 'POS');
/** The warehouses an order's lines ship from: the filter «Агуулах» (ADR-0126 #2). */
const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;

/**
 * «Шүүлтүүр» of the warehouse sales page (ADR-0057 #7, the product list's pattern): the menu lists
 * every field with a tick on the active ones; a field opens a small dialog («Миний оруулсан»
 * switches at once); each active filter is a chip that reopens its dialog and clears with its
 * button. The customer filter needs `partners.customers.read`.
 */
export function OrderFilterMenu(props: {
  filters: OrderFilters;
  onChange: (next: OrderFilters) => void;
}) {
  const { t } = useTranslation();
  const canCustomers = useHasPermission('partners.customers.read');
  const [open, setOpen] = useState<OrderFilterField | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = activeOrderFilters(props.filters);
  const fields = ORDER_FILTER_FIELDS.filter((field) => field !== 'customer' || canCustomers);
  const close = () => {
    setOpen(null);
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  const choose = (field: OrderFilterField) => {
    if (field === 'mine') props.onChange({ ...props.filters, mine: !props.filters.mine });
    else setOpen(field);
  };
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="outline" size="sm">
            <ListFilter />
            {t('sales.filters.menu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {fields.map((field) => (
            <DropdownMenuItem key={field} onSelect={() => choose(field)}>
              {t(`sales.filters.fields.${field}`)}
              {active.includes(field) ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active.map((field) => (
        <FilterChip
          key={field}
          clearLabel={t('sales.filters.clear', { name: t(`sales.filters.fields.${field}`) })}
          onClear={() => props.onChange(withoutField(props.filters, field))}
        >
          <button
            type="button"
            className="cursor-pointer"
            onClick={() => (field === 'mine' ? undefined : setOpen(field))}
          >
            <FilterText field={field} filters={props.filters} />
          </button>
        </FilterChip>
      ))}
      {active.length > 1 ? (
        <Button variant="ghost" size="sm" className="text-link" onClick={() => props.onChange({})}>
          {t('sales.filters.clearAll')}
        </Button>
      ) : null}
      <Dialog open={open !== null} onOpenChange={(next) => (next ? undefined : close())}>
        {open ? (
          <FilterDialog
            key={open}
            field={open}
            filters={props.filters}
            apply={(next) => {
              props.onChange(next);
              close();
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function FilterText({ field, filters }: { field: OrderFilterField; filters: OrderFilters }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const name = t(`sales.filters.fields.${field}`);
  switch (field) {
    case 'warehouse':
      return `${name}: ${filters.warehouse ? warehouseName(filters.warehouse) : ''}`;
    case 'customer':
      return (
        <>
          {name}: <CustomerName id={filters.customer ?? 0} />
        </>
      );
    case 'delivery':
      return `${name}: ${range(t, filters.deliveryFrom, filters.deliveryTo)}`;
    case 'mine':
      return name;
    case 'channel':
      return `${name}: ${filters.channel ? t(`sales.channels.${filters.channel}`) : ''}`;
    case 'fulfilment':
      return `${name}: ${filters.fulfilment ? t(`sales.fulfilments.${filters.fulfilment}`) : ''}`;
    case 'payment':
      return `${name}: ${filters.payment ? t(`sales.paymentMethods.${filters.payment}`) : ''}`;
  }
}

function CustomerName({ id }: { id: number }) {
  const customer = useCustomer(id, { enabled: id > 0 });
  return customer.data?.name ?? '…';
}

function range(t: TFunction, from: string | undefined, to: string | undefined): string {
  if (from && to) return t('sales.filters.between', { from, to });
  if (from) return t('sales.filters.atLeast', { value: from });
  return t('sales.filters.atMost', { value: to ?? '' });
}

function FilterDialog({
  field,
  filters,
  apply,
}: {
  field: OrderFilterField;
  filters: OrderFilters;
  apply: (next: OrderFilters) => void;
}) {
  const { t } = useTranslation();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const warehouses = useWarehouseOptions(SHELF_KINDS);
  const [warehouse, setWarehouse] = useState(filters.warehouse ? String(filters.warehouse) : '');
  const [from, setFrom] = useState(filters.deliveryFrom ?? '');
  const [to, setTo] = useState(filters.deliveryTo ?? '');
  const [channel, setChannel] = useState(filters.channel ?? CHANNELS[0] ?? 'ADMIN');
  const [fulfilment, setFulfilment] = useState(filters.fulfilment ?? 'DELIVERY');
  const [payment, setPayment] = useState(filters.payment ?? 'CASH');
  const submit = () => {
    switch (field) {
      case 'customer':
        apply(customer ? { ...filters, customer: customer.id } : withoutField(filters, field));
        return;
      case 'warehouse':
        apply(
          warehouse
            ? { ...filters, warehouse: Number.parseInt(warehouse, 10) }
            : withoutField(filters, field),
        );
        return;
      case 'delivery':
        apply({
          ...withoutField(filters, field),
          ...(from ? { deliveryFrom: from } : {}),
          ...(to ? { deliveryTo: to } : {}),
        });
        return;
      case 'channel':
        apply({ ...filters, channel });
        return;
      case 'fulfilment':
        apply({ ...filters, fulfilment });
        return;
      case 'payment':
        apply({ ...filters, payment });
        return;
      case 'mine':
        apply({ ...filters, mine: true });
    }
  };
  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t(`sales.filters.fields.${field}`)}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {field === 'customer' ? (
          <FormField label={t('sales.order.customer')} htmlFor="filter-customer">
            <CustomerPicker id="filter-customer" value={customer} onChange={setCustomer} />
          </FormField>
        ) : null}
        {field === 'warehouse' ? (
          <FormField label={t('sales.filters.fields.warehouse')} htmlFor="filter-warehouse">
            <NativeSelect
              id="filter-warehouse"
              value={warehouse}
              onChange={(event) => setWarehouse(event.target.value)}
            >
              <option value="">{t('sales.filters.anyWarehouse')}</option>
              {warehouses.options.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        {field === 'delivery' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('sales.filters.from')} htmlFor="filter-from">
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </FormField>
            <FormField label={t('sales.filters.to')} htmlFor="filter-to">
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </FormField>
          </div>
        ) : null}
        {field === 'channel' ? (
          <SegmentedControl
            options={CHANNELS}
            value={channel}
            label={(value) => t(`sales.channels.${value}`)}
            onChange={setChannel}
          />
        ) : null}
        {field === 'fulfilment' ? (
          <SegmentedControl
            options={FULFILMENTS}
            value={fulfilment}
            label={(value) => t(`sales.fulfilments.${value}`)}
            onChange={setFulfilment}
          />
        ) : null}
        {field === 'payment' ? (
          <SegmentedControl
            options={PAYMENT_METHODS}
            value={payment}
            label={(value) => t(`sales.paymentMethods.${value}`)}
            onChange={setPayment}
          />
        ) : null}
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button type="submit">{t('sales.filters.apply')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
