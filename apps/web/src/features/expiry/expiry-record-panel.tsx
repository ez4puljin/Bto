import type { ProblemDetails } from '@tugeel/api-client';
import {
  EXPIRY_NOTE_MAX,
  type ExpiryStatus,
  expiryDateBounds,
  expiryUrgency,
} from '@tugeel/shared/expiry';
import { daysBetween } from '@tugeel/shared/finance';
import { isIsoDate } from '@tugeel/shared/time';
import type { TFunction } from 'i18next';
import { Archive, ArchiveRestore, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
import { RoleName } from '@/components/role-name';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ExpiryChange,
  type ExpiryItem,
  useExpiryHistory,
  useExpiryItem,
  useExpiryMutations,
} from './api';
import { ExpiryLiabilityDialog } from './expiry-liability-dialog';
import {
  changedFields,
  draftProblems,
  isSameDraft,
  keepTyped,
  type RecordDraft,
  sameQty,
} from './helpers';
import { DaysLeft, ExpiryStatusBadge, LiabilityTypeBadge } from './parts';

const OPEN_STATUSES = ['REVIEW', 'CITY_RETURN', 'INTERNAL_SALE'] as const;

const draftOf = (item: ExpiryItem): RecordDraft => ({
  expiryDate: item.expiryDate,
  qtyFloor: item.qtyFloor,
  qtyWarehouse: item.qtyWarehouse,
  note: item.note ?? '',
});

/**
 * A record in the panel (`?item=`): its facts, the correction form, the status, the liability and
 * the history. Anything that would drop what is typed and not saved asks first: ✕, Esc, Back, a link
 * or the palette through the page's guard (`onDirty` tells it), a reload through the browser's, an
 * archive through its own.
 */
