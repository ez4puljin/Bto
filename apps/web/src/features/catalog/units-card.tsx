import { zodResolver } from '@hookform/resolvers/zod';
import { isExactFactor } from '@tugeel/shared/units';
import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatUbDateTime } from '@/lib/dayjs';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type ProductDetail, type ProductUnit, useCatalogMutations, useUoms } from './api';
import { BarcodeEntry, BarcodeList } from './barcode-entry';
import { barcodeKey } from './barcodes';
import { FACTOR } from './product-schema';

const factorField = (fractional: boolean) =>
  z
    .string()
    .trim()
    .regex(FACTOR, 'validation.factor')
    // The pattern is checked first: a Decimal is parsed only from a valid number.
    .refine(
      (value) => !FACTOR.test(value) || isExactFactor(value, fractional),
      'validation.factor',
    );

/** The units of a product with their barcodes; superseded and retired units below (ADR-0008). */
export function UnitsCard({ product, canManage }: { product: ProductDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const retireAction = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProductUnit | null>(null);
  const [superseding, setSuperseding] = useState<ProductUnit | null>(null);
  const [retiring, setRetiring] = useState<{ unit: ProductUnit; key: string } | null>(null);
  const current = product.units.filter((unit) => unit.supersededAt === null);
  const history = product.units.filter((unit) => unit.supersededAt !== null);
  const base = current.find((unit) => unit.isBase);
  const keys = current.flatMap((unit) => unit.barcodes.map((barcode) => barcodeKey(barcode.code)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.units.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              {t('catalog.product.addUnit')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        {current.map((unit) => (
          <section
            key={unit.id}
            aria-label={unit.uomName}
            className="flex flex-col gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{unit.uomName}</span>
              {unit.isBase ? (
                <Badge variant="secondary">{t('catalog.units.base')}</Badge>
              ) : (
                <span className="text-muted-foreground">
                  {t('catalog.units.factorOf', {
                    unit: unit.uomName,
                    factor: unit.factorToBase,
                    base: base?.uomName ?? '',
                  })}
                </span>
              )}
              {unit.isDefaultSales ? (
                <Badge variant="outline">{t('catalog.product.defaultSales')}</Badge>
              ) : null}
              {unit.isDefaultPurchase ? (
                <Badge variant="outline">{t('catalog.product.defaultPurchase')}</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {t('catalog.units.measureUnit')}
                {': '}
                {unit.effectiveMeasureUnit ?? t('common.none')}
              </span>
            </div>
            {unit.barcodes.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {unit.barcodes.map((barcode) => (
                  <li key={barcode.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{barcode.code}</span>
                    {barcode.isPrimary ? (
                      <Badge variant="secondary">{t('catalog.units.primary')}</Badge>
                    ) : null}
                    {barcode.isInternal ? (
                      <Badge variant="outline">{t('catalog.units.internal')}</Badge>
                    ) : null}
                    {canManage && !barcode.isPrimary ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void action.run(() => mutations.primaryBarcode.mutateAsync(barcode.id))
                        }
                      >
                        {t('catalog.units.makePrimary')}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t('catalog.units.deleteBarcode')}
                        onClick={() =>
                          void action.run(() => mutations.deleteBarcode.mutateAsync(barcode.id))
                        }
                      >
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('catalog.units.noBarcodes')}</p>
            )}
            {canManage ? (
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                <div className="lg:w-96">
                  <BarcodeEntry
                    id={`unit-${unit.id}-barcode`}
                    label={t('catalog.units.addBarcode')}
                    isRepeated={(lookupKey) => keys.includes(lookupKey)}
                    onAdd={(code) =>
                      action.run(() => mutations.addBarcode.mutateAsync({ unitId: unit.id, code }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {unit.barcodes.some((barcode) => barcode.isInternal) ? null : (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void action.run(() =>
                          mutations.internalBarcode.mutateAsync({
                            unitId: unit.id,
                            key: randomUuid(),
                          }),
                        )
                      }
                    >
                      {t('catalog.units.internalBarcode')}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setEditing(unit)}>
                    {t('common.edit')}
                  </Button>
                  {unit.isBase ? null : (
                    <>
                      <Button variant="outline" onClick={() => setSuperseding(unit)}>
                        {t('catalog.units.changeFactor')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          retireAction.clear();
                          setRetiring({ unit, key: randomUuid() });
                        }}
                      >
                        {t('catalog.units.retire')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ))}
        {history.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {t('catalog.units.history')}
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {history.map((unit) => (
                <li key={unit.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {t('catalog.units.factorOf', {
                      unit: unit.uomName,
                      factor: unit.factorToBase,
                      base: base?.uomName ?? '',
                    })}
                  </span>
                  <Badge variant="outline">
                    {unit.supersededBy === null
                      ? t('catalog.units.retired')
                      : t('catalog.units.superseded')}
                  </Badge>
                  <span className="text-muted-foreground">
                    {unit.supersededAt ? formatUbDateTime(Date.parse(unit.supersededAt)) : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>

      {adding && base ? (
        <AddUnitDialog product={product} base={base} onClose={() => setAdding(false)} />
      ) : null}
      {editing ? <EditUnitDialog unit={editing} onClose={() => setEditing(null)} /> : null}
      {superseding && base ? (
        <SupersedeDialog unit={superseding} base={base} onClose={() => setSuperseding(null)} />
      ) : null}
      <ConfirmDialog
        open={retiring !== null}
        title={t('catalog.units.retire')}
        description={t('catalog.units.retireConfirm', { unit: retiring?.unit.uomName ?? '' })}
        confirmLabel={t('catalog.units.retire')}
        pending={mutations.retireUnit.isPending}
        problem={retireAction.problem}
        onClose={() => setRetiring(null)}
        onConfirm={() => {
          if (!retiring) return;
          void retireAction
            .run(() =>
              mutations.retireUnit.mutateAsync({ id: retiring.unit.id, key: retiring.key }),
            )
            .then((ok) => (ok ? setRetiring(null) : undefined));
        }}
      />
    </Card>
  );
}

function AddUnitDialog(props: { product: ProductDetail; base: ProductUnit; onClose: () => void }) {
  const { t } = useTranslation();
  const uoms = useUoms();
  const mutations = useCatalogMutations();
  const action = useAction();
  const schema = useMemo(
    () =>
      z.object({
        uomId: z.string().min(1, 'validation.required'),
        factorToBase: factorField(props.base.fractional),
        isDefaultSales: z.boolean(),
        isDefaultPurchase: z.boolean(),
        measureUnit: z.string().trim().max(50, 'validation.tooLong'),
        barcodes: z.array(z.string()),
      }),
    [props.base.fractional],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      uomId: '',
      factorToBase: '',
      isDefaultSales: false,
      isDefaultPurchase: false,
      measureUnit: '',
      barcodes: [],
    },
  });
  const used = new Set(
    props.product.units.filter((unit) => unit.supersededAt === null).map((unit) => unit.uomId),
  );
  const existing = props.product.units.flatMap((unit) =>
    unit.barcodes.map((barcode) => barcodeKey(barcode.code)),
  );
  const submit = form.handleSubmit(async (values) => {
    const ok = await action.run(() =>
      mutations.addUnit.mutateAsync({
        productId: props.product.id,
        body: {
          uomId: Number.parseInt(values.uomId, 10),
          factorToBase: values.factorToBase,
          isDefaultSales: values.isDefaultSales,
          isDefaultPurchase: values.isDefaultPurchase,
          measureUnit: values.measureUnit || null,
          barcodes: values.barcodes,
        },
      }),
    );
    if (ok) props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('catalog.product.addUnit')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-uom">{t('catalog.product.unit')}</Label>
              <NativeSelect id="unit-uom" {...form.register('uomId')}>
                <option value="" />
                {(uoms.data ?? [])
                  .filter((uom) => !used.has(uom.id))
                  .map((uom) => (
                    <option key={uom.id} value={String(uom.id)}>
                      {uom.name}
                    </option>
                  ))}
              </NativeSelect>
              <FieldError message={errors.uomId?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit-factor">{t('catalog.product.factor')}</Label>
              <Input
                id="unit-factor"
                inputMode="decimal"
                autoComplete="off"
                {...form.register('factorToBase')}
              />
              <FieldError message={errors.factorToBase?.message} />
            </div>
          </div>
          <DefaultFlags
            prefix="unit"
            value={{
              isDefaultSales: form.watch('isDefaultSales'),
              isDefaultPurchase: form.watch('isDefaultPurchase'),
            }}
            onChange={(flag, checked) => form.setValue(flag, checked)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="unit-measure">{t('catalog.units.measureUnit')}</Label>
            <Input id="unit-measure" autoComplete="off" {...form.register('measureUnit')} />
            <FieldError message={errors.measureUnit?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="unit-barcodes">{t('catalog.product.unitBarcodes')}</Label>
            <Controller
              control={form.control}
              name="barcodes"
              render={({ field }) => (
                <BarcodeList
                  id="unit-barcodes"
                  label={t('catalog.product.unitBarcodes')}
                  value={field.value}
                  onChange={field.onChange}
                  isRepeated={(lookupKey) =>
                    existing.includes(lookupKey) ||
                    field.value.some((code) => barcodeKey(code) === lookupKey)
                  }
                />
              )}
            />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DefaultFlag = 'isDefaultSales' | 'isDefaultPurchase';
const DEFAULT_FLAGS: readonly DefaultFlag[] = ['isDefaultSales', 'isDefaultPurchase'];

/** Default-for-sales / default-for-purchases checkboxes; setting one moves it from another unit. */
function DefaultFlags(props: {
  prefix: string;
  value: Record<DefaultFlag, boolean>;
  onChange: (flag: DefaultFlag, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-4">
      {DEFAULT_FLAGS.map((flag) => (
        <div key={flag} className="flex items-center gap-2">
          <Checkbox
            id={`${props.prefix}-${flag}`}
            checked={props.value[flag]}
            onCheckedChange={(checked) => props.onChange(flag, checked === true)}
          />
          <Label htmlFor={`${props.prefix}-${flag}`} className="font-normal">
            {flag === 'isDefaultSales'
              ? t('catalog.product.defaultSales')
              : t('catalog.product.defaultPurchase')}
          </Label>
        </div>
      ))}
    </div>
  );
}

function EditUnitDialog({ unit, onClose }: { unit: ProductUnit; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const schema = z.object({
    isDefaultSales: z.boolean(),
    isDefaultPurchase: z.boolean(),
    measureUnit: z.string().trim().max(50, 'validation.tooLong'),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      isDefaultSales: unit.isDefaultSales,
      isDefaultPurchase: unit.isDefaultPurchase,
      measureUnit: unit.measureUnit ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const ok = await action.run(() =>
      mutations.updateUnit.mutateAsync({
        id: unit.id,
        body: {
          isDefaultSales: values.isDefaultSales,
          isDefaultPurchase: values.isDefaultPurchase,
          measureUnit: values.measureUnit || null,
        },
      }),
    );
    if (ok) onClose();
  });
  const { errors, isSubmitting } = form.formState;
  const fallback = unit.measureUnit === null ? unit.effectiveMeasureUnit : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('catalog.units.edit')}</DialogTitle>
          <DialogDescription>{unit.uomName}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <DefaultFlags
            prefix="edit-unit"
            value={{
              isDefaultSales: form.watch('isDefaultSales'),
              isDefaultPurchase: form.watch('isDefaultPurchase'),
            }}
            onChange={(flag, checked) => form.setValue(flag, checked)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-unit-measure">{t('catalog.units.measureUnit')}</Label>
            <Input id="edit-unit-measure" autoComplete="off" {...form.register('measureUnit')} />
            {fallback ? (
              <p className="text-xs text-muted-foreground">
                {t('catalog.units.measureUnitDefault', { value: fallback })}
              </p>
            ) : null}
            <FieldError message={errors.measureUnit?.message} />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A new factor for a unit: the API keeps the old row for history and moves barcodes and default
 * flags to a new one (ADR-0008 #2). One Idempotency-Key per dialog, resent on a retry.
 */
function SupersedeDialog(props: { unit: ProductUnit; base: ProductUnit; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const schema = useMemo(
    () => z.object({ factorToBase: factorField(props.base.fractional) }),
    [props.base.fractional],
  );
  const form = useForm<{ factorToBase: string }>({
    resolver: zodResolver(schema),
    defaultValues: { factorToBase: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    const ok = await action.run(() =>
      mutations.supersedeUnit.mutateAsync({
        id: props.unit.id,
        factorToBase: values.factorToBase,
        key,
      }),
    );
    if (ok) props.onClose();
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('catalog.units.changeFactor')}</DialogTitle>
          <DialogDescription>
            {t('catalog.units.factorOf', {
              unit: props.unit.uomName,
              factor: props.unit.factorToBase,
              base: props.base.uomName,
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('catalog.units.changeFactorHint')}</p>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="supersede-factor">{t('catalog.units.newFactor')}</Label>
            <Input
              id="supersede-factor"
              inputMode="decimal"
              autoComplete="off"
              {...form.register('factorToBase')}
            />
            <FieldError message={errors.factorToBase?.message} />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
