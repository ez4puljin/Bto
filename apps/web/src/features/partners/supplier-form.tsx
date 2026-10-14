import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SupplierDetail } from './api';
import { fieldOfDuplicate, type SupplierFormValues, supplierSchema } from './partner-schema';
import { localPhone } from './phone';

type TextField = Exclude<keyof SupplierFormValues, 'status' | 'note'>;
interface FieldSpec {
  name: TextField;
  inputMode?: 'numeric' | 'tel' | 'email';
  mono?: boolean;
  /** A width for a short value (ADR-0043); names and addresses take the row. */
  width?: string;
}
const GENERAL: readonly FieldSpec[] = [
  { name: 'code', inputMode: 'numeric', mono: true, width: 'sm:w-44' },
  { name: 'name' },
  { name: 'phone', inputMode: 'tel', width: 'sm:w-56' },
  { name: 'email', inputMode: 'email' },
  { name: 'address' },
];
const MONEY: readonly FieldSpec[] = [
  { name: 'regNo', mono: true, width: 'sm:w-56' },
  { name: 'tin', inputMode: 'numeric', mono: true, width: 'sm:w-56' },
  { name: 'bankName' },
  { name: 'bankAccount', mono: true, width: 'sm:w-64' },
  { name: 'paymentTermDays', inputMode: 'numeric', width: 'sm:w-28' },
];
const LABELS = {
  code: 'partners.supplier.code',
  name: 'partners.supplier.name',
  regNo: 'partners.supplier.regNo',
  tin: 'partners.supplier.tin',
  phone: 'partners.supplier.phone',
  email: 'partners.supplier.email',
  address: 'partners.supplier.address',
  bankName: 'partners.supplier.bankName',
  bankAccount: 'partners.supplier.bankAccount',
  paymentTermDays: 'partners.supplier.paymentTerm',
} as const satisfies Record<TextField, string>;

/**
 * The supplier form (SPEC §5.3), settings-style (ADR-0043): names are unique so the product sheet's
 * supplier column can be matched by name; a taken code or name is shown on its field.
 */
export function SupplierForm(props: {
  mode: 'create' | 'edit';
  defaultValues: SupplierFormValues;
  readOnly?: boolean;
  submitLabel: string;
  /** Resolves to the API problem, or null when saved. */
  onSubmit: (values: SupplierFormValues) => Promise<ProblemDetails | null>;
  /** Editing in a card: «Болих» returns to reading (ADR-0042). */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: props.defaultValues,
  });
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await props.onSubmit(values);
    const field =
      result?.code === 'DUPLICATE_VALUE' ? fieldOfDuplicate(result.params?.constraint) : null;
    if (field) {
      setProblem(null);
      form.setError(
        field,
        {
          type: 'server',
          message: field === 'code' ? 'validation.codeTaken' : 'validation.supplierNameTaken',
        },
        { shouldFocus: true },
      );
      return;
    }
    setProblem(result);
  });

  const row = (field: FieldSpec) => (
    <FormRow
      key={field.name}
      label={t(LABELS[field.name])}
      htmlFor={`supplier-${field.name}`}
      hint={
        field.name === 'code' && props.mode === 'create'
          ? t('partners.supplier.codeHint')
          : undefined
      }
      error={errors[field.name]?.message}
    >
      <Input
        id={`supplier-${field.name}`}
        inputMode={field.inputMode}
        autoComplete="off"
        className={cn(field.mono && 'font-mono', field.width)}
        {...form.register(field.name)}
      />
    </FormRow>
  );

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="flex min-w-0 flex-col gap-5">
        <FormSection title={t('partners.supplier.sectionGeneral')}>
          {GENERAL.map(row)}
          {props.mode === 'edit' ? (
            <FormRow label={t('partners.supplier.status')} htmlFor="supplier-status" align="center">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <div className="flex items-center gap-2.5">
                    <Switch
                      id="supplier-status"
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
            label={t('partners.supplier.note')}
            htmlFor="supplier-note"
            error={errors.note?.message}
          >
            <Textarea id="supplier-note" rows={2} {...form.register('note')} />
          </FormRow>
        </FormSection>
        <FormSection title={t('partners.supplier.sectionMoney')}>{MONEY.map(row)}</FormSection>
      </fieldset>
      {props.readOnly ? null : (
        <FormFooter>
          {props.onCancel ? (
            <Button type="button" variant="ghost" onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {props.submitLabel}
          </Button>
        </FormFooter>
      )}
    </form>
  );
}

/** The reading side of a supplier's card: the form's sections, label beside value (ADR-0043). */
export function SupplierFacts({ detail }: { detail: SupplierDetail }) {
  const { t } = useTranslation();
  const value = (name: TextField) => {
    switch (name) {
      case 'phone':
        return detail.phone ? localPhone(detail.phone) : null;
      case 'paymentTermDays':
        return detail.paymentTermDays === null
          ? null
          : t('partners.credit.termCustomer', { days: detail.paymentTermDays });
      default:
        return detail[name];
    }
  };
  const items = (fields: readonly FieldSpec[]) =>
    fields.map((field) => {
      const shown = value(field.name);
      return {
        label: t(LABELS[field.name]),
        value: field.mono && shown ? <span className="font-mono">{shown}</span> : shown,
      };
    });
  return (
    <div className="flex flex-col gap-5">
      <FieldList
        title={t('partners.supplier.sectionGeneral')}
        items={[
          ...items(GENERAL),
          { label: t('partners.supplier.status'), value: t(`partners.status.${detail.status}`) },
          { label: t('partners.supplier.note'), value: detail.note },
        ]}
      />
      <FieldList title={t('partners.supplier.sectionMoney')} items={items(MONEY)} />
    </div>
  );
}
