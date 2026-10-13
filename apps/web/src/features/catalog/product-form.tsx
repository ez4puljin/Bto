import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Category } from './api';
import { categoryTree } from './category-tree';
import { type ProductFormValues, productSchema } from './product-schema';

/** A duplicate SKU is shown on the SKU field rather than as a page error. */
function isSkuTaken(problem: ProblemDetails): boolean {
  return problem.code === 'DUPLICATE_VALUE' && problem.params?.constraint === 'products_sku_key';
}

/**
 * The product card's form: code, name, category, weight and status. Units, barcodes, photos and
 * the e-Barimt data have their own cards; a new product is registered on its own page (ADR-0044).
 */
export function ProductForm(props: {
  defaultValues: ProductFormValues;
  categories: readonly Category[];
  readOnly?: boolean;
  submitLabel: string;
  /** Resolves to the API problem, or null when saved. */
  onSubmit: (values: ProductFormValues) => Promise<ProblemDetails | null>;
  /** Editing in a card: «Болих» returns to reading (ADR-0042). */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: props.defaultValues,
  });
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const tree = useMemo(() => categoryTree(props.categories), [props.categories]);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await props.onSubmit(values);
    if (result && isSkuTaken(result)) {
      setProblem(null);
      form.setError(
        'sku',
        { type: 'server', message: 'validation.skuTaken' },
        { shouldFocus: true },
      );
      return;
    }
    setProblem(result);
  });

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="flex min-w-0 flex-col gap-5">
        <FormSection title={t('catalog.product.sectionGeneral')}>
          <FormRow
            label={t('catalog.product.sku')}
            htmlFor="product-sku"
            error={errors.sku?.message}
          >
            <Input
              id="product-sku"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono sm:w-44"
              {...form.register('sku')}
            />
          </FormRow>
          <FormRow
            label={t('catalog.product.name')}
            htmlFor="product-name"
            error={errors.name?.message}
          >
            <Input id="product-name" autoComplete="off" {...form.register('name')} />
          </FormRow>
          <FormRow
            label={t('catalog.product.category')}
            htmlFor="product-category"
            error={errors.categoryId?.message}
          >
            <NativeSelect id="product-category" {...form.register('categoryId')}>
              <option value="">{t('catalog.product.chooseCategory')}</option>
              {tree.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow
            label={t('catalog.product.weight')}
            htmlFor="product-weight"
            error={errors.weightKg?.message}
          >
            <Input
              id="product-weight"
              inputMode="decimal"
              autoComplete="off"
              className="font-mono sm:w-36"
              {...form.register('weightKg')}
            />
          </FormRow>
          <FormRow label={t('catalog.product.status')} htmlFor="product-status" align="center">
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="product-status"
                    checked={field.value === 'ACTIVE'}
                    onCheckedChange={(checked) => field.onChange(checked ? 'ACTIVE' : 'INACTIVE')}
                  />
                  <span className="text-sm">{t(`catalog.products.status.${field.value}`)}</span>
                </div>
              )}
            />
          </FormRow>
        </FormSection>
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
