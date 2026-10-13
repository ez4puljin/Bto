import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { Brand, Category, Uom } from './api';
import { BarcodeList } from './barcode-entry';
import { barcodeKey } from './barcodes';
import { categoryTree } from './category-tree';
import {
  CITY_TAX_CHOICES,
  PRODUCT_STATUSES,
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
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <ProblemAlert problem={problem} />
      <fieldset disabled={props.readOnly} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-sku">{t('catalog.product.sku')}</Label>
            <Input
              id="product-sku"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('sku')}
            />
            {mode === 'create' ? (
              <p className="text-xs text-muted-foreground">{t('catalog.product.skuHint')}</p>
            ) : null}
            <FieldError message={errors.sku?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-name">{t('catalog.product.name')}</Label>
            <Input id="product-name" autoComplete="off" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-category">{t('catalog.product.category')}</Label>
            <NativeSelect id="product-category" {...categoryField}>
              <option value="">{t('catalog.product.chooseCategory')}</option>
              {tree.map((node) => (
                <option key={node.category.id} value={String(node.category.id)}>
                  {node.path}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.categoryId?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-brand">{t('catalog.product.brand')}</Label>
            <NativeSelect id="product-brand" {...form.register('brandId')}>
              <option value="">{t('catalog.product.noBrand')}</option>
              {props.brands.map((brand) => (
                <option key={brand.id} value={String(brand.id)}>
                  {brand.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-weight">{t('catalog.product.weight')}</Label>
            <Input
              id="product-weight"
              inputMode="decimal"
              autoComplete="off"
              {...form.register('weightKg')}
            />
            <FieldError message={errors.weightKg?.message} />
          </div>
          {mode === 'edit' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-status">{t('catalog.product.status')}</Label>
              <NativeSelect id="product-status" {...form.register('status')}>
                {PRODUCT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`catalog.products.status.${status}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </div>

        <Separator />
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">{t('catalog.product.ebarimt')}</h2>
          <p className="text-xs text-muted-foreground">{t('catalog.product.ebarimtHint')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-vat">{t('catalog.product.vatType')}</Label>
            <NativeSelect id="product-vat" {...form.register('vatType')}>
              {VAT_TYPES.map((vatType) => (
                <option key={vatType} value={vatType}>
                  {t(`catalog.product.vatTypes.${vatType}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-city-tax">{t('catalog.product.cityTax')}</Label>
            <NativeSelect id="product-city-tax" {...form.register('cityTax')}>
              {CITY_TAX_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`catalog.product.cityTaxValues.${choice}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-classification">
              {t('catalog.product.classificationCode')}
            </Label>
            <Input
              id="product-classification"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('classificationCode')}
            />
            <FieldError message={errors.classificationCode?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-tax-code">{t('catalog.product.taxProductCode')}</Label>
            <Input
              id="product-tax-code"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...form.register('taxProductCode')}
            />
            <FieldError message={errors.taxProductCode?.message} />
          </div>
        </div>

        {mode === 'create' ? (
          <>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-base-unit">{t('catalog.product.baseUnit')}</Label>
                <NativeSelect id="product-base-unit" {...form.register('baseUomId')}>
                  {uoms.map((uom) => (
                    <option key={uom.id} value={String(uom.id)}>
                      {uom.name}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">{t('catalog.product.baseUnitHint')}</p>
                <FieldError message={errors.baseUomId?.message} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-base-barcodes">{t('catalog.product.barcodes')}</Label>
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
              </div>
            </div>

            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{t('catalog.product.extraUnits')}</h2>
              <Button
                type="button"
                variant="outline"
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
            </div>
            {units.fields.map((field, index) => {
              const prefix = `product-unit-${field.id}`;
              const unitErrors = errors.units?.[index];
              return (
                <div key={field.id} className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`${prefix}-uom`}>{t('catalog.product.unit')}</Label>
                      <NativeSelect id={`${prefix}-uom`} {...form.register(`units.${index}.uomId`)}>
                        <option value="" />
                        {uoms.map((uom) => (
                          <option key={uom.id} value={String(uom.id)}>
                            {uom.name}
                          </option>
                        ))}
                      </NativeSelect>
                      <FieldError message={unitErrors?.uomId?.message} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`${prefix}-factor`}>{t('catalog.product.factor')}</Label>
                      <Input
                        id={`${prefix}-factor`}
                        inputMode="decimal"
                        autoComplete="off"
                        {...form.register(`units.${index}.factorToBase`)}
                      />
                      <FieldError message={unitErrors?.factorToBase?.message} />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="sm:mt-6"
                      onClick={() => units.remove(index)}
                    >
                      <Trash2 />
                      {t('catalog.product.removeUnit')}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {(['isDefaultSales', 'isDefaultPurchase'] as const).map((flag) => (
                      <Controller
                        key={flag}
                        control={form.control}
                        name={`units.${index}.${flag}`}
                        render={({ field: checkbox }) => (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`${prefix}-${flag}`}
                              checked={checkbox.value}
                              onCheckedChange={(checked) =>
                                setDefault(flag, index, checked === true)
                              }
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
                </div>
              );
            })}
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
