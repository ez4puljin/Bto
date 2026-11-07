import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import {
  EXPIRY_NOTE_MAX,
  expiryDateBounds,
  expiryUrgency,
  isExpiryDateInRange,
} from '@tugeel/shared/expiry';
import { daysBetween } from '@tugeel/shared/finance';
import { isIsoDate } from '@tugeel/shared/time';
import { X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, type FieldErrors, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ProductSummary, useBarcodeLookup } from '@/features/catalog/api';
import { ProductSearch } from '@/features/inventory/shared';
import { parseDateText } from '@/lib/calendar';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { randomUuid } from '@/lib/uuid';
import { useExpiryMutations, useProductOpenExpiry } from './api';
import { daysText, isQty, isZeroQty, plainQty } from './helpers';
import { DaysLeft, ExpiryStatusBadge } from './parts';

const qtyField = z.string().refine(isQty, 'validation.expiryQty');

/** `today` is the server's; until the summary arrives only the server checks the range. */
function createSchema(today: string | undefined) {
  return z
    .object({
      expiryDate: z
        .string()
        .refine(isIsoDate, 'validation.date')
        .refine(
          (value) => !today || !isIsoDate(value) || isExpiryDateInRange(value, today),
          'validation.expiryDateRange',
        ),
      qtyFloor: qtyField,
      qtyWarehouse: qtyField,
      note: z.string().max(EXPIRY_NOTE_MAX, 'validation.tooLong'),
    })
    .superRefine((values, context) => {
      if (
        isQty(values.qtyFloor) &&
        isQty(values.qtyWarehouse) &&
        isZeroQty(values.qtyFloor) &&
        isZeroQty(values.qtyWarehouse)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['qtyFloor'],
          message: 'validation.expiryQtyPositive',
        });
      }
    });
}

type CreateValues = z.infer<ReturnType<typeof createSchema>>;

const EMPTY: CreateValues = { expiryDate: '', qtyFloor: '', qtyWarehouse: '', note: '' };

const isBlank = (values: CreateValues) =>
  Object.values(values).every((value) => value.trim() === '');

/** «Хадгалах» closes the dialog, «Хадгалаад шинэ» keeps it for the next product on the shelf. */
type SaveMode = 'close' | 'next';

/** The product the form is for. */
interface Chosen {
  product: ProductSummary;
  /** When a box's barcode was read: «1 хайрцаг = 24 ш», since the counts are in the base unit. */
  pack: { unit: string; n: string } | null;
}

function chosenFromBarcode(found: {
  product: ProductSummary;
  unit: { uomName: string; factorToBase: string; isBase: boolean };
}): Chosen {
  return {
    product: found.product,
    pack: found.unit.isBase
      ? null
      : { unit: found.unit.uomName, n: formatQty(found.unit.factorToBase) },
  };
}

const DATE_FIELD = 'expiry-new-date';
const FLOOR_FIELD = 'expiry-new-floor';
const WAREHOUSE_FIELD = 'expiry-new-warehouse';
const NOTE_FIELD = 'expiry-new-note';

/** The fields where a scan does not belong, in the form's order; the two product boxes read scans. */
const SCAN_GUARDED = new Map<string, keyof CreateValues>([
  [DATE_FIELD, 'expiryDate'],
  [FLOOR_FIELD, 'qtyFloor'],
  [WAREHOUSE_FIELD, 'qtyWarehouse'],
  [NOTE_FIELD, 'note'],
]);

/** After whatever is closing has given the focus back: the cursor goes here, its text selected. */
const focusField = (id: string) =>
  window.setTimeout(() => {
    const box = document.getElementById(id);
    if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) {
      box.focus();
      box.select();
    }
  }, 0);

/** The date box holds no ref for the form to focus, so a refused save does it for every field. */
const focusFirstError = (failed: FieldErrors<CreateValues>) => {
  for (const [id, field] of SCAN_GUARDED) {
    if (failed[field]) {
      focusField(id);
      return;
    }
  }
};

/**
 * A new record on `?new=1` (ADR-0172 #2, #5): scan or find the product, see what is already open on
 * it, type the date and the two counts. One `Idempotency-Key` per record until a save succeeds; a
 * refused repeat of an open product and date offers that record or a new one anyway. A key the
 * server saw with another body means an earlier save did land although its answer never came: that
 * is said, and only the person's choice adds another, under a new key. What was typed for one
 * product is never carried to the next: moving on asks when something is typed. The dialog's own
 * exits ask through `DialogContent`; `onDirty` tells the page's guard, which asks before Back, the
 * palette and a reload, all of which the dialog never hears of.
 */
