import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { SETTLEMENT_GROUPS } from '@tugeel/shared/finance';
import { CUSTOMER_KINDS, regNoShape } from '@tugeel/shared/taxpayer';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldList } from '@/components/detail';
import { FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { type CustomerCategory, type CustomerDetail, useCustomerCategories } from './api';
import { PartnerFormFrame } from './form-frame';
import { GpsField } from './gps-field';
import { type CustomerFormValues, customerSchema, fieldOfDuplicate } from './partner-schema';
import { localPhone } from './phone';

type PayerFlag = 'vatPayer' | 'cityPayer';
const PAYER_FLAGS: readonly PayerFlag[] = ['vatPayer', 'cityPayer'];

/**
 * The customer form (SPEC §5.3), settings-style (ADR-0043). Citizens get the e-Barimt consumer
 * number field; the TIN length follows the kind. A registration number that does not look like the
 * kind's only gets a hint: old and foreign numbers exist. Creating also takes the first delivery
 * address with its GPS point.
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
  /** The `/new` page: fields in a card, buttons at the window's foot (`PartnerFormFrame`). */
  page?: boolean;
  /** Create only: the code the server suggests for the chosen category (ADR-0107). */
  suggestedCode?: string;
  /** Create only: the category changed, so the page asks for its suggested code. */
  onCategoryChange?: (categoryId: number | undefined) => void;
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
  const categories = useCustomerCategories();
  const options = categoryOptions(categories.data, props.defaultValues.categoryId);

  // A new suggestion replaces the code only while the office has not typed one of its own.
  const shownSuggestion = useRef(props.defaultValues.code);
  const { suggestedCode } = props;
  useEffect(() => {
    if (suggestedCode === undefined || suggestedCode === shownSuggestion.current) return;
    if (form.getValues('code') === shownSuggestion.current) form.setValue('code', suggestedCode);
    shownSuggestion.current = suggestedCode;
  }, [suggestedCode, form]);

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

  const fields = (
    <fieldset disabled={props.readOnly} className="flex min-w-0 flex-col gap-5">
      <FormSection title={t('partners.customer.sectionGeneral')}>
        <FormRow
          label={t('partners.customer.category')}
          htmlFor="customer-category"
          hint={mode === 'create' ? t('partners.customer.categoryHint') : undefined}
        >
          <NativeSelect
            id="customer-category"
            className="sm:w-72"
            {...form.register('categoryId', {
              onChange: (event: { target: { value: string } }) =>
                props.onCategoryChange?.(
                  event.target.value === '' ? undefined : Number.parseInt(event.target.value, 10),
                ),
            })}
          >
            <option value="">{t('partners.customer.noCategory')}</option>
            {options.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('partners.customer.code')}
          htmlFor="customer-code"
          hint={mode === 'create' ? t('partners.customer.codeHint') : undefined}
          error={errors.code?.message}
        >
          <Input
            id="customer-code"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-44"
            {...form.register('code')}
          />
        </FormRow>
        <FormRow
          label={t('partners.customer.name')}
          htmlFor="customer-name"
          error={errors.name?.message}
        >
          <Input id="customer-name" autoComplete="off" {...form.register('name')} />
        </FormRow>
        <FormRow label={t('partners.customer.kind')} htmlFor="customer-kind">
          <NativeSelect id="customer-kind" className="sm:w-56" {...form.register('kind')}>
            {CUSTOMER_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`partners.kinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('partners.customer.phone')}
          htmlFor="customer-phone"
          error={errors.phone?.message}
        >
          <Input
            id="customer-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            className="sm:w-56"
            {...form.register('phone')}
          />
        </FormRow>
        {mode === 'create' ? (
          <FormRow
            label={t('partners.settlement.group')}
            htmlFor="customer-settlement-group"
            hint={t('partners.settlement.groupHint')}
            error={errors.settlementGroup?.message}
          >
            <NativeSelect
              id="customer-settlement-group"
              className="sm:w-56"
              {...form.register('settlementGroup')}
            >
              <option value="">{t('partners.settlement.choose')}</option>
              {SETTLEMENT_GROUPS.map((value) => (
                <option key={value} value={value}>
                  {t(`partners.settlement.groups.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
        ) : null}
        {mode === 'edit' ? (
          <FormRow label={t('partners.customer.status')} htmlFor="customer-status" align="center">
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="customer-status"
                    checked={field.value === 'ACTIVE'}
                    onCheckedChange={(checked) => field.onChange(checked ? 'ACTIVE' : 'INACTIVE')}
                  />
                  <span className="text-sm">{t(`partners.status.${field.value}`)}</span>
                </div>
              )}
            />
          </FormRow>
        ) : null}
        <FormRow
          label={t('partners.customer.note')}
          htmlFor="customer-note"
          error={errors.note?.message}
        >
          <Textarea id="customer-note" rows={2} {...form.register('note')} />
        </FormRow>
      </FormSection>

      <FormSection
        title={t('partners.customer.sectionTax')}
        description={
          mode === 'edit' && customer?.taxStatusSource === null
            ? t('partners.customer.payerUnchecked')
            : undefined
        }
      >
        <FormRow
          label={t('partners.customer.regNo')}
          htmlFor="customer-reg-no"
          hint={
            regNoLooksOff
              ? kind === 'COMPANY'
                ? t('partners.customer.regNoHintCompany')
                : t('partners.customer.regNoHintIndividual')
              : undefined
          }
          error={errors.regNo?.message}
        >
          <Input
            id="customer-reg-no"
            autoComplete="off"
            className="font-mono sm:w-56"
            {...form.register('regNo')}
          />
        </FormRow>
        <FormRow
          label={t('partners.customer.tin')}
          htmlFor="customer-tin"
          hint={
            customer?.tinSource
              ? t(`partners.customer.tinSource.${customer.tinSource}`)
              : kind === 'COMPANY'
                ? t('partners.customer.tinHint')
                : undefined
          }
          error={errors.tin?.message}
        >
          <Input
            id="customer-tin"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-56"
            {...form.register('tin')}
          />
        </FormRow>
        {kind === 'INDIVIDUAL' ? (
          <FormRow
            label={t('partners.customer.consumerNo')}
            htmlFor="customer-consumer-no"
            hint={t('partners.customer.consumerNoHint')}
            error={errors.consumerNo?.message}
          >
            <Input
              id="customer-consumer-no"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono sm:w-56"
              {...form.register('consumerNo')}
            />
          </FormRow>
        ) : null}
        {PAYER_FLAGS.map((flag) => (
          <FormRow
            key={flag}
            label={t(`partners.customer.${flag}`)}
            htmlFor={`customer-${flag}`}
            align="center"
          >
            <Controller
              control={form.control}
              name={flag}
              render={({ field }) => (
                <Switch
                  id={`customer-${flag}`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </FormRow>
        ))}
      </FormSection>

      {mode === 'create' ? (
        <FormSection title={t('partners.customer.firstAddress')}>
          <FormRow
            label={t('partners.addresses.address')}
            htmlFor="customer-address"
            error={errors.address?.message}
          >
            <Textarea id="customer-address" rows={2} {...form.register('address')} />
          </FormRow>
          <FormRow
            label={t('partners.addresses.gps')}
            htmlFor="customer-gps"
            error={errors.gps?.message}
          >
            <GpsField
              id="customer-gps"
              value={form.watch('gps')}
              registration={form.register('gps')}
            />
          </FormRow>
          <FormRow
            label={t('partners.addresses.note')}
            htmlFor="customer-address-note"
            error={errors.addressNote?.message}
          >
            <Input
              id="customer-address-note"
              autoComplete="off"
              {...form.register('addressNote')}
            />
          </FormRow>
        </FormSection>
      ) : null}
    </fieldset>
  );
  const buttons = props.readOnly ? null : (
    <>
      {props.onCancel ? (
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      ) : null}
      <Button type="submit" disabled={isSubmitting}>
        {props.submitLabel}
      </Button>
    </>
  );

  return (
    <form
      className={props.page ? 'flex flex-col gap-4' : 'flex flex-col gap-5'}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <PartnerFormFrame page={props.page} problem={problem} fields={fields} buttons={buttons} />
    </form>
  );
}

/** The active categories, plus the customer's own when it was retired since (ADR-0107). */
function categoryOptions(
  categories: readonly CustomerCategory[] | undefined,
  current: string,
): CustomerCategory[] {
  return (categories ?? []).filter(
    (category) => category.active || String(category.id) === current,
  );
}

/** The reading side of a customer's card: the form's sections, label beside value (ADR-0043). */
export function CustomerFacts({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation();
  const categories = useCustomerCategories();
  const category = categories.data?.find((entry) => entry.id === customer.categoryId);
  const mono = (value: string | null) =>
    value ? <span className="font-mono">{value}</span> : null;
  return (
    <div className="flex flex-col gap-5">
      <FieldList
        title={t('partners.customer.sectionGeneral')}
        items={[
          { label: t('partners.customer.category'), value: category?.name ?? null },
          { label: t('partners.customer.code'), value: mono(customer.code) },
          { label: t('partners.customer.name'), value: customer.name },
          { label: t('partners.customer.kind'), value: t(`partners.kinds.${customer.kind}`) },
          {
            label: t('partners.customer.phone'),
            value: customer.phone ? localPhone(customer.phone) : null,
          },
          { label: t('partners.customer.status'), value: t(`partners.status.${customer.status}`) },
          { label: t('partners.customer.note'), value: customer.note },
        ]}
      />
      <FieldList
        title={t('partners.customer.sectionTax')}
        description={
          customer.taxStatusSource === null ? t('partners.customer.payerUnchecked') : undefined
        }
        items={[
          { label: t('partners.customer.regNo'), value: mono(customer.regNo) },
          {
            label: t('partners.customer.tin'),
            value: mono(customer.tin),
            hint: customer.tinSource
              ? t(`partners.customer.tinSource.${customer.tinSource}`)
              : null,
          },
          ...(customer.kind === 'INDIVIDUAL'
            ? [{ label: t('partners.customer.consumerNo'), value: mono(customer.consumerNo) }]
            : []),
          ...PAYER_FLAGS.map((flag) => ({
            label: t(`partners.customer.${flag}`),
            value: customer[flag] ? t('common.yes') : t('common.no'),
          })),
        ]}
      />
    </div>
  );
}
