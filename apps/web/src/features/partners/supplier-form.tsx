import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fieldOfDuplicate,
  PARTNER_STATUSES,
  type SupplierFormValues,
  supplierSchema,
} from './partner-schema';

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
  saved?: boolean;
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
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {props.submitLabel}
          </Button>
          {props.saved ? (
            <span role="status" className="text-sm text-muted-foreground">
              {t('partners.supplier.saved')}
            </span>
          ) : null}
        </div>
      )}
    </form>
  );
}
