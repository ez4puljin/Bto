import { zodResolver } from '@hookform/resolvers/zod';
import { isExactFactor } from '@tugeel/shared/units';
import {
  ArrowRightLeft,
  Ban,
  Barcode,
  ChevronRight,
  Ellipsis,
  Pencil,
  Plus,
  ScanBarcode,
  Star,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatUbDateTime } from '@/lib/dayjs';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type ProductDetail, type ProductUnit, useCatalogMutations, useUoms } from './api';
import { BarcodeEntry, BarcodeList } from './barcode-entry';
import { barcodeKey } from './barcodes';
import { FACTOR } from './product-schema';

/** A barcode's small tags («Үндсэн», «Дотоод»), so a code and its tags share one line. */
const TAG = 'h-5 px-1.5 text-xs';

/** A barcode asked about before it is deleted, with the unit whose scan button gets the focus. */
interface BarcodeTarget {
  id: number;
  code: string;
  unitId: number;
}

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

/**
 * The units of a product with their barcodes (ADR-0008), one row per unit: the unit and its factor,
 * its barcodes (the primary and the internal one tagged), its default tags and, for managers, a
 * «Баркод нэмэх» button and a «⋯» menu (edit, change the factor, retire). Each row is a region
 * named by its unit. Superseded and retired units fold away below. A barcode is deleted only after
 * a question that names it (ADR-0066); the e-Barimt measure units live on the e-Barimt card.
 */
