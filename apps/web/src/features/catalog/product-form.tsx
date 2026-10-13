import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Brand, Category, Uom } from './api';
import { BarcodeList } from './barcode-entry';
import { barcodeKey } from './barcodes';
import { categoryTree } from './category-tree';
import {
  CITY_TAX_CHOICES,
  type ProductFormValues,
  productSchema,
  VAT_TYPES,
} from './product-schema';

/** A duplicate SKU is shown on the SKU field rather than as a page error. */
function isSkuTaken(problem: ProblemDetails): boolean {
  return problem.code === 'DUPLICATE_VALUE' && problem.params?.constraint === 'products_sku_key';
}

/**
 * The product form. Creating also takes the base unit, the other units and their barcodes;
 * editing changes the product row only (units, barcodes and images have their own cards).
 */
export function ProductForm(props: {
  mode: 'create' | 'edit';
  defaultValues: ProductFormValues;
  uoms: readonly Uom[];
  categories: readonly Category[];
  brands: readonly Brand[];
  readOnly?: boolean;
  submitLabel: string;
  /** Resolves to the API problem, or null when saved. */
  onSubmit: (values: ProductFormValues) => Promise<ProblemDetails | null>;
  /** Editing in a card: «Болих» returns to reading (ADR-0042). */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { mode, uoms, categories } = props;
  const schema = useMemo(() => productSchema(mode, uoms), [mode, uoms]);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: props.defaultValues,
  });
  const units = useFieldArray({ control: form.control, name: 'units' });
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const tree = useMemo(() => categoryTree(categories), [categories]);
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
  const categoryField = form.register('categoryId', {
    // A category's default БҮНА code fills an empty code field (ADR-0015 #3).
    onChange: (event: { target: { value: string } }) => {
      const category = categories.find((item) => String(item.id) === event.target.value);
      if (category?.defaultClassificationCode && !form.getValues('classificationCode')) {
        form.setValue('classificationCode', category.defaultClassificationCode);
      }
    },
  });
  const isRepeated = (lookupKey: string) => {
    const values = form.getValues();
    return [...values.baseBarcodes, ...values.units.flatMap((unit) => unit.barcodes)].some(
      (code) => barcodeKey(code) === lookupKey,
    );
  };
  /** Only one unit is the default for sales (or purchases): checking one clears the others. */
  const setDefault = (
    flag: 'isDefaultSales' | 'isDefaultPurchase',
    index: number,
    checked: boolean,
  ) => {
    form.getValues('units').forEach((_unit, other) => {
      if (other !== index && checked) form.setValue(`units.${other}.${flag}`, false);
    });
    form.setValue(`units.${index}.${flag}`, checked);
  };

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="flex min-w-0 flex-col gap-5">
        <FormSection title={t('catalog.product.sectionGeneral')}>
          <FormRow
            label={t('catalog.product.sku')}
            htmlFor="product-sku"
            hint={mode === 'create' ? t('catalog.product.skuHint') : undefined}
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
            <NativeSelect id="product-category" {...categoryField}>
              <option value="">{t('catalog.product.chooseCategory')}</option>
              {tree.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow label={t('catalog.product.brand')} htmlFor="product-brand">
            <NativeSelect id="product-brand" {...form.register('brandId')}>
              <option value="">{t('catalog.product.noBrand')}</option>
              {props.brands.map((brand) => (
                <option key={brand.id} value={String(brand.id)}>
                  {brand.name}
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
          {mode === 'edit' ? (
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
          ) : null}
        </FormSection>

        <FormSection
          title={t('catalog.product.ebarimt')}
          description={t('catalog.product.ebarimtHint')}
        >
          <FormRow label={t('catalog.product.vatType')} htmlFor="product-vat">
            <NativeSelect id="product-vat" {...form.register('vatType')}>
              {VAT_TYPES.map((vatType) => (
                <option key={vatType} value={vatType}>
                  {t(`catalog.product.vatTypes.${vatType}`)}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow label={t('catalog.product.cityTax')} htmlFor="product-city-tax">
            <NativeSelect id="product-city-tax" {...form.register('cityTax')}>
              {CITY_TAX_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`catalog.product.cityTaxValues.${choice}`)}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
          <FormRow
            label={t('catalog.product.classificationCode')}
            htmlFor="product-classification"
            error={errors.classificationCode?.message}
          >
            <Input
              id="product-classification"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono sm:w-44"
              {...form.register('classificationCode')}
            />
          </FormRow>
          <FormRow
            label={t('catalog.product.taxProductCode')}
            htmlFor="product-tax-code"
            error={errors.taxProductCode?.message}
          >
            <Input
              id="product-tax-code"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono sm:w-28"
              {...form.register('taxProductCode')}
            />
          </FormRow>
        </FormSection>

        {mode === 'create' ? (
          <>
            <FormSection title={t('catalog.product.sectionBaseUnit')}>
              <FormRow
                label={t('catalog.product.baseUnit')}
                htmlFor="product-base-unit"
                hint={t('catalog.product.baseUnitHint')}
                error={errors.baseUomId?.message}
              >
                <NativeSelect
                  id="product-base-unit"
                  className="sm:w-56"
                  {...form.register('baseUomId')}
                >
                  {uoms.map((uom) => (
                    <option key={uom.id} value={String(uom.id)}>
                      {uom.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormRow>
              <FormRow label={t('catalog.product.barcodes')} htmlFor="product-base-barcodes">
                <Controller
                  control={form.control}
                  name="baseBarcodes"
                  render={({ field }) => (
                    <BarcodeList
                      id="product-base-barcodes"
                      label={t('catalog.product.barcodes')}
                      value={field.value}
                      onChange={field.onChange}
                      isRepeated={isRepeated}
                    />
                  )}
                />
              </FormRow>
            </FormSection>

            <FormSection
              title={t('catalog.product.extraUnits')}
              description={t('catalog.product.extraUnitsHint')}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    units.append({
                      uomId: '',
                      factorToBase: '',
                      isDefaultSales: false,
                      isDefaultPurchase: false,
                      barcodes: [],
                    })
                  }
                >
                  <Plus />
                  {t('catalog.product.addUnit')}
                </Button>
              }
            >
              {units.fields.length === 0 ? (
                <p className="px-3.5 py-3 text-sm text-muted-foreground">
                  {t('catalog.product.noExtraUnits')}
                </p>
              ) : null}
              {units.fields.map((field, index) => {
                const prefix = `product-unit-${field.id}`;
                const unitErrors = errors.units?.[index];
                return (
                  <div key={field.id} className="relative flex flex-col gap-4 px-3.5 py-4">
                    <div className="grid gap-3 pr-10 sm:grid-cols-2">
                      <FormField
                        label={t('catalog.product.unit')}
                        htmlFor={`${prefix}-uom`}
                        error={unitErrors?.uomId?.message}
                      >
                        <NativeSelect
                          id={`${prefix}-uom`}
                          {...form.register(`units.${index}.uomId`)}
                        >
                          <option value="" />
                          {uoms.map((uom) => (
                            <option key={uom.id} value={String(uom.id)}>
                              {uom.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                      <FormField
                        label={t('catalog.product.factor')}
                        htmlFor={`${prefix}-factor`}
                        error={unitErrors?.factorToBase?.message}
                      >
                        <Input
                          id={`${prefix}-factor`}
                          inputMode="decimal"
                          autoComplete="off"
                          className="font-mono"
                          {...form.register(`units.${index}.factorToBase`)}
                        />
                      </FormField>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      {(['isDefaultSales', 'isDefaultPurchase'] as const).map((flag) => (
                        <Controller
                          key={flag}
                          control={form.control}
                          name={`units.${index}.${flag}`}
                          render={({ field: toggle }) => (
                            <div className="flex items-center gap-2.5">
                              <Switch
                                id={`${prefix}-${flag}`}
                                checked={toggle.value}
                                onCheckedChange={(checked) => setDefault(flag, index, checked)}
                              />
                              <Label htmlFor={`${prefix}-${flag}`} className="font-normal">
                                {flag === 'isDefaultSales'
                                  ? t('catalog.product.defaultSales')
                                  : t('catalog.product.defaultPurchase')}
                              </Label>
                            </div>
                          )}
                        />
                      ))}
                    </div>
                    <FormField
                      label={t('catalog.product.unitBarcodes')}
                      htmlFor={`${prefix}-barcodes`}
                    >
                      <Controller
                        control={form.control}
                        name={`units.${index}.barcodes`}
                        render={({ field: barcodes }) => (
                          <BarcodeList
                            id={`${prefix}-barcodes`}
                            label={t('catalog.product.unitBarcodes')}
                            value={barcodes.value}
                            onChange={barcodes.onChange}
                            isRepeated={isRepeated}
                          />
                        )}
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-3 right-2 text-muted-foreground hover:bg-danger-soft hover:text-destructive"
                      aria-label={t('catalog.product.removeUnit')}
                      title={t('catalog.product.removeUnit')}
                      onClick={() => units.remove(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </FormSection>
          </>
        ) : null}
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
