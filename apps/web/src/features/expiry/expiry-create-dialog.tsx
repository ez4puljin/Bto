import { zodResolver } from '@hookform/resolvers/zod';
import type { ProblemDetails } from '@tugeel/api-client';
import { EXPIRY_NOTE_MAX, expiryUrgency, isExpiryDateInRange } from '@tugeel/shared/expiry';
import { daysBetween } from '@tugeel/shared/finance';
import { addMonths, isIsoDate } from '@tugeel/shared/time';
import { X } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
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

/** «Хадгалах» closes the dialog, «Хадгалаад шинэ» keeps it for the next product on the shelf. */
type SaveMode = 'close' | 'next';

const DATE_FIELD = 'expiry-new-date';

/**
 * A new record on `?new=1` (ADR-0172 #2, #5): scan or find the product, see what is already open on
 * it, type the date and the two counts. One `Idempotency-Key` per dialog until a save succeeds; a
 * refused repeat of an open product and date offers that record or a new one anyway.
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
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [duplicate, setDuplicate] = useState<{ itemId: number; mode: SaveMode } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /** A new product on the shelf: the scan box mounts again and takes the cursor. */
  const [round, setRound] = useState(0);
  const open = useProductOpenExpiry(product?.id ?? null);
  const resolver = useMemo(() => zodResolver(createSchema(today)), [today]);
  const form = useForm<CreateValues>({ resolver, defaultValues: EMPTY });
  const {
    formState: { errors, isDirty },
  } = form;
  const date = form.watch('expiryDate');
  const days = today && isIsoDate(date) ? daysBetween(today, date) : null;

  const pick = (next: ProductSummary) => {
    setProduct(next);
    setDuplicate(null);
    setProblem(null);
    setAdded(null);
    // After the search box has taken its cursor back: the date is what comes next.
    window.setTimeout(() => document.getElementById(DATE_FIELD)?.focus(), 0);
  };
  const scan = (code: string) => {
    setProblem(null);
    lookup.mutate(code, {
      onSuccess: (found) => pick(found.product),
      onError: (error) => setProblem(problemFromError(error)),
    });
  };
  // A scan that lands in a quantity is the next product, never a quantity (docs/ui.md).
  const guard = useScanGuard(scan);
  const guarded =
    (field: 'qtyFloor' | 'qtyWarehouse') => (event: KeyboardEvent<HTMLInputElement>) =>
      guard(event, form.getValues(field), (value) => form.setValue(field, value));

  const post = async (values: CreateValues, mode: SaveMode, allowDuplicate: boolean) => {
    if (!product) return;
    setProblem(null);
    setDuplicate(null);
    try {
      const created = await mutations.create.mutateAsync({
        key,
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
        props.onClose();
        return;
      }
      setKey(randomUuid());
      setProduct(null);
      setAdded(t('expiry.new.added', { name: created.product.name }));
      setRound((value) => value + 1);
      form.reset(EMPTY);
    } catch (error) {
      const refused = problemFromError(error);
      const itemId = refused?.params?.itemId;
      if (refused?.code === 'EXPIRY_ITEM_EXISTS' && typeof itemId === 'number') {
        setDuplicate({ itemId, mode });
      } else {
        setProblem(refused);
      }
    }
  };
  const save = (mode: SaveMode, allowDuplicate = false) =>
    form.handleSubmit((values) => post(values, mode, allowDuplicate))();

  const openRows = open.data?.data ?? [];
  return (
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
                onPick={pick}
                onScan={scan}
                pickLabel={t('expiry.new.pick')}
              />
            </div>
          </FormField>
          {product ? (
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
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('expiry.new.changeProduct')}
                  title={t('expiry.new.changeProduct')}
                  onClick={() => {
                    setProduct(null);
                    setDuplicate(null);
                  }}
                >
                  <X />
                </Button>
              </div>
              {open.isPending ? null : openRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('expiry.new.noOpen')}</p>
              ) : (
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
                  >
                    {t('expiry.new.openRecord')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    pending={mutations.create.isPending}
                    onClick={() => void save(duplicate.mode, true)}
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
                    {...(today ? { min: addMonths(today, -60), max: addMonths(today, 180) } : {})}
                  />
                )}
              />
            </FormField>
            <FormField
              label={t('expiry.columns.qtyFloor')}
              htmlFor="expiry-new-floor"
              error={errors.qtyFloor?.message}
            >
              <Input
                id="expiry-new-floor"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className="text-right font-mono"
                onKeyDown={guarded('qtyFloor')}
                {...form.register('qtyFloor')}
              />
            </FormField>
            <FormField
              label={t('expiry.columns.qtyWarehouse')}
              htmlFor="expiry-new-warehouse"
              error={errors.qtyWarehouse?.message}
            >
              <Input
                id="expiry-new-warehouse"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className="text-right font-mono"
                onKeyDown={guarded('qtyWarehouse')}
                {...form.register('qtyWarehouse')}
              />
            </FormField>
          </div>
          <FormField
            label={t('expiry.new.note')}
            htmlFor="expiry-new-note"
            error={errors.note?.message}
          >
            <Textarea
              id="expiry-new-note"
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
  );
}
