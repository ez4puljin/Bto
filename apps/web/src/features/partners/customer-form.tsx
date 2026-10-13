import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { CUSTOMER_KINDS, regNoShape } from '@tugeel/shared/taxpayer';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldList } from '@/components/detail';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { CustomerDetail } from './api';
import { GpsField } from './gps-field';
import {
  type CustomerFormValues,
  customerSchema,
  fieldOfDuplicate,
  PARTNER_STATUSES,
} from './partner-schema';
import { localPhone } from './phone';

type PayerFlag = 'vatPayer' | 'cityPayer';
const PAYER_FLAGS: readonly PayerFlag[] = ['vatPayer', 'cityPayer'];

/**
 * The customer form (SPEC §5.3). Citizens get the e-Barimt consumer number field; the TIN length
 * follows the kind. A registration number that does not look like the kind's only gets a hint:
 * old and foreign numbers exist. Creating also takes the first delivery address with its GPS point.
 */
export function CustomerForm(props: {
  mode: 'create' | 'edit';
  defaultValues: CustomerFormValues;
  /** Edit only: how the TIN and the payer flags were last set. */
  customer?: CustomerDetail;
  readOnly?: boolean;
  submitLabel: string;
  /** Resolves to the API problem, or null when saved. */
  onSubmit: (values: CustomerFormValues) => Promise<ProblemDetails | null>;
  /** Editing in a card: «Болих» returns to reading (ADR-0042). */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { mode, customer } = props;
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: props.defaultValues,
  });
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const { errors, isSubmitting } = form.formState;
  const kind = form.watch('kind');
  const regNo = form.watch('regNo').trim();
  const regNoLooksOff = regNo !== '' && regNoShape(regNo) !== kind;

  const submit = form.handleSubmit(async (values) => {
    const result = await props.onSubmit(values);
    const field =
      result?.code === 'DUPLICATE_VALUE' ? fieldOfDuplicate(result.params?.constraint) : null;
    if (field === 'code') {
      setProblem(null);
      form.setError(
        'code',
        { type: 'server', message: 'validation.codeTaken' },
        { shouldFocus: true },
      );
      return;
    }
    setProblem(result);
  });

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-code">{t('partners.customer.code')}</Label>
            <Input
              id="customer-code"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('code')}
            />
            {mode === 'create' ? (
              <p className="text-xs text-muted-foreground">{t('partners.customer.codeHint')}</p>
            ) : null}
            <FieldError message={errors.code?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-kind">{t('partners.customer.kind')}</Label>
            <NativeSelect id="customer-kind" {...form.register('kind')}>
              {CUSTOMER_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`partners.kinds.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="customer-name">{t('partners.customer.name')}</Label>
            <Input id="customer-name" autoComplete="off" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-reg-no">{t('partners.customer.regNo')}</Label>
            <Input
              id="customer-reg-no"
              autoComplete="off"
              className="font-mono"
              {...form.register('regNo')}
            />
            {regNoLooksOff ? (
              <p className="text-xs text-muted-foreground">
                {kind === 'COMPANY'
                  ? t('partners.customer.regNoHintCompany')
                  : t('partners.customer.regNoHintIndividual')}
              </p>
            ) : null}
            <FieldError message={errors.regNo?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-tin">{t('partners.customer.tin')}</Label>
            <Input
              id="customer-tin"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('tin')}
            />
            {customer?.tinSource ? (
              <p className="text-xs text-muted-foreground">
                {t(`partners.customer.tinSource.${customer.tinSource}`)}
              </p>
            ) : kind === 'COMPANY' ? (
              <p className="text-xs text-muted-foreground">{t('partners.customer.tinHint')}</p>
            ) : null}
            <FieldError message={errors.tin?.message} />
          </div>
          {kind === 'INDIVIDUAL' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-consumer-no">{t('partners.customer.consumerNo')}</Label>
              <Input
                id="customer-consumer-no"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
                {...form.register('consumerNo')}
              />
              <p className="text-xs text-muted-foreground">
                {t('partners.customer.consumerNoHint')}
              </p>
              <FieldError message={errors.consumerNo?.message} />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-phone">{t('partners.customer.phone')}</Label>
            <Input
              id="customer-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              {...form.register('phone')}
            />
            <FieldError message={errors.phone?.message} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="flex flex-wrap gap-4">
              {PAYER_FLAGS.map((flag) => (
                <Controller
                  key={flag}
                  control={form.control}
                  name={flag}
                  render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`customer-${flag}`}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <Label htmlFor={`customer-${flag}`} className="font-normal">
                        {t(`partners.customer.${flag}`)}
                      </Label>
                    </div>
                  )}
                />
              ))}
            </div>
            {mode === 'edit' && customer?.taxStatusSource === null ? (
              <p className="text-xs text-muted-foreground">
                {t('partners.customer.payerUnchecked')}
              </p>
            ) : null}
          </div>
          {mode === 'edit' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-status">{t('partners.customer.status')}</Label>
              <NativeSelect id="customer-status" {...form.register('status')}>
                {PARTNER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`partners.status.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="customer-note">{t('partners.customer.note')}</Label>
            <Textarea id="customer-note" rows={2} {...form.register('note')} />
            <FieldError message={errors.note?.message} />
          </div>
        </div>

        {mode === 'create' ? (
          <>
            <Separator />
            <h2 className="font-medium">{t('partners.customer.firstAddress')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-address">{t('partners.addresses.address')}</Label>
                <Textarea id="customer-address" rows={2} {...form.register('address')} />
                <FieldError message={errors.address?.message} />
              </div>
              <GpsField
                id="customer-gps"
                value={form.watch('gps')}
                registration={form.register('gps')}
                error={errors.gps?.message}
              />
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="customer-address-note">{t('partners.addresses.note')}</Label>
                <Input
                  id="customer-address-note"
                  autoComplete="off"
                  {...form.register('addressNote')}
                />
                <FieldError message={errors.addressNote?.message} />
              </div>
            </div>
          </>
        ) : null}
      </fieldset>
      {props.readOnly ? null : (
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {props.submitLabel}
          </Button>
          {props.onCancel ? (
            <Button type="button" variant="ghost" onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
        </div>
      )}
    </form>
  );
}

/** The reading side of a customer's card: the form's fields, label over value (ADR-0042). */
export function CustomerFacts({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation();
  const mono = (value: string | null) =>
    value ? <span className="font-mono">{value}</span> : null;
  return (
    <FieldList
      items={[
        { label: t('partners.customer.code'), value: mono(customer.code) },
        { label: t('partners.customer.name'), value: customer.name },
        { label: t('partners.customer.kind'), value: t(`partners.kinds.${customer.kind}`) },
        { label: t('partners.customer.regNo'), value: mono(customer.regNo) },
        {
          label: t('partners.customer.tin'),
          value: mono(customer.tin),
          hint: customer.tinSource ? t(`partners.customer.tinSource.${customer.tinSource}`) : null,
        },
        ...(customer.kind === 'INDIVIDUAL'
          ? [{ label: t('partners.customer.consumerNo'), value: mono(customer.consumerNo) }]
          : []),
        {
          label: t('partners.customer.phone'),
          value: customer.phone ? localPhone(customer.phone) : null,
        },
        ...PAYER_FLAGS.map((flag) => ({
          label: t(`partners.customer.${flag}`),
          value: customer[flag] ? t('common.yes') : t('common.no'),
          hint:
            customer.taxStatusSource === null ? t('partners.customer.payerUnchecked') : undefined,
        })),
        { label: t('partners.customer.status'), value: t(`partners.status.${customer.status}`) },
        { label: t('partners.customer.note'), value: customer.note, wide: true },
      ]}
    />
  );
}
