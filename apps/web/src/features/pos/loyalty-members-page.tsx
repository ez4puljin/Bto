import { zodResolver } from '@hookform/resolvers/zod';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { GENDERS, LOYALTY_LIMITS, isMemberPin } from '@tugeel/shared/pos';
import { REG_NO_MAX_LENGTH } from '@tugeel/shared/taxpayer';
import { businessDate } from '@tugeel/shared/time';
import { Ban, CircleCheck, Coins, IdCard, KeyRound, LockOpen, Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DetailCard, FieldList } from '@/components/detail';
import { DialogFormFooter, FormField, FormFooter, FormRow, FormSection } from '@/components/form';
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
import { PanelSection, RecordSheet } from '@/components/record-sheet';
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
import { localPhone, phoneInput } from '@/features/partners/phone';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatTugrik, plainDecimal } from '@/lib/money';
import { problemFromError, settle } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type LoyaltyEntry,
  type LoyaltyMember,
  type LoyaltyMemberStatus,
  type SaleLoyalty,
  useLoyaltyEntries,
  useLoyaltyMember,
  useLoyaltyMembers,
  useLoyaltyMutations,
  useSaleLoyaltyToCheck,
} from './loyalty-api';

const STATUSES = ['ACTIVE', 'BLOCKED'] as const satisfies readonly LoyaltyMemberStatus[];
const isStatus = (value: string | null): value is LoyaltyMemberStatus =>
  STATUSES.some((status) => status === value);

/** Points as read: one point is one tugrik, grouped, without the sign of money. */
const pointsText = (value: string) => formatMnt(value);
/** A history line's points with their sign («+400», «-1,200»). */
const signedPoints = (value: string) =>
  new Decimal(value).gt(0) ? `+${formatMnt(value)}` : formatMnt(value);

function MemberStatusBadge({ status }: { status: LoyaltyMemberStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'ACTIVE' ? 'success' : 'destructive'}>
      {t(`posLoyalty.statuses.${status}`)}
    </Badge>
  );
}

/**
 * «Бонус карт» (ADR-0112): the supermarket's card members, found by name or phone, filtered by
 * status. «Гишүүн бүртгэх» opens the create dialog (`?new=1`); a row opens the member in the panel
 * (`?member=`). The member sales the centre flagged wait above the list until checked.
 */
