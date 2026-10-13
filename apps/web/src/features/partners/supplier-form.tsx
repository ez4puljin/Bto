import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldList } from '@/components/detail';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SupplierDetail } from './api';
import {
  fieldOfDuplicate,
  PARTNER_STATUSES,
  type SupplierFormValues,
  supplierSchema,
} from './partner-schema';
import { localPhone } from './phone';

type TextField = Exclude<keyof SupplierFormValues, 'status' | 'note'>;
const FIELDS: readonly {
  name: TextField;
  inputMode?: 'numeric' | 'tel' | 'email';
  mono?: boolean;
}[] = [
  { name: 'code', inputMode: 'numeric', mono: true },
  { name: 'name' },
  { name: 'regNo', mono: true },
  { name: 'tin', inputMode: 'numeric', mono: true },
  { name: 'phone', inputMode: 'tel' },
  { name: 'email', inputMode: 'email' },
  { name: 'address' },
  { name: 'bankName' },
  { name: 'bankAccount', mono: true },
  { name: 'paymentTermDays', inputMode: 'numeric' },
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
 * The supplier form (SPEC §5.3): names are unique so the product sheet's supplier column can be
 * matched by name; a taken code or name is shown on its field.
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

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.name} className="flex flex-col gap-2">
            <Label htmlFor={`supplier-${field.name}`}>{t(LABELS[field.name])}</Label>
            <Input
              id={`supplier-${field.name}`}
              inputMode={field.inputMode}
              autoComplete="off"
              className={field.mono ? 'font-mono' : undefined}
              {...form.register(field.name)}
            />
            {field.name === 'code' && props.mode === 'create' ? (
              <p className="text-xs text-muted-foreground">{t('partners.supplier.codeHint')}</p>
            ) : null}
            <FieldError message={errors[field.name]?.message} />
          </div>
        ))}
        {props.mode === 'edit' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="supplier-status">{t('partners.supplier.status')}</Label>
            <NativeSelect id="supplier-status" {...form.register('status')}>
              {PARTNER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`partners.status.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="supplier-note">{t('partners.supplier.note')}</Label>
          <Textarea id="supplier-note" rows={2} {...form.register('note')} />
          <FieldError message={errors.note?.message} />
        </div>
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

/** The reading side of a supplier's card: the form's fields, label over value (ADR-0042). */
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
  return (
    <FieldList
      items={[
        ...FIELDS.map((field) => {
          const shown = value(field.name);
          return {
            label: t(LABELS[field.name]),
            value: field.mono && shown ? <span className="font-mono">{shown}</span> : shown,
          };
        }),
        { label: t('partners.supplier.status'), value: t(`partners.status.${detail.status}`) },
        { label: t('partners.supplier.note'), value: detail.note, wide: true },
      ]}
    />
  );
}