export function UnitsCard({ product, canManage }: { product: ProductDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const retireAction = useAction();
  const deleteAction = useAction();
  const [deleting, setDeleting] = useState<BarcodeTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProductUnit | null>(null);
  const [superseding, setSuperseding] = useState<ProductUnit | null>(null);
  const [scanning, setScanning] = useState<ProductUnit | null>(null);
  const [retiring, setRetiring] = useState<{ unit: ProductUnit; key: string } | null>(null);
  const current = product.units.filter((unit) => unit.supersededAt === null);
  const history = product.units.filter((unit) => unit.supersededAt !== null);
  const base = current.find((unit) => unit.isBase);
  const keys = current.flatMap((unit) => unit.barcodes.map((barcode) => barcodeKey(barcode.code)));
  const factorOf = (unit: ProductUnit) =>
    t('catalog.units.factorOf', {
      unit: unit.uomName,
      factor: unit.factorToBase,
      base: base?.uomName ?? '',
    });
  const columns = canManage
    ? 'sm:grid-cols-[9.5rem_minmax(0,1fr)_4.5rem]'
    : 'sm:grid-cols-[9.5rem_minmax(0,1fr)]';
  // A unit's dialogs open from its «⋯» menu or its scan button; the menu item is gone by the time
  // a dialog closes, so the focus is handed back to the button by hand.
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const keepTrigger = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) triggers.current.set(key, element);
    else triggers.current.delete(key);
  };
  const refocus = (key: string) => window.setTimeout(() => triggers.current.get(key)?.focus(), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.units.title')}</CardTitle>
        {canManage ? (
          <CardAction>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus />
              {t('catalog.product.addUnit')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        <div className="overflow-hidden rounded-xl border border-border/90">
          <div
            aria-hidden
            className={cn(
              'hidden gap-4 border-b border-border/80 bg-muted/60 px-3.5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:grid',
              columns,
            )}
          >
            <span>{t('catalog.units.columns.unit')}</span>
            <span>{t('catalog.units.columns.barcodes')}</span>
          </div>
          <div className="divide-y divide-border/80">
            {current.map((unit) => (
              <section
                key={unit.id}
                aria-label={unit.uomName}
                className={cn('relative grid gap-2 px-3.5 py-3 sm:items-start sm:gap-4', columns)}
              >
                <div className={cn('flex min-w-0 flex-col gap-0.5', canManage && 'pr-20 sm:pr-0')}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{unit.uomName}</span>
                    {unit.isBase ? (
                      <Badge variant="secondary">{t('catalog.units.base')}</Badge>
                    ) : null}
                  </div>
                  {unit.isBase ? null : (
                    <span className="text-[13px] text-muted-foreground">{factorOf(unit)}</span>
                  )}
                  {unit.isDefaultSales || unit.isDefaultPurchase ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {unit.isDefaultSales ? (
                        <Badge variant="outline">{t('catalog.units.defaultFor.sales')}</Badge>
                      ) : null}
                      {unit.isDefaultPurchase ? (
                        <Badge variant="outline">{t('catalog.units.defaultFor.purchase')}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0">
                  {unit.barcodes.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {unit.barcodes.map((barcode) => (
                        <li key={barcode.id} className="flex items-center gap-2">
                          <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[13px] tabular-nums">
                              {barcode.code}
                            </span>
                            {barcode.isPrimary ? (
                              <Badge variant="secondary" className={TAG}>
                                {t('catalog.units.primary')}
                              </Badge>
                            ) : null}
                            {barcode.isInternal ? (
                              <Badge variant="outline" className={TAG}>
                                {t('catalog.units.internal')}
                              </Badge>
                            ) : null}
                          </div>
                          {canManage ? (
                            <span className="-my-1 flex shrink-0 items-center gap-0.5">
                              {barcode.isPrimary ? (
                                <span aria-hidden className="inline-block size-8" />
                              ) : (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label={`${t('catalog.units.makePrimary')}: ${barcode.code}`}
                                  title={`${t('catalog.units.makePrimary')}: ${barcode.code}`}
                                  onClick={() =>
                                    void action.run(() =>
                                      mutations.primaryBarcode.mutateAsync(barcode.id),
                                    )
                                  }
                                >
                                  <Star />
                                </Button>
                              )}
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground hover:bg-danger-soft hover:text-destructive"
                                aria-label={`${t('catalog.units.deleteBarcode')}: ${barcode.code}`}
                                title={`${t('catalog.units.deleteBarcode')}: ${barcode.code}`}
                                onClick={() => {
                                  deleteAction.clear();
                                  setDeleting({
                                    id: barcode.id,
                                    code: barcode.code,
                                    unitId: unit.id,
                                  });
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted-foreground sm:pt-0.5">
                      {t('catalog.units.noBarcodes')}
                    </p>
                  )}
                </div>

                {canManage ? (
                  <div className="absolute top-2 right-2 flex items-center gap-0.5 sm:static sm:-my-1 sm:justify-end">
                    <Button
                      ref={keepTrigger(`scan-${unit.id}`)}
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('catalog.units.addBarcode')}
                      title={t('catalog.units.addBarcode')}
                      onClick={() => setScanning(unit)}
                    >
                      <ScanBarcode />
                    </Button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          ref={keepTrigger(`menu-${unit.id}`)}
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('catalog.units.menu', { unit: unit.uomName })}
                        >
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto min-w-48">
                        <DropdownMenuItem onSelect={() => setEditing(unit)}>
                          <Pencil />
                          {t('catalog.units.edit')}
                        </DropdownMenuItem>
                        {unit.isBase ? null : (
                          <>
                            <DropdownMenuItem onSelect={() => setSuperseding(unit)}>
                              <ArrowRightLeft />
                              {t('catalog.units.changeFactor')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                retireAction.clear();
                                setRetiring({ unit, key: randomUuid() });
                              }}
                            >
                              <Ban />
                              {t('catalog.units.retire')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>

        {history.length > 0 ? (
          <details className="group rounded-xl border border-border/90 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[13px] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3.5 transition-transform group-open:rotate-90"
              />
              {t('catalog.units.history')}
              <span className="ml-auto tabular-nums">{history.length}</span>
            </summary>
            <ul className="divide-y divide-border/80 border-t border-border/80">
              {history.map((unit) => (
                <li key={unit.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2">
                  <span>{factorOf(unit)}</span>
                  <Badge variant="secondary">
                    {unit.supersededBy === null
                      ? t('catalog.units.retired')
                      : t('catalog.units.superseded')}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
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
      {editing ? (
        <EditUnitDialog
          unit={editing}
          onClose={() => {
            setEditing(null);
            refocus(`menu-${editing.id}`);
          }}
        />
      ) : null}
      {superseding && base ? (
        <SupersedeDialog
          unit={superseding}
          base={base}
          onClose={() => {
            setSuperseding(null);
            refocus(`menu-${superseding.id}`);
          }}
        />
      ) : null}
      {scanning ? (
        <BarcodeDialog
          unit={scanning}
          description={scanning.isBase ? scanning.uomName : factorOf(scanning)}
          keys={keys}
          onClose={() => {
            setScanning(null);
            refocus(`scan-${scanning.id}`);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t('catalog.units.deleteBarcodeTitle', { code: deleting?.code ?? '' })}
        description={t('catalog.units.deleteBarcodeHint')}
        confirmLabel={t('common.delete')}
        pending={mutations.deleteBarcode.isPending}
        problem={deleteAction.problem}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          void deleteAction
            .run(() => mutations.deleteBarcode.mutateAsync(target.id))
            .then((ok) => {
              if (!ok) return;
              setDeleting(null);
              toast.success(t('catalog.units.barcodeDeleted'));
              // The deleted code's buttons are gone once the dialog has faded out: the unit's
              // «Баркод нэмэх» takes the focus the page would otherwise lose.
              window.setTimeout(() => {
                if (document.activeElement === document.body) {
                  triggers.current.get(`scan-${target.unitId}`)?.focus();
                }
              }, 250);
            });
        }}
      />
      {retiring ? (
        <ConfirmDialog
          open
          title={t('catalog.units.retire')}
          description={t('catalog.units.retireConfirm', { unit: retiring.unit.uomName })}
          confirmLabel={t('catalog.units.retire')}
          pending={mutations.retireUnit.isPending}
          problem={retireAction.problem}
          onClose={() => {
            setRetiring(null);
            refocus(`menu-${retiring.unit.id}`);
          }}
          onConfirm={() => {
            void retireAction
              .run(() =>
                mutations.retireUnit.mutateAsync({ id: retiring.unit.id, key: retiring.key }),
              )
              .then((ok) => (ok ? setRetiring(null) : undefined));
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Adds a scanned or typed barcode to a unit or, while the unit has none, issues an internal one
 * (one Idempotency-Key per dialog, resent on a retry). The dialog closes after either.
 */
function BarcodeDialog(props: {
  unit: ProductUnit;
  description: string;
  /** Lookup keys of the product's barcodes (`barcodeKey`). */
  keys: readonly (string | null)[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useCatalogMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const hasInternal = props.unit.barcodes.some((barcode) => barcode.isInternal);
  const added = () => {
    toast.success(t('catalog.units.barcodeAdded'));
    props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('catalog.units.addBarcode')}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <BarcodeEntry
          id={`unit-${props.unit.id}-barcode`}
          label={t('catalog.units.addBarcode')}
          isRepeated={(lookupKey) => props.keys.includes(lookupKey)}
          onAdd={async (code) => {
            const ok = await action.run(() =>
              mutations.addBarcode.mutateAsync({ unitId: props.unit.id, code }),
            );
            if (ok) added();
            return ok;
          }}
        />
        {hasInternal ? null : (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('catalog.units.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="outline"
              disabled={mutations.internalBarcode.isPending}
              onClick={() =>
                void action
                  .run(() => mutations.internalBarcode.mutateAsync({ unitId: props.unit.id, key }))
                  .then((ok) => (ok ? added() : undefined))
              }
            >
              <Barcode />
              {t('catalog.units.generateInternal')}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
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
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{t('catalog.product.addUnit')}</DialogTitle>
          <DialogDescription>{props.product.name}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t('catalog.product.unit')}
              htmlFor="unit-uom"
              error={errors.uomId?.message}
            >
              <NativeSelect id="unit-uom" {...form.register('uomId')}>
                <option value="">{t('catalog.product.chooseUnit')}</option>
                {(uoms.data ?? [])
                  .filter((uom) => !used.has(uom.id))
                  .map((uom) => (
                    <option key={uom.id} value={String(uom.id)}>
                      {uom.name}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t('catalog.product.factor')}
              htmlFor="unit-factor"
              error={errors.factorToBase?.message}
            >
              <Input
                id="unit-factor"
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
                {...form.register('factorToBase')}
              />
            </FormField>
          </div>
          <DefaultFlags
            prefix="unit"
            value={{
              isDefaultSales: form.watch('isDefaultSales'),
              isDefaultPurchase: form.watch('isDefaultPurchase'),
            }}
            onChange={(flag, checked) => form.setValue(flag, checked)}
          />
          <FormField
            label={t('catalog.units.measureUnit')}
            htmlFor="unit-measure"
            error={errors.measureUnit?.message}
          >
            <Input id="unit-measure" autoComplete="off" {...form.register('measureUnit')} />
          </FormField>
          <FormField label={t('catalog.product.unitBarcodes')} htmlFor="unit-barcodes">
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
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DefaultFlag = 'isDefaultSales' | 'isDefaultPurchase';
const DEFAULT_FLAGS: readonly DefaultFlag[] = ['isDefaultSales', 'isDefaultPurchase'];

/** Default-for-sales / default-for-purchases switches; setting one moves it from another unit. */
function DefaultFlags(props: {
  prefix: string;
  value: Record<DefaultFlag, boolean>;
  onChange: (flag: DefaultFlag, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/90">
      {DEFAULT_FLAGS.map((flag) => (
        <div key={flag} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <Label htmlFor={`${props.prefix}-${flag}`} className="font-normal">
            {flag === 'isDefaultSales'
              ? t('catalog.product.defaultSales')
              : t('catalog.product.defaultPurchase')}
          </Label>
          <Switch
            id={`${props.prefix}-${flag}`}
            checked={props.value[flag]}
            onCheckedChange={(checked) => props.onChange(flag, checked)}
          />
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
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <DefaultFlags
            prefix="edit-unit"
            value={{
              isDefaultSales: form.watch('isDefaultSales'),
              isDefaultPurchase: form.watch('isDefaultPurchase'),
            }}
            onChange={(flag, checked) => form.setValue(flag, checked)}
          />
          <FormField
            label={t('catalog.units.measureUnit')}
            htmlFor="edit-unit-measure"
            hint={fallback ? t('catalog.units.measureUnitDefault', { value: fallback }) : undefined}
            error={errors.measureUnit?.message}
          >
            <Input id="edit-unit-measure" autoComplete="off" {...form.register('measureUnit')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
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
        <ProblemAlert problem={action.problem} />
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <FormField
            label={t('catalog.units.newFactor')}
            htmlFor="supersede-factor"
            hint={t('catalog.units.changeFactorHint')}
            error={errors.factorToBase?.message}
          >
            <Input
              id="supersede-factor"
              inputMode="decimal"
              autoComplete="off"
              className="font-mono"
              {...form.register('factorToBase')}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
