import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { rangeOwner } from '@tugeel/shared/catalog';
import { CircleCheck, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { FormField, FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWarehouseOptions } from '@/features/inventory/helpers';
import { SupplierPicker } from '@/features/partners/supplier-picker';
import type { ValidationMessage } from '@/lib/forms';
import { problemFromError } from '@/lib/problem';
import { randomUuid } from '@/lib/uuid';
import {
  type Category,
  type RegisteredProduct,
  type Uom,
  useCatalogMutations,
  useNextSku,
} from './api';
import { BarcodeList } from './barcode-entry';
import { barcodeKey } from './barcodes';
import { categoryTree } from './category-tree';
import { PhotoPicker } from './photo-picker';
import { photosMessage, usePhotoUploads } from './photo-uploads';
import {
  emptyRegistration,
  registrationBody,
  registrationSchema,
  type RegistrationValues,
} from './registration-schema';

const WHOLESALE = ['WHOLESALE'] as const;

/** A code another product took meanwhile is shown on the code field, with a fresh suggestion. */
function isSkuTaken(problem: ProblemDetails): boolean {
  return problem.code === 'DUPLICATE_VALUE' && problem.params?.constraint === 'products_sku_key';
}

/** A shelf code the home warehouse does not have is shown on its field. */
function isShelfUnknown(problem: ProblemDetails): boolean {
  return (
    problem.code === 'VALIDATION_FAILED' &&
    (problem.errors ?? []).some((error) => error.path === 'fixedBinCode')
  );
}

/**
 * Registering a product (ADR-0044 #5): the category first, which suggests the code from its range;
 * then the units with the box, barcodes, other units, the supplier, the home warehouse with an
 * optional shelf, and at least one photo. Saving registers everything at once; the product then
 * waits for its prices. The next product's form follows with the category, the supplier, the
 * warehouse and the base unit kept, and a line on top links to the product just registered.
 */
export function RegistrationForm(props: { uoms: readonly Uom[]; categories: readonly Category[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { uoms, categories } = props;
  const mutations = useCatalogMutations();
  const uploads = usePhotoUploads();
  const warehouses = useWarehouseOptions(WHOLESALE, true);
  const schema = useMemo(() => registrationSchema(uoms), [uoms]);
  const pieces = uoms.find((uom) => uom.code === 'PCS');
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyRegistration({
      categoryId: '',
      supplier: null,
      homeWarehouseId: '',
      baseUomId: pieces ? String(pieces.id) : '',
    }),
  });
  const units = useFieldArray({ control: form.control, name: 'units' });
  const [key, setKey] = useState(randomUuid);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [photoError, setPhotoError] = useState<ValidationMessage | null>(null);
  const [registered, setRegistered] = useState<RegisteredProduct | null>(null);
  const tree = useMemo(() => categoryTree(categories), [categories]);
  const { errors, isSubmitting } = form.formState;

  const categoryId = form.watch('categoryId');
  const baseUomId = form.watch('baseUomId');
  const nextSku = useNextSku(categoryId ? Number.parseInt(categoryId, 10) : undefined);
  const owner = categoryId ? rangeOwner(categories, Number.parseInt(categoryId, 10)) : null;
  const box = uoms.find((uom) => uom.code === 'BOX');
  const baseOptions = uoms.filter((uom) => uom.id !== box?.id);
  const unitOptions = baseOptions.filter((uom) => String(uom.id) !== baseUomId);
  const baseName = uoms.find((uom) => String(uom.id) === baseUomId)?.name ?? '';

  // The category's suggestion fills the code (ADR-0044 #1); it may be typed over.
  useEffect(() => {
    if (nextSku.data !== undefined) form.setValue('sku', nextSku.data);
  }, [nextSku.data, form]);
  // A registrar with one wholesale warehouse gets it chosen.
  const [onlyWarehouse] = warehouses.options.length === 1 ? warehouses.options : [];
  useEffect(() => {
    if (onlyWarehouse && !form.getValues('homeWarehouseId')) {
      form.setValue('homeWarehouseId', String(onlyWarehouse.id));
    }
  }, [onlyWarehouse, form]);

  const isRepeated = (lookupKey: string) => {
    const values = form.getValues();
    return [
      ...values.baseBarcodes,
      ...values.boxBarcodes,
      ...values.units.flatMap((unit) => unit.barcodes),
    ].some((code) => barcodeKey(code) === lookupKey);
  };

  const checkPhotos = () => {
    const message = photosMessage(uploads.photos);
    setPhotoError(message);
    return message === null;
  };
  // Once shown, the photos' message follows the photos (a photo added, an upload finished).
  useEffect(() => {
    if (photoError) setPhotoError(photosMessage(uploads.photos));
  }, [photoError, uploads.photos]);

  const submit = form.handleSubmit(
    async (values) => {
      if (!checkPhotos()) return;
      setProblem(null);
      try {
        const product = await mutations.register.mutateAsync({
          key,
          ...registrationBody(values, uploads.photos),
        });
        setRegistered(product);
        setKey(randomUuid());
        uploads.reset();
        form.reset(
          emptyRegistration({
            categoryId: values.categoryId,
            supplier: values.supplier,
            homeWarehouseId: values.homeWarehouseId,
            baseUomId: values.baseUomId,
          }),
        );
        const fresh = await nextSku.refetch();
        if (fresh.data !== undefined) form.setValue('sku', fresh.data);
        form.setFocus('name');
      } catch (error) {
        const found = problemFromError(error);
        if (found && isSkuTaken(found)) {
          const fresh = await nextSku.refetch();
          if (fresh.data !== undefined) form.setValue('sku', fresh.data);
          form.setError('sku', { type: 'server', message: 'validation.skuTakenNext' });
          form.setFocus('sku');
          return;
        }
        if (found && isShelfUnknown(found)) {
          form.setError(
            'fixedBinCode',
            { type: 'server', message: 'validation.shelfNotFound' },
            { shouldFocus: true },
          );
          return;
        }
        setProblem(found);
      }
    },
    () => {
      checkPhotos();
    },
  );

  const skuHint: ReactNode = nextSku.error ? (
    <span className="text-destructive">
      {(() => {
        const found = problemFromError(nextSku.error);
        return found ? t(`errors.${found.code}`, found.params ?? {}) : null;
      })()}
    </span>
  ) : !categoryId ? (
    t('catalog.registration.skuHintPick')
  ) : owner ? (
    t('catalog.registration.skuHintRange', {
      category: owner.name,
      from: owner.skuFrom,
      to: owner.skuTo,
    })
  ) : (
    t('catalog.registration.skuHintFree')
  );

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      {registered ? (
        <Alert className="border-transparent bg-success-soft">
          <CircleCheck aria-hidden className="text-success" />
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
            {t('catalog.registration.registered', {
              sku: registered.sku,
              name: registered.name,
            })}
            <Link
              to={`/catalog/products/${registered.productId}`}
              className="font-medium text-link hover:underline"
            >
              {t('catalog.registration.view')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <FormSection title={t('catalog.registration.sectionCode')}>
        <FormRow
          label={t('catalog.product.category')}
          htmlFor="registration-category"
          error={errors.categoryId?.message}
        >
          <NativeSelect id="registration-category" {...form.register('categoryId')}>
            <option value="">{t('catalog.product.chooseCategory')}</option>
            {tree.map((node) => (
              <option key={node.category.id} value={String(node.category.id)}>
                {node.path}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('catalog.product.sku')}
          htmlFor="registration-sku"
          hint={skuHint}
          error={errors.sku?.message}
        >
          <Input
            id="registration-sku"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-44"
            {...form.register('sku')}
          />
        </FormRow>
        <FormRow
          label={t('catalog.product.name')}
          htmlFor="registration-name"
          error={errors.name?.message}
        >
          <Input id="registration-name" autoComplete="off" {...form.register('name')} />
        </FormRow>
      </FormSection>

      <FormSection title={t('catalog.registration.sectionUnits')}>
        <FormRow
          label={t('catalog.product.baseUnit')}
          htmlFor="registration-base-unit"
          hint={t('catalog.product.baseUnitHint')}
          error={errors.baseUomId?.message}
        >
          <NativeSelect
            id="registration-base-unit"
            className="sm:w-56"
            {...form.register('baseUomId')}
          >
            {baseOptions.map((uom) => (
              <option key={uom.id} value={String(uom.id)}>
                {uom.name}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('catalog.registration.boxFactor')}
          htmlFor="registration-box-factor"
          hint={t('catalog.registration.boxFactorHint', { unit: baseName })}
          error={errors.boxFactor?.message}
        >
          <Input
            id="registration-box-factor"
            inputMode="decimal"
            autoComplete="off"
            className="font-mono sm:w-36"
            {...form.register('boxFactor')}
          />
        </FormRow>
        <FormRow
          label={t('catalog.product.weight')}
          htmlFor="registration-weight"
          error={errors.weightKg?.message}
        >
          <Input
            id="registration-weight"
            inputMode="decimal"
            autoComplete="off"
            className="font-mono sm:w-36"
            {...form.register('weightKg')}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t('catalog.registration.sectionBarcodes')}>
        <FormRow
          label={t('catalog.registration.baseBarcodes')}
          htmlFor="registration-base-barcodes"
        >
          <Controller
            control={form.control}
            name="baseBarcodes"
            render={({ field }) => (
              <BarcodeList
                id="registration-base-barcodes"
                label={t('catalog.registration.baseBarcodes')}
                value={field.value}
                onChange={field.onChange}
                isRepeated={isRepeated}
              />
            )}
          />
        </FormRow>
        <FormRow label={t('catalog.registration.boxBarcodes')} htmlFor="registration-box-barcodes">
          <Controller
            control={form.control}
            name="boxBarcodes"
            render={({ field }) => (
              <BarcodeList
                id="registration-box-barcodes"
                label={t('catalog.registration.boxBarcodes')}
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
        description={t('catalog.registration.extraUnitsHint')}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => units.append({ uomId: '', factorToBase: '', barcodes: [] })}
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
          const prefix = `registration-unit-${field.id}`;
          const unitErrors = errors.units?.[index];
          return (
            <div key={field.id} className="relative flex flex-col gap-4 px-3.5 py-4">
              <div className="grid gap-3 pr-10 sm:grid-cols-2">
                <FormField
                  label={t('catalog.product.unit')}
                  htmlFor={`${prefix}-uom`}
                  error={unitErrors?.uomId?.message}
                >
                  <NativeSelect id={`${prefix}-uom`} {...form.register(`units.${index}.uomId`)}>
                    <option value="" />
                    {unitOptions.map((uom) => (
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
              <FormField label={t('catalog.product.unitBarcodes')} htmlFor={`${prefix}-barcodes`}>
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

      <FormSection title={t('catalog.registration.sectionPlace')}>
        <FormRow
          label={t('catalog.registration.supplier')}
          htmlFor="registration-supplier"
          error={errors.supplier?.message}
        >
          <Controller
            control={form.control}
            name="supplier"
            render={({ field }) => (
              <SupplierPicker
                id="registration-supplier"
                value={field.value}
                onChange={field.onChange}
                invalid={Boolean(errors.supplier)}
              />
            )}
          />
        </FormRow>
        <FormRow
          label={t('catalog.registration.homeWarehouse')}
          htmlFor="registration-home"
          hint={t('catalog.registration.homeWarehouseHint')}
          error={errors.homeWarehouseId?.message}
        >
          <NativeSelect
            id="registration-home"
            className="sm:w-72"
            {...form.register('homeWarehouseId')}
          >
            <option value="">{t('inventory.pickWarehouse')}</option>
            {warehouses.options.map((warehouse) => (
              <option key={warehouse.id} value={String(warehouse.id)}>
                {warehouse.name}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('catalog.registration.fixedBin')}
          htmlFor="registration-bin"
          hint={t('catalog.registration.fixedBinHint')}
          error={errors.fixedBinCode?.message}
        >
          <Input
            id="registration-bin"
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase sm:w-44"
            {...form.register('fixedBinCode')}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title={t('catalog.registration.sectionPhotos')}
        description={t('catalog.registration.photosHint')}
      >
        <FormRow label={t('catalog.registration.photos')} htmlFor="registration-photos">
          <PhotoPicker id="registration-photos" uploads={uploads} error={photoError} />
        </FormRow>
      </FormSection>

      <ProblemAlert problem={problem ?? problemFromError(warehouses.error)} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={() => void navigate('/catalog/products')}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
