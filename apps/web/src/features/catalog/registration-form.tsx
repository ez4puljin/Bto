import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { rangeOwner } from '@tugeel/shared/catalog';
import { Circle, CircleCheck, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { FormField, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWarehouseOptions } from '@/features/inventory/helpers';
import { ComingSoonNote } from '@/components/coming-soon';
import { SupplierPicker } from '@/features/partners/supplier-picker';
import { BINS_SOON } from '@/lib/features';
import type { ValidationMessage } from '@/lib/forms';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
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
 * warehouse and the base unit kept, and a line on top links to the product just registered. The
 * card takes two columns from `xl` on (code, units and barcodes | supplier, place and photos) and
 * «Хадгалах» sticks to the window's foot (ADR-0066): the form is filled many times a day.
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

  // The summary beside the form: what is filled so far, and what the save still needs.
  const name = form.watch('name');
  const sku = form.watch('sku');
  const supplier = form.watch('supplier');
  const homeWarehouseId = form.watch('homeWarehouseId');
  const baseBarcodes = form.watch('baseBarcodes');
  const readyPhotos = uploads.photos.filter((photo) => photo.status === 'ready').length;
  const checklist: {
    key: 'category' | 'name' | 'unit' | 'barcode' | 'supplier' | 'warehouse' | 'photo';
    done: boolean;
  }[] = [
    { key: 'category', done: Boolean(categoryId) },
    { key: 'name', done: name.trim().length > 0 },
    { key: 'unit', done: Boolean(baseUomId) },
    { key: 'barcode', done: baseBarcodes.length > 0 },
    { key: 'supplier', done: supplier !== null },
    { key: 'warehouse', done: Boolean(homeWarehouseId) },
    { key: 'photo', done: readyPhotos > 0 },
  ];

  return (
    <form className="flex flex-col gap-4 pb-28" noValidate onSubmit={(event) => void submit(event)}>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-6">
              <FormSection step={1} title={t('catalog.registration.sectionCode')} plain>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)]">
                  <FormField
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
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <FormField
                      label={t('catalog.product.sku')}
                      htmlFor="registration-sku"
                      hint={skuHint}
                      error={errors.sku?.message}
                    >
                      <Input
                        id="registration-sku"
                        inputMode="numeric"
                        autoComplete="off"
                        className="font-mono"
                        {...form.register('sku')}
                      />
                    </FormField>
                    <FormField
                      label={t('catalog.product.name')}
                      htmlFor="registration-name"
                      error={errors.name?.message}
                    >
                      <Input
                        id="registration-name"
                        autoComplete="off"
                        placeholder={t('catalog.registration.namePlaceholder')}
                        {...form.register('name')}
                      />
                    </FormField>
                  </div>
                </div>
              </FormSection>

              <FormSection step={2} title={t('catalog.registration.sectionUnits')} plain>
                <div className="flex flex-col gap-5">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      label={t('catalog.product.baseUnit')}
                      htmlFor="registration-base-unit"
                      hint={t('catalog.product.baseUnitHint')}
                      error={errors.baseUomId?.message}
                    >
                      <NativeSelect id="registration-base-unit" {...form.register('baseUomId')}>
                        {baseOptions.map((uom) => (
                          <option key={uom.id} value={String(uom.id)}>
                            {uom.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                    <FormField
                      label={t('catalog.registration.boxFactor')}
                      htmlFor="registration-box-factor"
                      error={errors.boxFactor?.message}
                    >
                      <Input
                        id="registration-box-factor"
                        inputMode="decimal"
                        autoComplete="off"
                        className="font-mono"
                        {...form.register('boxFactor')}
                      />
                    </FormField>
                    <FormField
                      label={t('catalog.product.weight')}
                      htmlFor="registration-weight"
                      error={errors.weightKg?.message}
                    >
                      <Input
                        id="registration-weight"
                        inputMode="decimal"
                        autoComplete="off"
                        className="font-mono"
                        {...form.register('weightKg')}
                      />
                    </FormField>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-medium">{t('catalog.product.extraUnits')}</h4>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => units.append({ uomId: '', factorToBase: '', barcodes: [] })}
                      >
                        <Plus />
                        {t('catalog.product.addUnit')}
                      </Button>
                    </div>
                    {units.fields.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                        {t('catalog.product.noExtraUnits')}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {units.fields.map((field, index) => {
                          const prefix = `registration-unit-${field.id}`;
                          const unitErrors = errors.units?.[index];
                          return (
                            <div
                              key={field.id}
                              className="relative grid gap-4 rounded-xl border border-border/90 bg-background p-4 pr-12 md:grid-cols-[10rem_8rem_minmax(0,1fr)]"
                            >
                              <FormField
                                label={t('catalog.product.unit')}
                                htmlFor={`${prefix}-uom`}
                                error={unitErrors?.uomId?.message}
                              >
                                <NativeSelect
                                  id={`${prefix}-uom`}
                                  {...form.register(`units.${index}.uomId`)}
                                >
                                  <option value="">{t('catalog.product.chooseUnit')}</option>
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
                                className="absolute top-3 right-3 text-muted-foreground hover:bg-danger-soft hover:text-destructive"
                                aria-label={t('catalog.product.removeUnit')}
                                title={t('catalog.product.removeUnit')}
                                onClick={() => units.remove(index)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </FormSection>

              <FormSection step={3} title={t('catalog.registration.sectionBarcodes')} plain>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
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
                  </FormField>
                  <FormField
                    label={t('catalog.registration.boxBarcodes')}
                    htmlFor="registration-box-barcodes"
                  >
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
                  </FormField>
                </div>
              </FormSection>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20">
          <Card>
            <CardContent className="flex flex-col gap-6">
              <FormSection title={t('catalog.registration.sectionPlace')} plain>
                <div className="flex flex-col gap-4">
                  <FormField
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
                  </FormField>
                  <FormField
                    label={t('catalog.registration.homeWarehouse')}
                    htmlFor="registration-home"
                    hint={t('catalog.registration.homeWarehouseHint')}
                    error={errors.homeWarehouseId?.message}
                  >
                    <NativeSelect id="registration-home" {...form.register('homeWarehouseId')}>
                      <option value="">{t('inventory.pickWarehouse')}</option>
                      {warehouses.options.map((warehouse) => (
                        <option key={warehouse.id} value={String(warehouse.id)}>
                          {warehouse.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  {BINS_SOON ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-foreground/80">
                        {t('catalog.registration.fixedBin')}
                      </span>
                      <ComingSoonNote>{t('catalog.registration.fixedBinSoon')}</ComingSoonNote>
                    </div>
                  ) : (
                    <FormField
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
                    </FormField>
                  )}
                </div>
              </FormSection>

              <FormSection
                title={t('catalog.registration.sectionPhotos')}
                description={t('catalog.registration.photosHint')}
                plain
              >
                <label htmlFor="registration-photos" className="sr-only">
                  {t('catalog.registration.photos')}
                </label>
                <PhotoPicker id="registration-photos" uploads={uploads} error={photoError} wide />
              </FormSection>
            </CardContent>
          </Card>
        </div>
      </div>

      <ProblemAlert problem={problem ?? problemFromError(warehouses.error)} />
      <StickyActions
        summary={
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate font-medium text-foreground">
              {name.trim()
                ? t('catalog.registration.saveSummary', { sku, name })
                : t('catalog.registration.summaryNoName')}
            </span>
            <ul
              className="flex flex-wrap items-center gap-1.5"
              aria-label={t('catalog.registration.summary')}
            >
              {checklist.map((item) => (
                <li
                  key={item.key}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.75rem]',
                    item.done ? 'bg-success-soft text-success' : 'bg-fill text-muted-foreground',
                  )}
                >
                  {item.done ? (
                    <CircleCheck aria-hidden className="size-3" />
                  ) : (
                    <Circle aria-hidden className="size-3" />
                  )}
                  {t(`catalog.registration.check.${item.key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
      >
        <Button type="button" variant="ghost" onClick={() => void navigate('/catalog/products')}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </StickyActions>
    </form>
  );
}