export function ExpiryCreateDialog(props: {
  today: string | undefined;
  recordHref: (id: number) => string;
  onOpenRecord: (id: number) => void;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { today, onDirty } = props;
  const mutations = useExpiryMutations();
  const lookup = useBarcodeLookup();
  const [key, setKey] = useState(randomUuid);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  /** The next product while the question about what is typed for this one is open. */
  const [held, setHeld] = useState<Chosen | null>(null);
  /** The question was answered by dropping what was typed: the cursor is on its way to the date. */
  const movingOn = useRef(false);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [duplicate, setDuplicate] = useState<{
    itemId: number;
    mode: SaveMode;
    then: Chosen | null;
  } | null>(null);
  /** The save the server refused because an earlier one landed: only a choice repeats it. */
  const [landed, setLanded] = useState<{ mode: SaveMode; then: Chosen | null } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /** A new product on the shelf: the scan box mounts again and takes the cursor. */
  const [round, setRound] = useState(0);
  const product = chosen?.product ?? null;
  const open = useProductOpenExpiry(product?.id ?? null);
  const resolver = useMemo(() => zodResolver(createSchema(today)), [today]);
  const form = useForm<CreateValues>({
    resolver,
    defaultValues: EMPTY,
    shouldFocusError: false,
  });
  const {
    formState: { errors, isDirty },
  } = form;
  const date = form.watch('expiryDate');
  const days = today && isIsoDate(date) ? daysBetween(today, date) : null;

  useEffect(() => {
    onDirty(isDirty);
    return () => onDirty(false);
  }, [isDirty, onDirty]);
  /** What is typed was saved or the person was asked, so the page's guard must not ask again. */
  const clearDirty = () => onDirty(false);
  const close = () => {
    clearDirty();
    props.onClose();
  };

  /** Another product is another record, under a key of its own; the date is what comes next. */
  const goOn = (next: Chosen) => {
    setChosen(next);
    setKey(randomUuid());
    setDuplicate(null);
    setLanded(null);
    setProblem(null);
    focusField(DATE_FIELD);
  };
  const pick = (next: Chosen) => {
    setAdded(null);
    const blank = isBlank(form.getValues());
    if (product?.id === next.product.id) {
      // The same product again: only what was read of it changes (a box after a piece).
      setChosen(next);
      if (blank) focusField(DATE_FIELD);
      return;
    }
    if (product && !blank) {
      setHeld(next);
      return;
    }
    // With no product chosen, what is typed is meant for this one («Бараа цэвэрлэх» keeps it).
    if (product) form.reset(EMPTY);
    goOn(next);
  };
  const scan = (code: string) => {
    setProblem(null);
    lookup.mutate(code, {
      onSuccess: (found) => pick(chosenFromBarcode(found)),
      onError: (error) => setProblem(problemFromError(error)),
    });
  };
  /**
   * What a field holds as a burst starts: a short date («2026.12.1») is still only the box's text,
   * and it goes out on leaving the box.
   */
  const valueAtBurst = (field: keyof CreateValues, box: EventTarget) => {
    const value = form.getValues(field);
    if (field !== 'expiryDate' || !(box instanceof HTMLInputElement)) return value;
    return parseDateText(box.value) ?? value;
  };
  /**
   * The field gets back what it held, and the error the burst's digits earned goes with them. After
   * a save every change is checked, but an empty field is no mistake until the next save.
   */
  const restoreField = (field: keyof CreateValues, value: string) => {
    form.clearErrors(field);
    form.setValue(field, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted && value.trim() !== '',
    });
    if (field !== 'expiryDate') return;
    const box = document.getElementById(DATE_FIELD);
    box?.blur();
    box?.focus();
  };
  // A scan that lands in a field is the next product, never a count, a date or a note (docs/ui.md).
  const guard = useScanGuard(scan);
  const guardFields = (event: KeyboardEvent<HTMLElement>) => {
    const field = event.target instanceof HTMLElement && SCAN_GUARDED.get(event.target.id);
    if (field) {
      guard(event, valueAtBurst(field, event.target), (value) => restoreField(field, value));
    }
  };

  const post = async (
    values: CreateValues,
    mode: SaveMode,
    allowDuplicate: boolean,
    then: Chosen | null,
    postKey: string,
  ) => {
    if (!product) return;
    setKey(postKey);
    setProblem(null);
    setDuplicate(null);
    setLanded(null);
    try {
      const created = await mutations.create.mutateAsync({
        key: postKey,
        body: {
          productId: product.id,
          expiryDate: values.expiryDate,
          qtyFloor: plainQty(values.qtyFloor),
          qtyWarehouse: plainQty(values.qtyWarehouse),
          ...(values.note.trim() ? { note: values.note.trim() } : {}),
          ...(allowDuplicate ? { allowDuplicate: true } : {}),
        },
      });
      if (mode === 'close') {
        toast.success(t('expiry.new.createdToast'));
        close();
        return;
      }
      setAdded(t('expiry.new.added', { name: created.product.name }));
      setHeld(null);
      form.reset(EMPTY);
      if (then) {
        goOn(then);
        return;
      }
      setKey(randomUuid());
      setChosen(null);
      setRound((value) => value + 1);
    } catch (error) {
      const refused = problemFromError(error);
      const itemId = refused?.params?.itemId;
      if (refused?.code === 'EXPIRY_ITEM_EXISTS' && typeof itemId === 'number') {
        setDuplicate({ itemId, mode, then });
      } else if (refused?.code === 'IDEMPOTENCY_KEY_REUSED') {
        // The key stays: a repeat of what landed is answered with that record, a changed form is
        // refused again, and neither adds a second record nobody asked for.
        mutations.refresh();
        setLanded({ mode, then });
      } else {
        setProblem(refused);
      }
    }
  };
  /**
   * `then`: the product to go on to once this one is in; a refused form stays where it is. `postKey`:
   * another key than this record's, which it becomes once a post goes out under it.
   */
  const save = (
    mode: SaveMode,
    allowDuplicate = false,
    then: Chosen | null = null,
    postKey = key,
  ) =>
    form.handleSubmit(
      (values) => post(values, mode, allowDuplicate, then, postKey),
      focusFirstError,
    )();

  const unit = product?.baseUnit.uomName;
  const openRows = open.data?.data ?? [];
  // A record's link asks only when something is typed: a product alone is no work to lose.
  const exit = isDirty ? { 'data-dialog-exit': '' } : {};
  return (
    <>
      <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent size="lg" closeLabel={t('common.close')} dirty={isDirty || product !== null}>
          <DialogHeader>
            <DialogTitle>{t('expiry.new.title')}</DialogTitle>
            <DialogDescription>{t('expiry.new.description')}</DialogDescription>
          </DialogHeader>
          <p role="status" className="text-[0.8125rem] font-medium text-success empty:hidden">
            {added}
          </p>
          <ProblemAlert problem={problem} />
          <form
            className="flex flex-col gap-4"
            noValidate
            onKeyDownCapture={guardFields}
            onSubmit={(event) => {
              event.preventDefault();
              void save('close');
            }}
          >
            <FormField label={t('expiry.new.product')} htmlFor="expiry-new-search">
              <div className="grid gap-2 sm:grid-cols-2">
                <ScanBox key={round} compact autoFocus onScan={scan} />
                <ProductSearch
                  id="expiry-new-search"
                  className="max-w-none"
                  anyStatus
                  onPick={(next) => pick({ product: next, pack: null })}
                  onScan={scan}
                  pickLabel={t('expiry.new.pick')}
                />
              </div>
            </FormField>
            {chosen && product ? (
              <section
                aria-label={product.name}
                className="flex flex-col gap-2 rounded-lg bg-accent px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{product.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {product.sku} · {product.baseUnit.uomName}
                    </p>
                    {chosen.pack ? (
                      <p className="mt-1 w-fit rounded-md bg-warning-soft px-2 py-0.5 text-[0.8125rem] font-medium text-warning">
                        {t('expiry.new.pack', {
                          unit: chosen.pack.unit,
                          n: chosen.pack.n,
                          base: product.baseUnit.uomName,
                        })}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('expiry.new.changeProduct')}
                    title={t('expiry.new.changeProduct')}
                    onClick={() => {
                      setChosen(null);
                      setDuplicate(null);
                      setLanded(null);
                    }}
                  >
                    <X />
                  </Button>
                </div>
                {open.isPending ? null : openRows.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('expiry.new.openTitle')}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {openRows.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-center gap-2 text-[0.8125rem]"
                        >
                          <Link
                            to={props.recordHref(row.id)}
                            replace
                            className="text-link underline-offset-4 hover:underline"
                            onClick={clearDirty}
                            {...exit}
                          >
                            {t('expiry.new.openRow', {
                              date: row.expiryDate,
                              days: daysText(t, row.daysLeft),
                              qty: formatQty(row.qtyTotal),
                              unit: row.product.baseUomName,
                            })}
                          </Link>
                          <ExpiryStatusBadge status={row.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : open.isError ? (
                  <ProblemAlert problem={problemFromError(open.error)} onRetry={open.refetch} />
                ) : (
                  <p className="text-xs text-muted-foreground">{t('expiry.new.noOpen')}</p>
                )}
              </section>
            ) : null}
            {duplicate ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {t('errors.EXPIRY_ITEM_EXISTS')}
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        clearDirty();
                        props.onOpenRecord(duplicate.itemId);
                      }}
                      {...exit}
                    >
                      {t('expiry.new.openRecord')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      pending={mutations.create.isPending}
                      onClick={() => void save(duplicate.mode, true, duplicate.then)}
                    >
                      {t('expiry.new.addAnyway')}
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
            {landed ? (
              <Alert>
                <AlertDescription>
                  {t('expiry.new.landed')}
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      pending={mutations.create.isPending}
                      onClick={() => void save(landed.mode, false, landed.then, randomUuid())}
                    >
                      {t('expiry.new.addAnyway')}
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label={t('expiry.columns.expiryDate')}
                htmlFor={DATE_FIELD}
                error={errors.expiryDate?.message}
                hint={
                  days === null ? undefined : (
                    <DaysLeft daysLeft={days} urgency={expiryUrgency(days)} />
                  )
                }
              >
                <Controller
                  control={form.control}
                  name="expiryDate"
                  render={({ field }) => (
                    <DateInput
                      id={DATE_FIELD}
                      value={field.value}
                      onChange={(value) => {
                        setDuplicate(null);
                        field.onChange(value);
                      }}
                      onBlur={field.onBlur}
                      {...(today ? expiryDateBounds(today) : {})}
                    />
                  )}
                />
              </FormField>
              <FormField
                label={unit ? t('expiry.fields.floor', { unit }) : t('expiry.columns.qtyFloor')}
                htmlFor={FLOOR_FIELD}
                error={errors.qtyFloor?.message}
              >
                <Input
                  id={FLOOR_FIELD}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className="text-right font-mono"
                  {...form.register('qtyFloor')}
                />
              </FormField>
              <FormField
                label={
                  unit ? t('expiry.fields.warehouse', { unit }) : t('expiry.columns.qtyWarehouse')
                }
                htmlFor={WAREHOUSE_FIELD}
                error={errors.qtyWarehouse?.message}
              >
                <Input
                  id={WAREHOUSE_FIELD}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className="text-right font-mono"
                  {...form.register('qtyWarehouse')}
                />
              </FormField>
            </div>
            <FormField
              label={t('expiry.new.note')}
              htmlFor={NOTE_FIELD}
              error={errors.note?.message}
            >
              <Textarea
                id={NOTE_FIELD}
                rows={2}
                placeholder={t('expiry.new.notePlaceholder')}
                {...form.register('note')}
              />
            </FormField>
            <DialogFormFooter
              pending={mutations.create.isPending}
              disabled={product === null}
              onCancel={close}
              onSaveAndNew={() => void save('next')}
            />
          </form>
        </DialogContent>
      </Dialog>
      {held ? (
        <ConfirmDialog
          open
          variant="default"
          // A scan opens it, and the tail of the next scan must not press the main button
          // (ADR-0047 #4): the focus starts on «Болих».
          initialFocus="first"
          title={t('expiry.new.heldTitle', { name: product?.name ?? '' })}
          description={t('expiry.new.heldDescription', { name: held.product.name })}
          confirmLabel={t('expiry.new.heldSave')}
          alternative={{
            label: t('expiry.new.heldDrop'),
            onClick: () => {
              movingOn.current = true;
              setHeld(null);
              form.reset(EMPTY);
              goOn(held);
            },
          }}
          // The focus goes back to the field it left: a refused save stays there, one that goes
          // through moves on to the date.
          onConfirm={() => {
            setHeld(null);
            void save('next', false, held);
          }}
          onClose={() => setHeld(null)}
          onCloseAutoFocus={(event) => {
            if (movingOn.current) event.preventDefault();
            movingOn.current = false;
            // Opened by the camera's read: what had the focus went with the camera's dialog.
            window.setTimeout(() => {
              if (document.activeElement === document.body) focusField(DATE_FIELD);
            }, 0);
          }}
        />
      ) : null}
    </>
  );
}
