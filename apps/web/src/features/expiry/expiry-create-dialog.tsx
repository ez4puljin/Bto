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
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { randomUuid } from '@/lib/uuid';
import { type ExpiryCreateBody, useExpiryMutations, useProductOpenExpiry } from './api';
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

/** The fields where a scan does not belong; the two product boxes read scans themselves. */
const SCAN_GUARDED = new Map<string, keyof CreateValues>([
  [DATE_FIELD, 'expiryDate'],
  [FLOOR_FIELD, 'qtyFloor'],
  [WAREHOUSE_FIELD, 'qtyWarehouse'],
  [NOTE_FIELD, 'note'],
]);

/**
 * A new record on `?new=1` (ADR-0172 #2, #5): scan or find the product, see what is already open on
 * it, type the date and the two counts. One `Idempotency-Key` per record until a save succeeds; a
 * refused repeat of an open product and date offers that record or a new one anyway. What was typed
 * for one product is never carried to the next: moving on asks when something is typed.
 */
export function ExpiryCreateDialog(props: {
  today: string | undefined;
  recordHref: (id: number) => string;
  onOpenRecord: (id: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { today } = props;
  const mutations = useExpiryMutations();
  const lookup = useBarcodeLookup();
  const [key, setKey] = useState(randomUuid);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  /** The next product while the question about what is typed for this one is open. */
  const [held, setHeld] = useState<Chosen | null>(null);
  /** The question was answered with moving on, so the focus does not go back where it was. */
  const movingOn = useRef(false);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [duplicate, setDuplicate] = useState<{
    itemId: number;
    mode: SaveMode;
    then: Chosen | null;
  } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /** A new product on the shelf: the scan box mounts again and takes the cursor. */
  const [round, setRound] = useState(0);
  const product = chosen?.product ?? null;
  const open = useProductOpenExpiry(product?.id ?? null);
  const resolver = useMemo(() => zodResolver(createSchema(today)), [today]);
  const form = useForm<CreateValues>({ resolver, defaultValues: EMPTY });
  const {
    formState: { errors, isDirty },
  } = form;
  const date = form.watch('expiryDate');
  const days = today && isIsoDate(date) ? daysBetween(today, date) : null;

  /** After the search box has taken its cursor back: the date is what comes next. */
  const focusDate = () =>
    window.setTimeout(() => {
      const box = document.getElementById(DATE_FIELD);
      if (box instanceof HTMLInputElement) {
        box.focus();
        box.select();
      }
    }, 0);
  /** Another product is another record, under a key of its own. */
  const goOn = (next: Chosen) => {
    setChosen(next);
    setKey(randomUuid());
    setDuplicate(null);
    setProblem(null);
    focusDate();
  };
  const pick = (next: Chosen) => {
    setAdded(null);
    const blank = isBlank(form.getValues());
    if (product?.id === next.product.id) {
      // The same product again: only what was read of it changes (a box after a piece).
      setChosen(next);
      if (blank) focusDate();
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
  /** The field gets back what it held; the date box's own draft only goes on leaving the box. */
  const restoreField = (field: keyof CreateValues, value: string) => {
    form.setValue(field, value, { shouldDirty: true });
    if (field !== 'expiryDate') return;
    const box = document.getElementById(DATE_FIELD);
    box?.blur();
    box?.focus();
  };
  // A scan that lands in a field is the next product, never a count, a date or a note (docs/ui.md).
  const guard = useScanGuard(scan);
  const guardFields = (event: KeyboardEvent<HTMLElement>) => {
    const field = event.target instanceof HTMLElement && SCAN_GUARDED.get(event.target.id);
    if (field) guard(event, form.getValues(field), (value) => restoreField(field, value));
  };

  /**
   * A key the server says it saw with another body means an earlier save did land although its
   * answer never came, and the person has changed something since: that needs a key of its own, and
   * the server then tells of the record it already holds.
   */
  const send = async (body: ExpiryCreateBody) => {
    try {
      return await mutations.create.mutateAsync({ key, body });
    } catch (error) {
      if (problemFromError(error)?.code !== 'IDEMPOTENCY_KEY_REUSED') throw error;
      const fresh = randomUuid();
      setKey(fresh);
      return await mutations.create.mutateAsync({ key: fresh, body });
    }
  };
  const post = async (
    values: CreateValues,
    mode: SaveMode,
    allowDuplicate: boolean,
    then: Chosen | null,
  ) => {
    if (!product) return;
    setProblem(null);
    setDuplicate(null);
    try {
      const created = await send({
        productId: product.id,
        expiryDate: values.expiryDate,
        qtyFloor: plainQty(values.qtyFloor),
        qtyWarehouse: plainQty(values.qtyWarehouse),
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      });
      if (mode === 'close') {
        toast.success(t('expiry.new.createdToast'));
        props.onClose();
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
      } else {
        setProblem(refused);
      }
    }
  };
  /** `then`: the product to go on to once this one is in; a refused form stays where it is. */
  const save = (mode: SaveMode, allowDuplicate = false, then: Chosen | null = null) =>
    form.handleSubmit((values) => post(values, mode, allowDuplicate, then))();

  const unit = product?.baseUnit.uomName;
  const openRows = open.data?.data ?? [];
  // A record's link asks only when something is typed: a product alone is no work to lose.
  const exit = isDirty ? { 'data-dialog-exit': '' } : {};
  return (
    <>
      <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
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
                      onClick={() => props.onOpenRecord(duplicate.itemId)}
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
              onCancel={props.onClose}
              onSaveAndNew={() => void save('next')}
            />
          </form>
        </DialogContent>
      </Dialog>
      {held ? (
        <ConfirmDialog
          open
          variant="default"
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
          onConfirm={() => {
            movingOn.current = true;
            setHeld(null);
            void save('next', false, held);
          }}
          onClose={() => setHeld(null)}
          onCloseAutoFocus={(event) => {
            if (movingOn.current) event.preventDefault();
            movingOn.current = false;
          }}
        />
      ) : null}
    </>
  );
}
