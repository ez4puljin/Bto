import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  FULFILMENTS,
  type Fulfilment,
  isEditable,
  orderHeaderIssues,
  PARTY_EDIT_STATUSES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailCard, FieldList } from '@/components/detail';
import { FormField, FormFooter } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useHasPermission } from '@/app/auth-context';
import { useCustomer } from '@/features/partners/api';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type SalesOrder, useSalesOrderMutations } from './api';
import { PaymentLabel } from './order-badges';
import { orderRequestOf } from './order-request';
import { DateInput } from '@/components/date-input';

/**
 * «Мэдээлэл» (ADR-0059, erxes's Properties): the order's header read first, edited in place while
 * the order may change (a draft, or confirmed before picking, by the stage's EDIT holders). The
 * customer stays; saving sends the lines as they are stored.
 */
export function OrderProperties({
  order,
  onDirty,
}: {
  order: SalesOrder;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const contact = [order.contactName, order.contactPhone].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-4">
      <PartyCard order={order} onDirty={onDirty} />
      <DetailCard
        title={t('sales.order.header')}
        canEdit={order.canEdit && isEditable(order.status)}
        view={
          <FieldList
            items={[
              {
                label: t('sales.order.fulfilment'),
                value: t(`sales.fulfilments.${order.fulfilment}`),
              },
              { label: t('sales.order.deliveryDate'), value: order.deliveryDate },
              ...(order.fulfilment === 'DELIVERY'
                ? [{ label: t('sales.order.address'), value: order.addressText }]
                : []),
              { label: t('sales.order.contactName'), value: contact },
              { label: t('sales.order.note'), value: order.note },
            ]}
          />
        }
        edit={(close) => <PropertiesForm order={order} onDone={close} onDirty={onDirty} />}
      />
    </div>
  );
}

/**
 * The order's customer and payment method (ADR-0180): the accountant (`sales.orders.party`)
 * changes them in any stage until the goods leave; a new customer passes the credit check, and a
 * delivery takes one of the new customer's addresses. Prices stay.
 */