export function PosLoyaltyMembersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.loyalty.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [creating, setCreating] = useCreateParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const openId = Number.parseInt(params.get('member') ?? '', 10);
  const members = useLoyaltyMembers({ status, q });
  const rows = members.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(q || status);

  return (
    <div>
      <PageHeader
        title={t('posLoyalty.title')}
        description={t('posLoyalty.description')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('posLoyalty.new')}
            </Button>
          ) : null
        }
      />
      <LoyaltyToCheck />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('posLoyalty.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('posLoyalty.fields.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('posLoyalty.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`posLoyalty.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(members.error)} onRetry={members.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('posLoyalty.fields.name')}</TableHead>
              <TableHead>{t('posLoyalty.fields.phone')}</TableHead>
              <TableHead>{t('posLoyalty.fields.tier')}</TableHead>
              <TableHead className="text-right">{t('posLoyalty.fields.balance')}</TableHead>
              <TableHead className="text-right">{t('posLoyalty.fields.lifetimeSpend')}</TableHead>
              <TableHead>{t('posLoyalty.fields.status')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((row) => {
              const href = hrefWithParam(params, 'member', String(row.id));
              return (
                <LinkRow key={row.id} to={href}>
                  <TruncateCell text={row.name}>
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {row.name}
                    </Link>
                  </TruncateCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {localPhone(row.phone)}
                  </TableCell>
                  <TableCell>
                    {row.tier ? (
                      t('posLoyalty.tierText', {
                        name: row.tier.name,
                        percent: plainDecimal(row.tier.percent),
                      })
                    ) : (
                      <span className="text-muted-foreground">{t('posLoyalty.noTier')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{pointsText(row.balance)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(row.lifetimeSpend)}
                  </TableCell>
                  <TableCell>
                    <MemberStatusBadge status={row.status} />
                  </TableCell>
                  <SpacerCell />
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!members.isPending && rows.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title={t('posLoyalty.empty')}
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
        <LoadMore query={members} />
      </ListCard>
      {canManage ? (
        <RegisterDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete('new');
                next.set('member', String(id));
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : null}
      <MemberPanel memberId={openId > 0 ? openId : null} onClose={() => setParam('member', null)} />
    </div>
  );
}

// ---------------------------------------------------------------- the member's fields

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fieldsShape = (today: string) => ({
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'validation.required')
    .refine((value) => value.trim().length <= LOYALTY_LIMITS.maxName, 'validation.tooLong'),
  phone: z.string().refine((value) => normalizeMnPhone(value) !== null, 'validation.phone'),
  regNo: z
    .string()
    .refine((value) => value.trim().length <= REG_NO_MAX_LENGTH, 'validation.tooLong'),
  birthDate: z
    .string()
    .refine((value) => value === '' || ISO_DATE.test(value), 'validation.date')
    .refine((value) => value === '' || value <= today, 'validation.notFuture'),
  gender: z.union([z.literal(''), z.enum(GENDERS)]),
  note: z.string().max(LOYALTY_LIMITS.maxNote, 'validation.tooLong'),
});

const fieldsSchema = (today: string) => z.object(fieldsShape(today));
type FieldValues = z.infer<ReturnType<typeof fieldsSchema>>;

const registerSchema = (today: string) =>
  z
    .object({
      ...fieldsShape(today),
      pin: z.string().refine(isMemberPin, 'validation.memberPin'),
      pinAgain: z.string(),
    })
    .refine((values) => values.pin === values.pinAgain, {
      path: ['pinAgain'],
      message: 'validation.memberPinMismatch',
    });
type RegisterValues = z.infer<ReturnType<typeof registerSchema>>;

const emptyToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** The request body of the member's own fields, shared by registering and editing. */
const fieldsBody = (values: FieldValues) => ({
  name: values.name.trim(),
  phone: normalizeMnPhone(values.phone) ?? values.phone.trim(),
  regNo: emptyToNull(values.regNo),
  birthDate: values.birthDate === '' ? null : values.birthDate,
  gender: values.gender === '' ? null : values.gender,
  note: emptyToNull(values.note),
});

/**
 * «Гишүүн бүртгэх» (ADR-0112): the name, the phone the till finds the member by, the PIN typed
 * twice, and the optional details. One Idempotency-Key per dialog.
 */
function RegisterDialog({
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
        <RegisterForm onClose={onClose} onCreated={onCreated} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function RegisterForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { register } = useLoyaltyMutations();
  const [today] = useState(businessDate);
  const [key] = useState(randomUuid);
  const schema = useMemo(() => registerSchema(today), [today]);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      phone: '',
      pin: '',
      pinAgain: '',
      regNo: '',
      birthDate: '',
      gender: '',
      note: '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const created = await settle(
      register.mutateAsync({ key, ...fieldsBody(values), pin: values.pin }),
    );
    if (!created) return;
    toast.success(t('posLoyalty.created', { name: created.name }));
    onCreated(created.id);
  });

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{t('posLoyalty.dialog.title')}</DialogTitle>
          <DialogDescription>{t('posLoyalty.dialog.hint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(register.error)} />
        <FormField
          label={t('posLoyalty.fields.name')}
          htmlFor="member-name"
          error={errors.name?.message}
        >
          <Input id="member-name" autoComplete="off" {...form.register('name')} />
        </FormField>
        <FormField
          label={t('posLoyalty.fields.phone')}
          htmlFor="member-phone"
          error={errors.phone?.message}
        >
          <Input
            id="member-phone"
            inputMode="tel"
            autoComplete="off"
            className="font-mono sm:w-48"
            {...form.register('phone')}
          />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t('posLoyalty.fields.pin')}
            htmlFor="member-pin"
            hint={t('posLoyalty.dialog.pinHint')}
            error={errors.pin?.message}
          >
            <Input
              id="member-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              className="font-mono"
              {...form.register('pin')}
            />
          </FormField>
          <FormField
            label={t('posLoyalty.fields.pinAgain')}
            htmlFor="member-pin-again"
            error={errors.pinAgain?.message}
          >
            <Input
              id="member-pin-again"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              className="font-mono"
              {...form.register('pinAgain')}
            />
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t('posLoyalty.fields.regNo')}
            htmlFor="member-reg-no"
            error={errors.regNo?.message}
          >
            <Input id="member-reg-no" autoComplete="off" {...form.register('regNo')} />
          </FormField>
          <FormField
            label={t('posLoyalty.fields.birthDate')}
            htmlFor="member-birth"
            error={errors.birthDate?.message}
          >
            <Input id="member-birth" type="date" max={today} {...form.register('birthDate')} />
          </FormField>
        </div>
        <FormField label={t('posLoyalty.fields.gender')} htmlFor="member-gender">
          <NativeSelect id="member-gender" className="sm:w-48" {...form.register('gender')}>
            <option value="">{t('posLoyalty.noGender')}</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {t(`posLoyalty.genders.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          label={t('posLoyalty.fields.note')}
          htmlFor="member-note"
          error={errors.note?.message}
        >
          <Textarea id="member-note" rows={2} {...form.register('note')} />
        </FormField>
        <DialogFormFooter
          pending={isSubmitting}
          submitLabel={t('posLoyalty.dialog.submit')}
          onCancel={onClose}
        />
      </form>
    </DialogContent>
  );
}

// ---------------------------------------------------------------- the panel

/** One member in the panel (`?member=`): the details card, the actions and the points history. */
function MemberPanel({ memberId, onClose }: { memberId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const member = useLoyaltyMember(memberId);
  const detail = member.data;
  return (
    <RecordSheet
      open={memberId !== null}
      onClose={onClose}
      title={detail ? detail.name : ''}
      description={detail ? localPhone(detail.phone) : ''}
      badges={
        detail ? (
          <>
            <MemberStatusBadge status={detail.status} />
            {detail.tier ? (
              <Badge variant="outline">
                {t('posLoyalty.tierText', {
                  name: detail.tier.name,
                  percent: plainDecimal(detail.tier.percent),
                })}
              </Badge>
            ) : null}
          </>
        ) : null
      }
      actions={detail ? <PanelActions member={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(member.error)} onRetry={member.refetch} />
      {detail ? (
        <div className="flex flex-col gap-5">
          <MemberDetailsCard member={detail} />
          <EntriesSection memberId={detail.id} />
        </div>
      ) : null}
    </RecordSheet>
  );
}

function PanelActions({ member }: { member: LoyaltyMember }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.loyalty.manage');
  const { block, unblock } = useLoyaltyMutations();
  const [dialog, setDialog] = useState<'pin' | 'adjust' | 'block' | 'unblock' | null>(null);
  if (!canManage) return null;
  const close = () => setDialog(null);
  const blocking = dialog === 'block';
  const toggle = blocking ? block : unblock;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setDialog('pin')}>
        <KeyRound />
        {t('posLoyalty.actions.pin')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDialog('adjust')}>
        <Coins />
        {t('posLoyalty.actions.adjust')}
      </Button>
      {member.status === 'ACTIVE' ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            block.reset();
            setDialog('block');
          }}
        >
          <Ban />
          {t('posLoyalty.actions.block')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            unblock.reset();
            setDialog('unblock');
          }}
        >
          <LockOpen />
          {t('posLoyalty.actions.unblock')}
        </Button>
      )}
      <PinDialog member={member} open={dialog === 'pin'} onClose={close} />
      <AdjustDialog member={member} open={dialog === 'adjust'} onClose={close} />
      <ConfirmDialog
        open={dialog === 'block' || dialog === 'unblock'}
        variant={blocking ? 'destructive' : 'default'}
        title={blocking ? t('posLoyalty.blockTitle') : t('posLoyalty.unblockTitle')}
        description={
          blocking
            ? t('posLoyalty.blockDescription', { name: member.name })
            : t('posLoyalty.unblockDescription', { name: member.name })
        }
        confirmLabel={blocking ? t('posLoyalty.actions.block') : t('posLoyalty.actions.unblock')}
        pending={toggle.isPending}
        problem={problemFromError(toggle.error)}
        onClose={close}
        onConfirm={() =>
          toggle.mutate(member.id, {
            onSuccess: () => {
              close();
              toast.success(blocking ? t('posLoyalty.blocked') : t('posLoyalty.unblocked'));
            },
          })
        }
      />
    </>
  );
}

/** The member's details, read first; «Засах» edits them in place. */
function MemberDetailsCard({ member }: { member: LoyaltyMember }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.loyalty.manage');
  return (
    <DetailCard
      title={t('posLoyalty.sections.details')}
      canEdit={canManage}
      view={<MemberFacts member={member} />}
      edit={(close) => <MemberEditForm member={member} onClose={close} />}
    />
  );
}

function MemberFacts({ member }: { member: LoyaltyMember }) {
  const { t } = useTranslation();
  return (
    <FieldList
      items={[
        { label: t('posLoyalty.fields.phone'), value: localPhone(member.phone) },
        {
          label: t('posLoyalty.fields.balance'),
          value: (
            <span className="font-mono">
              {t('posLoyalty.pointsValue', { points: pointsText(member.balance) })}
            </span>
          ),
        },
        {
          label: t('posLoyalty.fields.lifetimeSpend'),
          value: <span className="font-mono">{formatTugrik(member.lifetimeSpend)}</span>,
        },
        {
          label: t('posLoyalty.fields.tier'),
          value: member.tier
            ? t('posLoyalty.tierText', {
                name: member.tier.name,
                percent: plainDecimal(member.tier.percent),
              })
            : t('posLoyalty.noTier'),
        },
        {
          label: t('posLoyalty.fields.nextTier'),
          value: member.nextTier
            ? t('posLoyalty.nextTierText', {
                name: member.nextTier.name,
                percent: plainDecimal(member.nextTier.percent),
                left: formatMnt(member.nextTier.left),
              })
            : null,
        },
        { label: t('posLoyalty.fields.regNo'), value: member.regNo },
        { label: t('posLoyalty.fields.birthDate'), value: member.birthDate },
        {
          label: t('posLoyalty.fields.gender'),
          value: member.gender ? t(`posLoyalty.genders.${member.gender}`) : null,
        },
        {
          label: t('posLoyalty.fields.note'),
          value: member.note ? <span className="whitespace-pre-wrap">{member.note}</span> : null,
        },
        {
          label: t('posLoyalty.fields.pinSetAt'),
          value: formatUbDateTime(Date.parse(member.pinSetAt)),
        },
        {
          label: t('posLoyalty.fields.createdBy'),
          value: [member.createdByName, formatUbDateTime(Date.parse(member.createdAt))]
            .filter(Boolean)
            .join(' · '),
        },
      ]}
    />
  );
}

function MemberEditForm({ member, onClose }: { member: LoyaltyMember; onClose: () => void }) {
  const { t } = useTranslation();
  const { update } = useLoyaltyMutations();
  const [today] = useState(businessDate);
  const schema = useMemo(() => fieldsSchema(today), [today]);
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: member.name,
      phone: phoneInput(member.phone),
      regNo: member.regNo ?? '',
      birthDate: member.birthDate ?? '',
      gender: member.gender ?? '',
      note: member.note ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const saved = await settle(update.mutateAsync({ id: member.id, ...fieldsBody(values) }));
    if (!saved) return;
    toast.success(t('posLoyalty.saved'));
    onClose();
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <FormSection>
        <FormRow
          label={t('posLoyalty.fields.name')}
          htmlFor="member-edit-name"
          error={errors.name?.message}
        >
          <Input id="member-edit-name" autoComplete="off" {...form.register('name')} />
        </FormRow>
        <FormRow
          label={t('posLoyalty.fields.phone')}
          htmlFor="member-edit-phone"
          error={errors.phone?.message}
        >
          <Input
            id="member-edit-phone"
            inputMode="tel"
            autoComplete="off"
            className="font-mono sm:w-48"
            {...form.register('phone')}
          />
        </FormRow>
        <FormRow
          label={t('posLoyalty.fields.regNo')}
          htmlFor="member-edit-reg-no"
          error={errors.regNo?.message}
        >
          <Input id="member-edit-reg-no" autoComplete="off" {...form.register('regNo')} />
        </FormRow>
        <FormRow
          label={t('posLoyalty.fields.birthDate')}
          htmlFor="member-edit-birth"
          error={errors.birthDate?.message}
        >
          <Input
            id="member-edit-birth"
            type="date"
            max={today}
            className="sm:w-48"
            {...form.register('birthDate')}
          />
        </FormRow>
        <FormRow label={t('posLoyalty.fields.gender')} htmlFor="member-edit-gender">
          <NativeSelect id="member-edit-gender" className="sm:w-48" {...form.register('gender')}>
            <option value="">{t('posLoyalty.noGender')}</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {t(`posLoyalty.genders.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('posLoyalty.fields.note')}
          htmlFor="member-edit-note"
          error={errors.note?.message}
        >
          <Textarea id="member-edit-note" rows={2} {...form.register('note')} />
        </FormRow>
      </FormSection>
      <ProblemAlert problem={problemFromError(update.error)} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

// ---------------------------------------------------------------- PIN and points dialogs

const pinSchema = z
  .object({
    pin: z.string().refine(isMemberPin, 'validation.memberPin'),
    pinAgain: z.string(),
  })
  .refine((values) => values.pin === values.pinAgain, {
    path: ['pinAgain'],
    message: 'validation.memberPinMismatch',
  });
type PinValues = z.infer<typeof pinSchema>;

/** «ПИН солих»: the new PIN typed twice. */
function PinDialog({
  member,
  open,
  onClose,
}: {
  member: LoyaltyMember;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <PinForm member={member} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function PinForm({ member, onClose }: { member: LoyaltyMember; onClose: () => void }) {
  const { t } = useTranslation();
  const { setPin } = useLoyaltyMutations();
  const form = useForm<PinValues>({
    resolver: zodResolver(pinSchema),
    defaultValues: { pin: '', pinAgain: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const saved = await settle(setPin.mutateAsync({ id: member.id, pin: values.pin }));
    if (!saved) return;
    toast.success(t('posLoyalty.pinChanged'));
    onClose();
  });
  return (
    <DialogContent closeLabel={t('common.close')} size="sm">
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{t('posLoyalty.pinDialog.title', { name: member.name })}</DialogTitle>
          <DialogDescription>{t('posLoyalty.pinDialog.hint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(setPin.error)} />
        <FormField
          label={t('posLoyalty.fields.pin')}
          htmlFor="member-new-pin"
          error={errors.pin?.message}
        >
          <Input
            id="member-new-pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            className="font-mono"
            {...form.register('pin')}
          />
        </FormField>
        <FormField
          label={t('posLoyalty.fields.pinAgain')}
          htmlFor="member-new-pin-again"
          error={errors.pinAgain?.message}
        >
          <Input
            id="member-new-pin-again"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            className="font-mono"
            {...form.register('pinAgain')}
          />
        </FormField>
        <DialogFormFooter
          pending={isSubmitting}
          submitLabel={t('posLoyalty.pinDialog.submit')}
          onCancel={onClose}
        />
      </form>
    </DialogContent>
  );
}

const SIGNED_WHOLE = /^[+-]?\d{1,8}$/;

const adjustSchema = z.object({
  points: z.string().refine((value) => {
    const text = value.trim();
    if (!SIGNED_WHOLE.test(text)) return false;
    const points = new Decimal(text.replace(/^\+/, ''));
    return !points.isZero() && points.abs().lte(LOYALTY_LIMITS.maxAdjust);
  }, 'validation.loyaltyPoints'),
  reason: z
    .string()
    .refine((value) => value.trim().length > 0, 'validation.required')
    .refine((value) => value.trim().length <= LOYALTY_LIMITS.maxReason, 'validation.tooLong'),
});
type AdjustValues = z.infer<typeof adjustSchema>;

/** «Оноо нэмэх/хасах»: whole points either way with a reason. One Idempotency-Key per dialog. */
function AdjustDialog({
  member,
  open,
  onClose,
}: {
  member: LoyaltyMember;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <AdjustForm member={member} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function AdjustForm({ member, onClose }: { member: LoyaltyMember; onClose: () => void }) {
  const { t } = useTranslation();
  const { adjust } = useLoyaltyMutations();
  const [key] = useState(randomUuid);
  const form = useForm<AdjustValues>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { points: '', reason: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const points = values.points.trim().replace(/^\+/, '');
    const saved = await settle(
      adjust.mutateAsync({ id: member.id, key, points, reason: values.reason.trim() }),
    );
    if (!saved) return;
    toast.success(t('posLoyalty.adjusted', { points: signedPoints(points) }));
    onClose();
  });
  return (
    <DialogContent closeLabel={t('common.close')} size="sm">
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{t('posLoyalty.adjustDialog.title', { name: member.name })}</DialogTitle>
          <DialogDescription>
            {t('posLoyalty.adjustDialog.hint', { balance: pointsText(member.balance) })}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={problemFromError(adjust.error)} />
        <FormField
          label={t('posLoyalty.fields.points')}
          htmlFor="member-adjust-points"
          error={errors.points?.message}
        >
          <Input
            id="member-adjust-points"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono sm:w-40"
            {...form.register('points')}
          />
        </FormField>
        <FormField
          label={t('posLoyalty.fields.reason')}
          htmlFor="member-adjust-reason"
          hint={t('posLoyalty.adjustDialog.reasonHint')}
          error={errors.reason?.message}
        >
          <Input id="member-adjust-reason" autoComplete="off" {...form.register('reason')} />
        </FormField>
        <DialogFormFooter
          pending={isSubmitting}
          submitLabel={t('posLoyalty.adjustDialog.submit')}
          onCancel={onClose}
        />
      </form>
    </DialogContent>
  );
}

// ---------------------------------------------------------------- the points history

function EntriesSection({ memberId }: { memberId: number }) {
  const { t } = useTranslation();
  const entries = useLoyaltyEntries(memberId);
  const rows = entries.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <PanelSection title={t('posLoyalty.sections.entries')}>
      <ProblemAlert problem={problemFromError(entries.error)} onRetry={entries.refetch} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('posLoyalty.fields.date')}</TableHead>
              <TableHead>{t('posLoyalty.fields.kind')}</TableHead>
              <TableHead className="text-right">{t('posLoyalty.fields.points')}</TableHead>
              <TableHead>{t('posLoyalty.fields.sale')}</TableHead>
              <TableHead className="w-full">{t('posLoyalty.fields.reason')}</TableHead>
              <TableHead>{t('posLoyalty.fields.journal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </TableBody>
        </Table>
        {!entries.isPending && rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t('posLoyalty.entriesEmpty')}</p>
        ) : null}
        <LoadMore query={entries} />
      </div>
    </PanelSection>
  );
}

function EntryRow({ entry }: { entry: LoyaltyEntry }) {
  const { t } = useTranslation();
  const positive = new Decimal(entry.points).gt(0);
  return (
    <TableRow>
      <TableCell className="font-mono whitespace-nowrap">
        {formatUbDateTime(Date.parse(entry.createdAt))}
      </TableCell>
      <TableCell className="whitespace-nowrap">{t(`posLoyalty.kinds.${entry.kind}`)}</TableCell>
      <TableCell
        className={
          positive ? 'text-right font-mono text-success' : 'text-right font-mono text-destructive'
        }
      >
        {signedPoints(entry.points)}
      </TableCell>
      <TableCell className="font-mono whitespace-nowrap">
        {entry.saleId !== null ? (
          <Link
            className="text-link underline-offset-2 hover:underline"
            to={`/pos/sales?sale=${entry.saleId}`}
          >
            {entry.saleNumber ?? String(entry.saleId)}
          </Link>
        ) : null}
      </TableCell>
      <TableCell>{[entry.reason, entry.createdByName].filter(Boolean).join(' · ')}</TableCell>
      <TableCell className="font-mono whitespace-nowrap">{entry.journalNumber}</TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------- sales to check

/**
 * «Бонус картын шалгах худалдаа» (ADR-0112 #6): member sales a till made on a blocked card or past
 * the balance the centre knows. The sale stays; `pos.manage` marks each «Шалгасан». Hidden when
 * nothing waits.
 */
function LoyaltyToCheck() {
  const { t } = useTranslation();
  const canRead = useHasPermission('pos.read');
  const toCheck = useSaleLoyaltyToCheck(canRead);
  const rows = toCheck.data ?? [];
  if (!canRead || rows.length === 0) return null;
  return (
    <section
      aria-labelledby="loyalty-to-check"
      className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="loyalty-to-check" className="text-[15px] font-semibold tracking-tight">
          {t('posLoyalty.check.title')}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {t('posLoyalty.check.count', { count: rows.length })}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">{t('posLoyalty.check.hint')}</p>
      <ul className="flex flex-col divide-y divide-border/80 rounded-lg border border-border text-sm">
        {rows.map((row) => (
          <SaleToCheck key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function SaleToCheck({ row }: { row: SaleLoyalty }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const [params] = useSearchParams();
  const { review } = useLoyaltyMutations();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        {row.issue ? (
          <Badge variant="warning">{t(`posLoyalty.check.issues.${row.issue}`)}</Badge>
        ) : null}
        <span>{t(`posLoyalty.check.saleKinds.${row.kind}`)}</span>
        <Link
          className="font-mono text-link underline-offset-2 hover:underline"
          to={`/pos/sales?sale=${row.saleId}`}
        >
          {row.saleNumber}
        </Link>
        <Link
          className="font-medium underline-offset-2 hover:underline"
          to={hrefWithParam(params, 'member', String(row.memberId))}
        >
          {row.memberName}
        </Link>
        <span className="font-mono text-muted-foreground">
          {[
            formatUbDateTime(Date.parse(row.soldAt)),
            t('posLoyalty.check.summary', {
              earned: pointsText(row.earned),
              spent: pointsText(row.spent),
              balance: pointsText(row.balanceAfter),
            }),
          ].join(' · ')}
        </span>
      </span>
      {canManage ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={t('posLoyalty.check.reviewLabel', { number: row.saleNumber })}
          title={t('posLoyalty.check.reviewLabel', { number: row.saleNumber })}
          disabled={review.isPending}
          onClick={() =>
            review.mutate(
              { id: row.id, note: null },
              { onSuccess: () => toast.success(t('posLoyalty.check.reviewed')) },
            )
          }
        >
          <CircleCheck />
          {t('posLoyalty.actions.review')}
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