export function ExpiryRecordPanel(props: {
  itemId: number | null;
  today: string | undefined;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useExpiryItem(props.itemId);
  const item = query.data;
  const canManage = useHasPermission('expiry.items.manage');
  const mutations = useExpiryMutations();
  const statusAction = useAction();
  const { clear: clearStatusProblem } = statusAction;
  const [askingArchive, setAskingArchive] = useState(false);
  /** A new form: the person said to drop what was typed, so a restore does not bring it back. */
  const [formRound, setFormRound] = useState(0);

  // Another record or none: what was asked or refused about this one is over.
  useEffect(() => {
    setAskingArchive(false);
    clearStatusProblem();
  }, [props.itemId, clearStatusProblem]);

  const changeStatus = async (status: ExpiryStatus, message: string) =>
    item !== undefined &&
    statusAction.run(async () => {
      try {
        await mutations.setStatus.mutateAsync({ id: item.id, status });
      } catch (error) {
        // The refusal says to restore: the panel catches up, so that it offers to.
        if (problemFromError(error)?.code === 'EXPIRY_ITEM_ARCHIVED') void query.refetch();
        throw error;
      }
      toast.success(message);
    });
  const askStatus = (status: ExpiryStatus, message: string) => {
    if (status === 'ARCHIVED' && props.dirty) setAskingArchive(true);
    else void changeStatus(status, message);
  };
  const archiveDropping = async () => {
    setAskingArchive(false);
    if (await changeStatus('ARCHIVED', t('expiry.panel.archivedToast'))) {
      setFormRound((round) => round + 1);
    }
  };

  return (
    <>
      <RecordSheet
        open={props.itemId !== null}
        onClose={props.onClose}
        title={item?.product.name ?? (query.isError ? t('expiry.title') : t('common.loading'))}
        {...(item ? { description: `${item.product.sku} · ${item.product.baseUomName}` } : {})}
        badges={
          item ? (
            <>
              <ExpiryStatusBadge status={item.status} />
              <DaysLeft
                daysLeft={item.daysLeft}
                urgency={item.urgency}
                className="text-[0.8125rem]"
              />
            </>
          ) : null
        }
        actions={
          item && canManage ? (
            <StatusActions
              status={item.status}
              pending={mutations.setStatus.isPending}
              onChange={askStatus}
            />
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />
          <ProblemAlert problem={statusAction.problem} />
          {item ? (
            <RecordBody
              key={`${item.id}:${formRound}`}
              item={item}
              today={props.today}
              onReload={() => void query.refetch()}
              onDirty={props.onDirty}
            />
          ) : null}
        </div>
      </RecordSheet>
      <ConfirmDialog
        open={askingArchive}
        title={t('expiry.panel.archiveDirtyTitle')}
        description={t('expiry.panel.archiveDirtyDescription')}
        confirmLabel={t('expiry.panel.archiveDirtyConfirm')}
        onConfirm={() => void archiveDropping()}
        onClose={() => setAskingArchive(false)}
      />
    </>
  );
}

/** The header's status choice and archive or restore; only holders of the right get them. */
function StatusActions(props: {
  status: ExpiryStatus;
  pending: boolean;
  onChange: (status: ExpiryStatus, message: string) => void;
}) {
  const { t } = useTranslation();
  if (props.status === 'ARCHIVED') {
    // Only REVIEW restores a record (ADR-0172 #3).
    return (
      <Button
        variant="outline"
        pending={props.pending}
        onClick={() => props.onChange('REVIEW', t('expiry.panel.restoredToast'))}
      >
        <ArchiveRestore />
        {t('expiry.panel.restore')}
      </Button>
    );
  }
  return (
    <>
      <NativeSelect
        className="w-auto"
        aria-label={t('expiry.panel.statusLabel')}
        disabled={props.pending}
        value={props.status}
        onChange={(event) => {
          const next = OPEN_STATUSES.find((status) => status === event.target.value);
          if (next) props.onChange(next, t('expiry.panel.statusToast'));
        }}
      >
        {OPEN_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`expiry.status.${status}`)}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={props.pending}
        onClick={() => props.onChange('ARCHIVED', t('expiry.panel.archivedToast'))}
      >
        <Archive />
        {t('expiry.panel.archive')}
      </Button>
    </>
  );
}

/**
 * The form's draft and the version it stands on (ADR-0172 #6, ADR-0118's rule). A newer record
 * arriving while nothing is typed is simply taken; while something is typed it changes nothing, so
 * the save is refused rather than overwriting what the person never saw. After that refusal the
 * form moves onto the new version, keeps what was typed and takes the rest, so a second press saves.
 */
function useRecordDraft(item: ExpiryItem) {
  const [read, setRead] = useState({ version: item.editVersion, values: draftOf(item) });
  const [draft, setDraft] = useState(read.values);
  const [moveOn, setMoveOn] = useState(false);
  /** A stale save was refused: the fields say what stands now, until a save goes through. */
  const [conflicted, setConflicted] = useState(false);
  if (item.editVersion > read.version) {
    const clean = isSameDraft(draft, read.values);
    if (clean || moveOn) {
      const latest = draftOf(item);
      setRead({ version: item.editVersion, values: latest });
      setDraft(clean ? latest : keepTyped(draft, read.values, latest));
      setMoveOn(false);
    }
  }
  return {
    read,
    draft,
    setDraft,
    conflicted,
    /** The answer of a save: the record as it now stands. */
    saved: (next: ExpiryItem) => {
      setRead({ version: next.editVersion, values: draftOf(next) });
      setDraft(draftOf(next));
      setMoveOn(false);
      setConflicted(false);
    },
    refused: () => {
      setMoveOn(true);
      setConflicted(true);
    },
  };
}

function RecordBody(props: {
  item: ExpiryItem;
  today: string | undefined;
  onReload: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { item, onDirty } = props;
  const archived = item.status === 'ARCHIVED';
  const form = useRecordDraft(item);
  // An archive that arrives takes the form away, not what was typed: that still counts as work.
  const dirty = !isSameDraft(form.draft, form.read.values);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <FactChips facts={factsOf(t, item)} />
        <PanelSection title={t('expiry.panel.formTitle')}>
          {archived ? (
            <div className="flex flex-col gap-3">
              {dirty ? (
                <HeldCorrection typed={changedFields(form.draft, form.read.values)} />
              ) : null}
              <ArchivedValues item={item} />
            </div>
          ) : (
            <RecordForm
              item={item}
              today={props.today}
              form={form}
              dirty={dirty}
              onReload={props.onReload}
            />
          )}
        </PanelSection>
        <LiabilitySection item={item} />
      </div>
      <PanelSection title={t('expiry.history.title')}>
        <HistoryTimeline itemId={item.id} />
      </PanelSection>
    </div>
  );
}

function factsOf(t: TFunction, item: ExpiryItem) {
  const none = t('common.none');
  return [
    { label: t('expiry.panel.sku'), value: item.product.sku },
    { label: t('expiry.panel.unit'), value: item.product.baseUomName },
    { label: t('expiry.columns.supplier'), value: item.supplier?.name ?? none },
    { label: t('expiry.panel.homeWarehouse'), value: item.homeWarehouse?.name ?? none },
    {
      label: t('expiry.columns.qtyTotal'),
      value: <span className="font-mono font-bold">{formatQty(item.qtyTotal)}</span>,
    },
    { label: t('expiry.columns.createdBy'), value: item.createdByName },
    { label: t('expiry.columns.createdAt'), value: formatUbMinute(item.createdAt) },
    { label: t('expiry.panel.updatedAt'), value: formatUbMinute(item.updatedAt) },
    ...(item.archivedAt
      ? [
          { label: t('expiry.panel.archivedBy'), value: item.archivedByName ?? none },
          { label: t('expiry.panel.archivedAt'), value: formatUbMinute(item.archivedAt) },
        ]
      : []),
  ];
}

/**
 * What was typed when the record came back archived, by whatever route (a refused save, a reload, a
 * liability's answer): nothing else on the screen holds it, and a person without the right to
 * restore can only pass it on. A restore gives the form back with it.
 */
function HeldCorrection({ typed }: { typed: Partial<RecordDraft> }) {
  const { t } = useTranslation();
  const parts = [
    { label: t('expiry.columns.expiryDate'), value: typed.expiryDate },
    { label: t('expiry.columns.qtyFloor'), value: typed.qtyFloor },
    { label: t('expiry.columns.qtyWarehouse'), value: typed.qtyWarehouse },
    { label: t('expiry.columns.note'), value: typed.note },
  ].flatMap(({ label, value }) => (value === undefined ? [] : [`${label} ${value}`]));
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {t('expiry.panel.typedNotSaved')}
        <span className="mt-1 block font-medium break-words">
          {t('expiry.panel.typed', { values: parts.join(' · ') })}
        </span>
      </AlertDescription>
    </Alert>
  );
}

/** An archived record's values, read-only until it is restored (ADR-0172 #3). */
function ArchivedValues({ item }: { item: ExpiryItem }) {
  const { t } = useTranslation();
  const unit = item.product.baseUomName;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.8125rem] text-muted-foreground">{t('expiry.panel.archivedNote')}</p>
      <FactChips
        facts={[
          { label: t('expiry.columns.expiryDate'), value: item.expiryDate },
          { label: t('expiry.fields.floor', { unit }), value: formatQty(item.qtyFloor) },
          { label: t('expiry.fields.warehouse', { unit }), value: formatQty(item.qtyWarehouse) },
          ...(item.note ? [{ label: t('expiry.columns.note'), value: item.note }] : []),
        ]}
      />
    </div>
  );
}