function PartyCard({ order, onDirty }: { order: SalesOrder; onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const party = useHasPermission('sales.orders.party');
  return (
    <DetailCard
      title={t('sales.panel.party.title')}
      canEdit={party && PARTY_EDIT_STATUSES.includes(order.status)}
      view={
        <FieldList
          items={[
            {
              label: t('sales.order.customer'),
              value: `${order.customerName} · ${order.customerCode}`,
            },
            {
              label: t('sales.order.paymentMethod'),
              value: <PaymentLabel method={order.paymentMethod} />,
            },
          ]}
        />
      }
      edit={(close) => <PartyForm order={order} onDone={close} onDirty={onDirty} />}
    />
  );
}

function PartyForm({
  order,
  onDone,
  onDirty,
}: {
  order: SalesOrder;
  onDone: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mutations = useSalesOrderMutations();
  const action = useAction();
  const [customer, setCustomer] = useState<PickedCustomer | null>({
    id: order.customerId,
    code: order.customerCode,
    name: order.customerName,
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const changedCustomer = customer !== null && customer.id !== order.customerId;
  const delivery = order.fulfilment === 'DELIVERY' && changedCustomer;
  const details = useCustomer(customer?.id ?? 0, { enabled: delivery }).data;

  const dirty = customer?.id !== order.customerId || paymentMethod !== order.paymentMethod;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  // A delivery takes the new customer's default address until one is chosen.
  useEffect(() => {
    if (!delivery || !details || addressId !== null) return;
    const fallback = details.addresses.find((row) => row.isDefault) ?? details.addresses[0];
    if (fallback) setAddressId(fallback.id);
  }, [delivery, details, addressId]);

  const missingAddress = delivery && addressId === null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!customer || missingAddress) return;
    void action.run(async () => {
      await mutations.changeParty.mutateAsync({
        id: order.id,
        body: {
          expectedUpdatedAt: order.updatedAt,
          customerId: customer.id,
          paymentMethod,
          addressId: delivery ? addressId : null,
        },
      });
      toast.success(t('sales.panel.party.saved'));
      onDone();
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label={t('sales.order.customer')}
          htmlFor={`${id}-customer`}
          error={checked && !customer ? t('sales.create.customerRequired') : undefined}
        >
          <CustomerPicker
            id={`${id}-customer`}
            value={customer}
            onChange={(next) => {
              setCustomer(next);
              setAddressId(null);
            }}
            invalid={checked && !customer}
          />
        </FormField>
        <FormField label={t('sales.order.paymentMethod')} htmlFor={`${id}-payment`}>
          <NativeSelect
            id={`${id}-payment`}
            value={paymentMethod}
            onChange={(event) => {
              const value = PAYMENT_METHODS.find((entry) => entry === event.target.value);
              if (value) setPaymentMethod(value);
            }}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.paymentMethods.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {delivery ? (
          <FormField
            label={t('sales.order.address')}
            htmlFor={`${id}-address`}
            error={checked && missingAddress ? t('sales.issues.addressId.required') : undefined}
            hint={details && details.addresses.length === 0 ? t('sales.order.noAddress') : null}
          >
            <NativeSelect
              id={`${id}-address`}
              value={addressId ?? ''}
              onChange={(event) =>
                setAddressId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            >
              <option value="">{t('sales.order.chooseAddress')}</option>
              {(details?.addresses ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {[row.label, row.address].filter(Boolean).join(' · ') || `#${row.id}`}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
      </div>
      {changedCustomer ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t('sales.panel.party.hint')}</p>
      ) : null}
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!dirty || mutations.changeParty.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

function PropertiesForm({
  order,
  onDone,
  onDirty,
}: {
  order: SalesOrder;
  onDone: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mutations = useSalesOrderMutations();
  const action = useAction();
  const customer = useCustomer(order.customerId);
  const details = customer.data;
  const [fulfilment, setFulfilment] = useState<Fulfilment>(order.fulfilment);
  const [deliveryDate, setDeliveryDate] = useState(order.deliveryDate);
  const [addressId, setAddressId] = useState<number | null>(order.addressId);
  const [contactName, setContactName] = useState(order.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(order.contactPhone ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [note, setNote] = useState(order.note ?? '');
  const [checked, setChecked] = useState(false);

  const dirty =
    fulfilment !== order.fulfilment ||
    deliveryDate !== order.deliveryDate ||
    (fulfilment === 'DELIVERY' && addressId !== order.addressId) ||
    contactName.trim() !== (order.contactName ?? '') ||
    contactPhone.trim() !== (order.contactPhone ?? '') ||
    paymentMethod !== order.paymentMethod ||
    note.trim() !== (order.note ?? '');
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // A delivery takes the customer's default address until one is chosen.
  useEffect(() => {
    if (!details || fulfilment !== 'DELIVERY' || addressId !== null) return;
    const fallback = details.addresses.find((row) => row.isDefault) ?? details.addresses[0];
    if (fallback) setAddressId(fallback.id);
  }, [details, fulfilment, addressId]);

  const issues = orderHeaderIssues(
    {
      fulfilment,
      deliveryDate,
      addressId: fulfilment === 'DELIVERY' ? addressId : null,
      contactPhone: contactPhone.trim() === '' ? null : contactPhone,
    },
    businessDate(),
  );
  const issueOf = (path: string) => {
    const issue = issues.find((entry) => entry.path === path);
    if (!checked || !issue) return undefined;
    if (issue.path === 'deliveryDate') return t(`sales.issues.deliveryDate.${issue.code}`);
    return issue.path === 'addressId'
      ? t('sales.issues.addressId.required')
      : t('sales.issues.contactPhone.phone');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (issues.length > 0) return;
    void action.run(async () => {
      await mutations.update.mutateAsync({
        id: order.id,
        body: orderRequestOf(order, {
          fulfilment,
          deliveryDate,
          addressId: fulfilment === 'DELIVERY' ? addressId : null,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim()
            ? (normalizeMnPhone(contactPhone) ?? contactPhone.trim())
            : null,
          paymentMethod,
          note: note.trim() || null,
        }),
      });
      toast.success(t('sales.panel.properties.saved'));
      onDone();
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={t('sales.order.fulfilment')} htmlFor={`${id}-fulfilment`}>
          <NativeSelect
            id={`${id}-fulfilment`}
            value={fulfilment}
            onChange={(event) =>
              setFulfilment(event.target.value === 'DELIVERY' ? 'DELIVERY' : 'PICKUP')
            }
          >
            {FULFILMENTS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.fulfilments.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          label={t('sales.order.deliveryDate')}
          htmlFor={`${id}-date`}
          error={issueOf('deliveryDate')}
        >
          <DateInput
            id={`${id}-date`}
            value={deliveryDate}
            onChange={(value) => setDeliveryDate(value)}
          />
        </FormField>
        {fulfilment === 'DELIVERY' ? (
          <FormField
            label={t('sales.order.address')}
            htmlFor={`${id}-address`}
            error={issueOf('addressId')}
            hint={details && details.addresses.length === 0 ? t('sales.order.noAddress') : null}
          >
            <NativeSelect
              id={`${id}-address`}
              value={addressId ?? ''}
              onChange={(event) =>
                setAddressId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            >
              <option value="">{t('sales.order.chooseAddress')}</option>
              {(details?.addresses ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {[row.label, row.address].filter(Boolean).join(' · ') || `#${row.id}`}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <FormField label={t('sales.order.contactName')} htmlFor={`${id}-contact`}>
          <Input
            id={`${id}-contact`}
            list={`${id}-contacts`}
            value={contactName}
            onChange={(event) => {
              setContactName(event.target.value);
              const known = details?.contacts.find((row) => row.name === event.target.value);
              if (known?.phone) setContactPhone(known.phone);
            }}
          />
          <datalist id={`${id}-contacts`}>
            {(details?.contacts ?? []).map((row) => (
              <option key={row.id} value={row.name ?? ''} />
            ))}
          </datalist>
        </FormField>
        <FormField
          label={t('sales.order.contactPhone')}
          htmlFor={`${id}-phone`}
          error={issueOf('contactPhone')}
        >
          <Input
            id={`${id}-phone`}
            inputMode="tel"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
          />
        </FormField>
        <FormField label={t('sales.order.paymentMethod')} htmlFor={`${id}-payment`}>
          <NativeSelect
            id={`${id}-payment`}
            value={paymentMethod}
            onChange={(event) => {
              const value = PAYMENT_METHODS.find((entry) => entry === event.target.value);
              if (value) setPaymentMethod(value);
            }}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {t(`sales.paymentMethods.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="md:col-span-2">
          <FormField label={t('sales.order.note')} htmlFor={`${id}-note`}>
            <Textarea
              id={`${id}-note`}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
      </div>
      {order.status === 'CONFIRMED' ? (
        <p className="text-[0.8125rem] text-warning">{t('sales.panel.properties.repriceHint')}</p>
      ) : null}
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={!dirty || mutations.update.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
