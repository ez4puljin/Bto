import { zodResolver } from '@hookform/resolvers/zod';
import { Decimal } from '@tugeel/shared/money';
import {
  POS_LIMITS,
  VOUCHER_EFFECTS,
  VOUCHER_KINDS,
  VOUCHER_LIMITS,
  formatVoucherCode,
} from '@tugeel/shared/pos';
import { addDays, businessDate } from '@tugeel/shared/time';
import { Ban, CircleCheck, ListChecks, Plus, Printer, TicketPercent } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type VoucherBatchDetail,
  type VoucherBatchKind,
  type VoucherBatchStatus,
  type VoucherUse,
  useVoucherBatch,
  useVoucherBatches,
  useVoucherMutations,
  voucherValueText,
} from './vouchers-api';

const STATUSES = ['ACTIVE', 'STOPPED'] as const;
const isKind = (value: string | null): value is VoucherBatchKind =>
  VOUCHER_KINDS.some((kind) => kind === value);
const isStatus = (value: string | null): value is VoucherBatchStatus =>
  STATUSES.some((status) => status === value);

function VoucherStatusBadge({ status }: { status: VoucherBatchStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'ACTIVE' ? 'success' : 'secondary'}>
      {t(`pos.vouchers.statuses.${status}`)}
    </Badge>
  );
}

/**
 * «Купон, ваучер» (ADR-0110): the batches of the till's discount coupons and partner vouchers;
 * filter by kind and status, search by name or a code. «Шинэ багц» opens the create dialog
 * (`?new=1`); a row opens the batch in the panel (`?batch=`).
 */
