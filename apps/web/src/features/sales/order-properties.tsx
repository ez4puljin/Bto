import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  FULFILMENTS,
  type Fulfilment,
  isEditable,
  orderHeaderIssues,
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
import { useCustomer } from '@/features/partners/api';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type SalesOrder, useSalesOrderMutations } from './api';
import { PaymentLabel } from './order-badges';
import { orderRequestOf } from './order-request';

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
    <DetailCard
      title={t('sales.order.header')}
      canEdit={order.canEdit && isEditable(order.status)}
      view={
        <FieldList
          items={[
            {
              label: t('sales.order.customer'),
              value: `${order.customerName} · ${order.customerCode}`,
            },
            {
              label: t('sales.order.fulfilment'),
              value: t(`sales.fulfilments.${order.fulfilment}`),
            },
            { label: t('sales.order.deliveryDate'), value: order.deliveryDate },
            ...(order.fulfilment === 'DELIVERY'
              ? [{ label: t('sales.order.address'), value: order.addressText }]
              : []),
            { label: t('sales.order.contactName'), value: contact },
            {
              label: t('sales.order.paymentMethod'),
              value: <PaymentLabel method={order.paymentMethod} />,
            },
            { label: t('sales.order.note'), value: order.note },
          ]}
        />
      }
      edit={(close) => <PropertiesForm order={order} onDone={close} onDirty={onDirty} />}
    />
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
          <Input
            id={`${id}-date`}
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
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