function RecordForm(props: {
  item: ExpiryItem;
  today: string | undefined;
  form: ReturnType<typeof useRecordDraft>;
  dirty: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const { item, today, form, dirty } = props;
  const { draft, read, conflicted } = form;
  const unit = item.product.baseUomName;
  const mutations = useExpiryMutations();
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const [shown, setShown] = useState(false);
  const problems = draftProblems(draft, read.values, today);
  const invalid = Object.keys(problems).length > 0;
  const set = (field: keyof RecordDraft, value: string) =>
    form.setDraft({ ...draft, [field]: value });

  const save = async () => {
    setShown(true);
    if (invalid) return;
    setProblem(null);
    try {
      const saved = await mutations.patch.mutateAsync({
        id: item.id,
        body: { expectedVersion: read.version, ...changedFields(draft, read.values) },
      });
      form.saved(saved);
      setShown(false);
      toast.success(t('expiry.panel.savedToast'));
    } catch (error) {
      const refused = problemFromError(error);
      setProblem(refused);
      // Only a stale version moves the form on. An archive says nothing of the version: the form
      // stays on the one it read, so that after a restore a later edit is refused, not overwritten.
      if (refused?.code === 'EXPIRY_ITEM_CHANGED') form.refused();
      if (refused?.code === 'EXPIRY_ITEM_CHANGED' || refused?.code === 'EXPIRY_ITEM_ARCHIVED') {
        props.onReload();
      }
    }
  };

  const days = today && isIsoDate(draft.expiryDate) ? daysBetween(today, draft.expiryDate) : null;
  /** After a refusal, what stands now beside a field whose typed value differs from it. */
  const standing = (typed: boolean, value: string) =>
    conflicted && typed ? t('expiry.panel.currentValue', { value }) : undefined;

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <ProblemAlert problem={problem} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField
          label={t('expiry.columns.expiryDate')}
          htmlFor="expiry-item-date"
          hint={
            standing(draft.expiryDate !== read.values.expiryDate, read.values.expiryDate) ??
            (days === null ? undefined : <DaysLeft daysLeft={days} urgency={expiryUrgency(days)} />)
          }
          error={shown ? problems.expiryDate : undefined}
        >
          <DateInput
            id="expiry-item-date"
            value={draft.expiryDate}
            onChange={(value) => set('expiryDate', value)}
            {...(today ? expiryDateBounds(today) : {})}
          />
        </FormField>
        <FormField
          label={t('expiry.fields.floor', { unit })}
          htmlFor="expiry-item-floor"
          hint={standing(!sameQty(draft.qtyFloor, read.values.qtyFloor), read.values.qtyFloor)}
          error={shown ? problems.qtyFloor : undefined}
        >
          <Input
            id="expiry-item-floor"
            inputMode="decimal"
            autoComplete="off"
            className="text-right font-mono"
            value={draft.qtyFloor}
            onChange={(event) => set('qtyFloor', event.target.value)}
          />
        </FormField>
        <FormField
          label={t('expiry.fields.warehouse', { unit })}
          htmlFor="expiry-item-warehouse"
          hint={standing(
            !sameQty(draft.qtyWarehouse, read.values.qtyWarehouse),
            read.values.qtyWarehouse,
          )}
          error={shown ? problems.qtyWarehouse : undefined}
        >
          <Input
            id="expiry-item-warehouse"
            inputMode="decimal"
            autoComplete="off"
            className="text-right font-mono"
            value={draft.qtyWarehouse}
            onChange={(event) => set('qtyWarehouse', event.target.value)}
          />
        </FormField>
      </div>
      <FormField
        label={t('expiry.columns.note')}
        htmlFor="expiry-item-note"
        hint={standing(draft.note.trim() !== read.values.note.trim(), read.values.note)}
      >
        <Textarea
          id="expiry-item-note"
          rows={2}
          maxLength={EXPIRY_NOTE_MAX}
          value={draft.note}
          onChange={(event) => set('note', event.target.value)}
        />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" pending={mutations.patch.isPending} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function LiabilitySection({ item }: { item: ExpiryItem }) {
  const { t } = useTranslation();
  const canAssign = useHasPermission('expiry.liability.manage');
  const [assigning, setAssigning] = useState(false);
  const { liability } = item;
  return (
    <PanelSection title={t('expiry.liability.section')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1 text-[0.8125rem]">
          <LiabilityTypeBadge liability={liability} />
          {liability.type === 'SPECIFIC' && liability.roles.length > 0 ? (
            <span>
              <span className="text-muted-foreground">{t('expiry.liability.roles')}: </span>
              {liability.roles.map((role, index) => (
                <span key={role.id}>
                  {index > 0 ? ', ' : null}
                  <RoleName role={role} />
                </span>
              ))}
            </span>
          ) : null}
          {liability.type === 'SPECIFIC' && liability.users.length > 0 ? (
            <span>
              <span className="text-muted-foreground">{t('expiry.liability.people')}: </span>
              {liability.users.map((user) => user.fullName).join(', ')}
            </span>
          ) : null}
          {liability.note ? (
            <span className="break-words whitespace-pre-wrap text-muted-foreground">
              {liability.note}
            </span>
          ) : null}
        </div>
        {canAssign ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAssigning(true)}>
            <Users />
            {t('expiry.liability.assign')}
          </Button>
        ) : null}
      </div>
      {assigning ? <ExpiryLiabilityDialog item={item} onClose={() => setAssigning(false)} /> : null}
    </PanelSection>
  );
}