export function PosVouchersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [creating, setCreating] = useCreateParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const kind = isKind(kindParam) ? kindParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;
  const openId = Number.parseInt(params.get('batch') ?? '', 10);
  const batches = useVoucherBatches({ kind, status, q });
  const rows = batches.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(q || kind || status);

  return (
    <div>
      <PageHeader
        title={t('pos.vouchers.title')}
        description={t('pos.vouchers.description')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('pos.vouchers.new')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('pos.vouchers.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('pos.vouchers.fields.kind')}
          value={kind ?? ''}
          onChange={(event) => setParam('kind', event.target.value)}
        >
          <option value="">{t('pos.vouchers.allKinds')}</option>
          {VOUCHER_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`pos.vouchers.kinds.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.vouchers.fields.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('pos.vouchers.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`pos.vouchers.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(batches.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.vouchers.fields.number')}</TableHead>
              <TableHead>{t('pos.vouchers.fields.kind')}</TableHead>
              <TableHead>{t('pos.vouchers.fields.name')}</TableHead>
              <TableHead className="text-right">{t('pos.vouchers.fields.value')}</TableHead>
              <TableHead>{t('pos.vouchers.fields.partner')}</TableHead>
              <TableHead>{t('pos.vouchers.fields.validity')}</TableHead>
              <TableHead className="text-right">{t('pos.vouchers.fields.used')}</TableHead>
              <TableHead>{t('pos.vouchers.fields.status')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.isPending ? <SkeletonRows columns={10} /> : null}
            {rows.map((row) => {
              const href = hrefWithParam(params, 'batch', String(row.id));
              return (
                <LinkRow key={row.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>{t(`pos.vouchers.kinds.${row.kind}`)}</TableCell>
                  <TruncateCell text={row.name} />
                  <TableCell className="text-right font-mono">{voucherValueText(row)}</TableCell>
                  <TruncateCell text={row.customerName ?? t('pos.fields.none')}>
                    {row.customerName ?? (
                      <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                    )}
                  </TruncateCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {`${row.validFrom} – ${row.validTo}`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {t('pos.vouchers.usedOf', {
                      used: formatCount(row.redeemed),
                      qty: formatCount(row.qty),
                    })}
                  </TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={row.status} />
                  </TableCell>
                  <SpacerCell />
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!batches.isPending && rows.length === 0 ? (
          <EmptyState
            icon={TicketPercent}
            title={t('pos.vouchers.empty')}
            {...(filtered
              ? {
                  onClearFilters: () => {
                    setSearch('');
                    setParams(new URLSearchParams(), { replace: true });
                  },
                }
              : {})}
          />
        ) : null}
        <LoadMore query={batches} />
      </ListCard>
      {canManage ? (
        <VoucherBatchDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete('new');
                next.set('batch', String(id));
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : null}
      <VoucherBatchPanel
        batchId={openId > 0 ? openId : null}
        onClose={() => setParam('batch', null)}
      />
    </div>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const WHOLE = /^\d{1,8}$/;
const QTY = /^\d{1,4}$/;

const batchSchema = (today: string) =>
  z
    .object({
      kind: z.enum(VOUCHER_KINDS),
      name: z
        .string()
        .refine((value) => value.trim().length > 0, 'validation.required')
        .refine((value) => value.trim().length <= VOUCHER_LIMITS.maxName, 'validation.tooLong'),
      effect: z.enum(VOUCHER_EFFECTS),
      value: z.string(),
      validFrom: z.string().regex(ISO_DATE, 'validation.date'),
      validTo: z.string().regex(ISO_DATE, 'validation.date'),
      qty: z.string(),
      note: z.string().max(POS_LIMITS.maxNote, 'validation.tooLong'),
    })
    .superRefine((values, ctx) => {
      const value = values.value.trim();
      const effect = values.kind === 'PARTNER' ? 'AMOUNT' : values.effect;
      if (effect === 'PERCENT') {
        if (!PERCENT.test(value) || new Decimal(value).lte(0) || new Decimal(value).gt(100)) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.percent' });
        }
      } else if (
        !WHOLE.test(value) ||
        new Decimal(value).lt(1) ||
        new Decimal(value).gt(VOUCHER_LIMITS.maxAmount)
      ) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.wholeTugrik' });
      }
      const qty = values.qty.trim();
      if (!QTY.test(qty) || !inRange(Number.parseInt(qty, 10), 1, VOUCHER_LIMITS.maxBatchQty)) {
        ctx.addIssue({ code: 'custom', path: ['qty'], message: 'validation.voucherQty' });
      }
      if (ISO_DATE.test(values.validFrom) && ISO_DATE.test(values.validTo)) {
        if (values.validTo < values.validFrom) {
          ctx.addIssue({
            code: 'custom',
            path: ['validTo'],
            message: 'validation.lastDayBeforeStart',
          });
        } else if (values.validTo < today) {
          ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'validation.notPast' });
        }
      }
    });
type BatchValues = z.infer<ReturnType<typeof batchSchema>>;

const inRange = (value: number, min: number, max: number) => value >= min && value <= max;

/**
 * «Шинэ багц» (ADR-0110): a coupon (a percentage or tugriks off) or a partner organisation's
 * voucher (a face value the partner is billed), its days and how many codes. One Idempotency-Key
 * per dialog.
 */
function VoucherBatchDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <VoucherBatchForm onClose={onClose} onCreated={onCreated} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function VoucherBatchForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { create } = useVoucherMutations();
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const schema = useMemo(() => batchSchema(today), [today]);
  const form = useForm<BatchValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'COUPON',
      name: '',
      effect: 'PERCENT',
      value: '',
      validFrom: today,
      validTo: addDays(today, 30),
      qty: '',
      note: '',
    },
  });
  const watched = useWatch({ control: form.control });
  const kind = watched.kind ?? 'COUPON';
  const effect = kind === 'PARTNER' ? 'AMOUNT' : (watched.effect ?? 'PERCENT');
  const [partner, setPartner] = useState<PickedCustomer | null>(null);
  const [partnerMissing, setPartnerMissing] = useState(false);
  const { errors, isSubmitting } = form.formState;

  /** The partner is outside the form's schema: checked on every submit. */
  const checkPartner = () => {
    const missing = form.getValues('kind') === 'PARTNER' && partner === null;
    setPartnerMissing(missing);
    return !missing;
  };
  const submit = form.handleSubmit(async (values) => {
    if (!checkPartner()) return;
    const isPartner = values.kind === 'PARTNER';
    const note = values.note.trim();
    const created = await settle(
      create.mutateAsync({
        key,
        kind: values.kind,
        name: values.name.trim(),
        effect: isPartner ? 'AMOUNT' : values.effect,
        value: values.value.trim(),
        customerId: isPartner ? (partner?.id ?? null) : null,
        validFrom: values.validFrom,
        validTo: values.validTo,
        qty: Number.parseInt(values.qty.trim(), 10),
        note: note === '' ? null : note,
      }),
    );
    if (!created) return;
    toast.success(t('pos.vouchers.created', { number: created.number }));
    onCreated(created.id);
  }, checkPartner);

  const valueLabel =
    kind === 'PARTNER'
      ? t('pos.vouchers.fields.faceValue')
      : effect === 'PERCENT'
        ? t('pos.vouchers.fields.percent')
        : t('pos.vouchers.fields.amount');

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{t('pos.vouchers.dialog.title')}</DialogTitle>
          <DialogDescription>{t('pos.vouchers.dialog.hint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(create.error)} />
        <FormField label={t('pos.vouchers.fields.kind')} htmlFor="voucher-kind">
          <NativeSelect id="voucher-kind" {...form.register('kind')}>
            {VOUCHER_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`pos.vouchers.kinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          label={t('pos.vouchers.fields.name')}
          htmlFor="voucher-name"
          error={errors.name?.message}
        >
          <Input id="voucher-name" autoComplete="off" {...form.register('name')} />
        </FormField>
        {kind === 'PARTNER' ? (
          <FormField
            label={t('pos.vouchers.fields.partner')}
            htmlFor="voucher-partner"
            hint={t('pos.vouchers.dialog.partnerHint')}
            error={partnerMissing ? 'validation.required' : undefined}
          >
            <CustomerPicker
              id="voucher-partner"
              value={partner}
              invalid={partnerMissing}
              onChange={(picked) => {
                setPartner(picked);
                if (picked) setPartnerMissing(false);
              }}
            />
          </FormField>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'COUPON' ? (
            <FormField label={t('pos.vouchers.fields.effect')} htmlFor="voucher-effect">
              <NativeSelect id="voucher-effect" {...form.register('effect')}>
                {VOUCHER_EFFECTS.map((value) => (
                  <option key={value} value={value}>
                    {t(`pos.vouchers.effects.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField
            label={valueLabel}
            htmlFor="voucher-value"
            hint={kind === 'PARTNER' ? t('pos.vouchers.dialog.faceHint') : undefined}
            error={errors.value?.message}
          >
            <Input
              id="voucher-value"
              inputMode="decimal"
              autoComplete="off"
              className="font-mono"
              {...form.register('value')}
            />
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t('pos.vouchers.fields.validFrom')}
            htmlFor="voucher-from"
            error={errors.validFrom?.message}
          >
            <Input id="voucher-from" type="date" {...form.register('validFrom')} />
          </FormField>
          <FormField
            label={t('pos.vouchers.fields.validTo')}
            htmlFor="voucher-to"
            error={errors.validTo?.message}
          >
            <Input
              id="voucher-to"
              type="date"
              min={watched.validFrom || today}
              {...form.register('validTo')}
            />
          </FormField>
        </div>
        <FormField
          label={t('pos.vouchers.fields.qty')}
          htmlFor="voucher-qty"
          hint={t('pos.vouchers.dialog.qtyHint')}
          error={errors.qty?.message}
        >
          <Input
            id="voucher-qty"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-28"
            {...form.register('qty')}
          />
        </FormField>
        <FormField
          label={t('pos.vouchers.fields.note')}
          htmlFor="voucher-note"
          error={errors.note?.message}
        >
          <Textarea id="voucher-note" rows={2} {...form.register('note')} />
        </FormField>
        <DialogFormFooter
          pending={isSubmitting}
          submitLabel={t('pos.vouchers.dialog.submit')}
          onCancel={onClose}
        />
      </form>
    </DialogContent>
  );
}

/** One batch in the panel (`?batch=`): its terms, print and stop, the codes and the uses to check. */
function VoucherBatchPanel({ batchId, onClose }: { batchId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const batch = useVoucherBatch(batchId);
  const detail = batch.data;
  return (
    <RecordSheet
      open={batchId !== null}
      onClose={onClose}
      title={
        detail
          ? t('pos.vouchers.panelTitle', {
              kind: t(`pos.vouchers.kinds.${detail.kind}`),
              number: detail.number,
            })
          : ''
      }
      description={detail ? detail.name : ''}
      badges={detail ? <VoucherStatusBadge status={detail.status} /> : null}
      actions={detail ? <PanelActions batch={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(batch.error)} />
      {detail ? <BatchBody batch={detail} /> : null}
    </RecordSheet>
  );
}

function PanelActions({ batch }: { batch: VoucherBatchDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const { stop } = useVoucherMutations();
  const [asking, setAsking] = useState(false);
  const unused = batch.qty - batch.redeemed;
  return (
    <>
      <Button asChild variant="outline" size="sm">
        <Link to={`/pos/vouchers/${batch.id}/print`} target="_blank">
          <Printer />
          {t('pos.vouchers.actions.print')}
        </Link>
      </Button>
      {batch.kind === 'PARTNER' ? (
        <Button asChild variant="outline" size="sm">
          <Link to={`/pos/vouchers/${batch.id}/print?used=1`} target="_blank">
            <ListChecks />
            {t('pos.vouchers.actions.printUsed')}
          </Link>
        </Button>
      ) : null}
      {canManage && batch.status === 'ACTIVE' ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              stop.reset();
              setAsking(true);
            }}
          >
            <Ban />
            {t('pos.vouchers.actions.stop')}
          </Button>
          <ConfirmDialog
            open={asking}
            title={t('pos.vouchers.stopTitle')}
            description={t('pos.vouchers.stopDescription', {
              number: batch.number,
              count: formatCount(unused),
            })}
            confirmLabel={t('pos.vouchers.actions.stop')}
            pending={stop.isPending}
            problem={problemFromError(stop.error)}
            onClose={() => setAsking(false)}
            onConfirm={() =>
              stop.mutate(batch.id, {
                onSuccess: () => {
                  setAsking(false);
                  toast.success(t('pos.vouchers.stopped', { number: batch.number }));
                },
              })
            }
          />
        </>
      ) : null}
    </>
  );
}

function BatchBody({ batch }: { batch: VoucherBatchDetail }) {
  const { t } = useTranslation();
  const toCheck = batch.uses.filter((use) => use.issue !== null);
  const facts = [
    { label: t('pos.vouchers.fields.kind'), value: t(`pos.vouchers.kinds.${batch.kind}`) },
    {
      label:
        batch.kind === 'PARTNER' ? t('pos.vouchers.fields.face') : t('pos.vouchers.fields.value'),
      value: voucherValueText(batch),
    },
    ...(batch.customerName
      ? [{ label: t('pos.vouchers.fields.partner'), value: batch.customerName }]
      : []),
    {
      label: t('pos.vouchers.fields.validity'),
      value: `${batch.validFrom} – ${batch.validTo}`,
    },
    {
      label: t('pos.vouchers.fields.used'),
      value: t('pos.vouchers.usedOf', {
        used: formatCount(batch.redeemed),
        qty: formatCount(batch.qty),
      }),
    },
    {
      label: t('pos.vouchers.fields.createdBy'),
      value: [batch.createdByName, formatUbDateTime(Date.parse(batch.createdAt))]
        .filter(Boolean)
        .join(' · '),
    },
    ...(batch.stoppedAt
      ? [
          {
            label: t('pos.vouchers.fields.stoppedAt'),
            value: formatUbDateTime(Date.parse(batch.stoppedAt)),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <FactChips facts={facts} />
      {toCheck.length > 0 ? (
        <PanelSection title={t('pos.vouchers.sections.uses')}>
          <ul className="flex flex-col divide-y divide-border/80 rounded-lg border border-border text-sm">
            {toCheck.map((use) => (
              <UseToCheck key={use.id} use={use} />
            ))}
          </ul>
        </PanelSection>
      ) : null}
      <PanelSection title={t('pos.vouchers.sections.codes')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">{t('pos.vouchers.fields.seq')}</TableHead>
                <TableHead>{t('pos.vouchers.fields.code')}</TableHead>
                <TableHead>{t('pos.vouchers.fields.status')}</TableHead>
                <TableHead>{t('pos.vouchers.fields.sale')}</TableHead>
                <TableHead>{t('pos.vouchers.fields.usedAt')}</TableHead>
                <TableHead className="w-full text-right">
                  {t('pos.vouchers.fields.amountUsed')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.codes.map((code) => (
                <TableRow key={code.id}>
                  <TableCell className="text-right font-mono">{code.seq}</TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {formatVoucherCode(code.code)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={code.status === 'REDEEMED' ? 'default' : 'outline'}>
                      {t(`pos.vouchers.codeStatuses.${code.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {code.saleId !== null ? (
                      <Link
                        className="text-link underline-offset-2 hover:underline"
                        to={`/pos/sales?sale=${code.saleId}`}
                      >
                        {code.saleNumber ?? String(code.saleId)}
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {code.redeemedAt ? formatUbDateTime(Date.parse(code.redeemedAt)) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {code.amount !== null ? formatTugrik(code.amount) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelSection>
      {batch.note ? (
        <PanelSection title={t('pos.vouchers.fields.note')}>
          <p className="text-sm whitespace-pre-wrap">{batch.note}</p>
        </PanelSection>
      ) : null}
    </div>
  );
}

/**
 * A use the centre found wrong (used twice, stopped, out of date, unknown; ADR-0110 #5): the sale
 * stays, and `pos.manage` marks it «Шалгасан».
 */
function UseToCheck({ use }: { use: VoucherUse }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const { review } = useVoucherMutations();
  const code = formatVoucherCode(use.code);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        {use.issue ? (
          <Badge variant="warning">{t(`pos.vouchers.issues.${use.issue}`)}</Badge>
        ) : null}
        <span className="font-mono">{code}</span>
        <Link
          className="font-mono text-link underline-offset-2 hover:underline"
          to={`/pos/sales?sale=${use.saleId}`}
        >
          {use.saleNumber}
        </Link>
        <span className="font-mono text-muted-foreground">
          {`${formatUbDateTime(Date.parse(use.soldAt))} · ${formatTugrik(use.amount)}`}
        </span>
      </span>
      {use.reviewedAt ? (
        <span className="text-[13px] text-muted-foreground">
          {[
            t('pos.vouchers.reviewedAt', { at: formatUbDateTime(Date.parse(use.reviewedAt)) }),
            use.reviewNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : canManage ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={t('pos.vouchers.reviewLabel', { code })}
          title={t('pos.vouchers.reviewLabel', { code })}
          disabled={review.isPending}
          onClick={() =>
            review.mutate(
              { id: use.id, note: null },
              { onSuccess: () => toast.success(t('pos.vouchers.reviewed')) },
            )
          }
        >
          <CircleCheck />
          {t('pos.vouchers.actions.review')}
        </Button>
      ) : null}
      {review.error ? (
        <div className="basis-full">
          <ProblemAlert problem={problemFromError(review.error)} />
        </div>
      ) : null}
    </li>
  );
}