/** The quantity history, oldest first: the old value struck through and the new one in bold. */
function HistoryTimeline({ itemId }: { itemId: number }) {
  const { t } = useTranslation();
  const history = useExpiryHistory(itemId);
  const rows = history.data?.data ?? [];
  if (history.error) {
    return <ProblemAlert problem={problemFromError(history.error)} onRetry={history.refetch} />;
  }
  if (history.isPending) {
    return <p className="text-[0.8125rem] text-muted-foreground">{t('common.loading')}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-[0.8125rem] text-muted-foreground">{t('expiry.history.empty')}</p>;
  }
  return (
    <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <span
            aria-hidden
            className={
              row.kind === 'CREATE'
                ? 'absolute top-1 -left-[1.4rem] size-2.5 rounded-full bg-primary ring-2 ring-background'
                : 'absolute top-1 -left-[1.4rem] size-2.5 rounded-full bg-success ring-2 ring-background'
            }
          />
          <HistoryLine row={row} />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.changedByName} · {formatUbMinute(row.changedAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function HistoryLine({ row }: { row: ExpiryChange }) {
  const { t } = useTranslation();
  const floorChanged = !sameQty(row.qtyFloorOld, row.qtyFloorNew);
  const warehouseChanged = !sameQty(row.qtyWarehouseOld, row.qtyWarehouseNew);
  const standing = t('expiry.history.qty', {
    floor: formatQty(row.qtyFloorNew),
    warehouse: formatQty(row.qtyWarehouseNew),
  });
  if (row.kind === 'CREATE') {
    return (
      <p className="text-[0.8125rem]">
        <span className="font-medium text-link">{t('expiry.history.created')}</span> · {standing}
      </p>
    );
  }
  if (!floorChanged && !warehouseChanged) return <p className="text-[0.8125rem]">{standing}</p>;
  return (
    <p className="flex flex-wrap gap-x-2 text-[0.8125rem]">
      {floorChanged ? (
        <HistoryChange
          label={t('expiry.history.floor')}
          before={row.qtyFloorOld}
          after={row.qtyFloorNew}
        />
      ) : null}
      {warehouseChanged ? (
        <HistoryChange
          label={t('expiry.history.warehouse')}
          before={row.qtyWarehouseOld}
          after={row.qtyWarehouseNew}
        />
      ) : null}
    </p>
  );
}

function HistoryChange(props: { label: string; before: string; after: string }) {
  return (
    <span>
      {props.label}: <s className="font-mono text-muted-foreground">{formatQty(props.before)}</s>
      {' → '}
      <b className="font-mono">{formatQty(props.after)}</b>
    </span>
  );
}
