import {
  ATTENDANCE_KINDS,
  PUNCH_GROUPS,
  REQUEST_GROUPS,
  REQUEST_STATUSES,
  type RequestGroup,
  type RequestStatus,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { Ban, Check, ClipboardList, ListChecks, Pencil, Plus, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { Combobox } from '@/components/combobox';
import { DateInput, TimeInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  RowActionSpacer,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute, ubInstant } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { Avatar } from './hr-kit';
import { useRequestLength, useRequestWhen } from './request-helpers';
import {
  type HrRequestType,
  type HrTimeRequest,
  useRequestTypes,
  useStaff,
  useTimeRequests,
  useWorkforceMutations,
} from './workforce-api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VARIANT = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
} as const satisfies Record<RequestStatus, string>;

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 12 },
  { key: 'type', kind: 'text', weight: 2, min: 9 },
  { key: 'when', kind: 'text', weight: 2, min: 10 },
  { key: 'length', kind: 'code', width: 7 },
  { key: 'note', kind: 'text', weight: 2, min: 8 },
  { key: 'status', kind: 'status', width: 9 },
  { key: 'createdAt', kind: 'datetime' },
  { key: 'actions', kind: 'actions', actions: 3 },
];

function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`hr.requestStatuses.${status}`)}</Badge>;
}

/* ------------------------------------------------------------------ decide */

function DecideDialog(props: {
  target: { request: HrTimeRequest; approve: boolean } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const when = useRequestWhen();
  const [note, setNote] = useState('');
  const target = props.target;
  const close = () => {
    action.clear();
    setNote('');
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    const ok = await action.run(() =>
      mutations.decide.mutateAsync({
        id: target.request.id,
        approve: target.approve,
        note: note.trim() || null,
      }),
    );
    if (ok) {
      toast.success(target.approve ? t('hr.requests.approved') : t('hr.requests.rejected'));
      close();
    }
  };
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('hr.requests.decideTitle')}</DialogTitle>
          {target ? (
            <DialogDescription>
              {target.request.fullName} · {target.request.typeName} · {when(target.request)}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          {target?.request.note ? (
            <p className="rounded-lg bg-fill px-3 py-2 text-[0.8125rem]">{target.request.note}</p>
          ) : null}
          <FormField label={t('hr.requests.decisionNote')} htmlFor="decision-note">
            <Textarea
              id="decision-note"
              maxLength={WORKFORCE_LIMITS.maxDecisionNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.decide.isPending}
            onCancel={close}
            submitLabel={target?.approve ? t('hr.requests.approve') : t('hr.requests.reject')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ create */

/**
 * «Хүсэлт нэмэх»: a request typed for an employee (HR) or by oneself — whole days take a from–to
 * range, hour types a day with the hours, a missed punch the kind and the moment.
 */
function RequestCreateDialog(props: {
  onClose: () => void;
  /** HR may name the employee; without it the request is the signed-in user's own. */
  chooseEmployee: boolean;
}) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const types = useRequestTypes();
  const staff = useStaff();
  const action = useAction();
  const [key] = useState(randomUuid);
  const today = businessDate();
  const [userId, setUserId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [punchKind, setPunchKind] = useState<'IN' | 'OUT'>('IN');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState<{ userId?: string; typeId?: string }>({});
  const activeTypes = (types.data ?? []).filter((type) => type.active);
  const type = activeTypes.find((entry) => String(entry.id) === typeId) ?? null;
  const punch = type ? PUNCH_GROUPS.includes(type.group) : false;
  const sentNow = type?.group === 'PUNCH_SENT';
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof missing = {};
    if (props.chooseEmployee && userId === '') next.userId = 'validation.required';
    if (!type) next.typeId = 'validation.required';
    setMissing(next);
    if (next.userId || next.typeId || !type) return;
    const base = {
      key,
      ...(props.chooseEmployee ? { userId: Number(userId) } : {}),
      typeId: type.id,
      fromDate,
      note: note.trim() || null,
    };
    const body = punch
      ? {
          ...base,
          startsAt: sentNow ? null : ubInstant(fromDate, start),
          punchKind,
        }
      : type.wholeDays
        ? { ...base, toDate }
        : { ...base, startsAt: ubInstant(fromDate, start), endsAt: ubInstant(fromDate, end) };
    const ok = await action.run(() => mutations.createRequest.mutateAsync(body));
    if (ok) {
      toast.success(t('hr.requests.dialog.created'));
      close();
    }
  };
  const employeeOptions = useMemo(
    () =>
      (staff.data ?? [])
        .filter((row) => row.leftOn === null)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'))
        .map((row) => ({
          value: String(row.userId),
          label: row.fullName,
          hint: row.divisionName ?? undefined,
        })),
    [staff.data],
  );
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{t('hr.requests.dialog.title')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          {props.chooseEmployee ? (
            <FormField label={t('hr.requests.dialog.employee')} error={missing.userId}>
              <Combobox
                aria-label={t('hr.requests.dialog.employee')}
                className="w-full"
                value={userId}
                options={employeeOptions}
                emptyLabel={t('hr.requests.allEmployees')}
                onChange={(value) => {
                  setMissing((prev) => ({ ...prev, userId: undefined }));
                  setUserId(value);
                }}
              />
            </FormField>
          ) : null}
          <FormField
            label={t('hr.requests.dialog.type')}
            htmlFor="request-type"
            error={missing.typeId}
          >
            <NativeSelect
              id="request-type"
              value={typeId}
              onChange={(event) => {
                setMissing((prev) => ({ ...prev, typeId: undefined }));
                setTypeId(event.target.value);
              }}
            >
              <option value="" disabled>
                {t('hr.requests.allTypes')}
              </option>
              {activeTypes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {type ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {sentNow ? null : (
                <FormField
                  label={
                    type.wholeDays && !punch
                      ? t('hr.requests.dialog.fromDate')
                      : t('hr.requests.dialog.date')
                  }
                  htmlFor="request-from"
                >
                  <DateInput
                    id="request-from"
                    required
                    max={punch ? today : undefined}
                    value={fromDate}
                    onChange={(value) => {
                      setFromDate(value);
                      if (toDate < value) setToDate(value);
                    }}
                  />
                </FormField>
              )}
              {punch ? (
                <>
                  <FormField label={t('hr.requests.dialog.punchKind')} htmlFor="request-punch">
                    <NativeSelect
                      id="request-punch"
                      value={punchKind}
                      onChange={(event) => setPunchKind(event.target.value as 'IN' | 'OUT')}
                    >
                      {ATTENDANCE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`hr.kinds.${kind}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  {sentNow ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      {t('hr.requests.dialog.sentNow')}
                    </p>
                  ) : (
                    <FormField label={t('hr.requests.dialog.punchTime')} htmlFor="request-time">
                      <TimeInput id="request-time" required value={start} onChange={setStart} />
                    </FormField>
                  )}
                </>
              ) : type.wholeDays ? (
                <FormField label={t('hr.requests.dialog.toDate')} htmlFor="request-to">
                  <DateInput
                    id="request-to"
                    required
                    min={fromDate}
                    value={toDate}
                    onChange={setToDate}
                  />
                </FormField>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t('hr.requests.dialog.start')} htmlFor="request-start">
                    <TimeInput id="request-start" required value={start} onChange={setStart} />
                  </FormField>
                  <FormField label={t('hr.requests.dialog.end')} htmlFor="request-end">
                    <TimeInput id="request-end" required value={end} onChange={setEnd} />
                  </FormField>
                </div>
              )}
            </div>
          ) : null}
          <FormField label={t('hr.requests.dialog.note')} htmlFor="request-note">
            <Textarea
              id="request-note"
              maxLength={WORKFORCE_LIMITS.maxRequestNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.createRequest.isPending}
            onCancel={close}
            submitLabel={t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ types */

interface TypeDraft {
  id: number | null;
  name: string;
  group: RequestGroup;
  color: string;
  wholeDays: boolean;
  active: boolean;
  sort: number;
}

function TypesDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const types = useRequestTypes();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [editing, setEditing] = useState<TypeDraft | null>(null);
  const rows = types.data ?? [];
  const startEdit = (type: HrRequestType | null) =>
    setEditing(
      type
        ? { ...type }
        : {
            id: null,
            name: '',
            group: 'NOT_WORKED',
            color: '#64748b',
            wholeDays: true,
            active: true,
            sort: rows.reduce((max, row) => Math.max(max, row.sort), 0) + 1,
          },
    );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || editing.name.trim() === '') return;
    const draft = editing;
    const ok = await action.run(() =>
      mutations.saveRequestType.mutateAsync({ ...draft, name: draft.name.trim() }),
    );
    if (ok) {
      toast.success(
        draft.id === null
          ? t('hr.requests.typesDialog.created')
          : t('hr.requests.typesDialog.saved'),
      );
      setEditing(null);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <DialogHeader>
          <DialogTitle>{t('hr.requests.typesDialog.title')}</DialogTitle>
          <DialogDescription>{t('hr.requests.typesDialog.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(types.error)} />
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.requests.typesDialog.name')}</TableHead>
                <TableHead>{t('hr.requests.typesDialog.group')}</TableHead>
                <TableHead>{t('hr.requests.typesDialog.wholeDays')}</TableHead>
                <TableHead>{t('hr.requests.typesDialog.active')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((type) => (
                <TableRow
                  key={type.id}
                  className={type.active ? undefined : 'text-muted-foreground'}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: type.color }}
                      />
                      {type.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-[0.8125rem]">
                    {t(`hr.requestGroups.${type.group}`)}
                  </TableCell>
                  <TableCell>{type.wholeDays ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>{type.active ? t('common.yes') : t('common.no')}</TableCell>
                  <RowActions>
                    <RowAction
                      label={t('hr.requests.typesDialog.editFor', { name: type.name })}
                      icon={Pencil}
                      onClick={() => startEdit(type)}
                    />
                  </RowActions>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {editing ? (
          <form
            className="flex flex-col gap-3 rounded-lg border p-3"
            noValidate
            onSubmit={(event) => void save(event)}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <FormField label={t('hr.requests.typesDialog.name')} htmlFor="type-name">
                <Input
                  id="type-name"
                  autoFocus
                  maxLength={WORKFORCE_LIMITS.maxName}
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </FormField>
              <FormField label={t('hr.requests.typesDialog.group')} htmlFor="type-group">
                <NativeSelect
                  id="type-group"
                  value={editing.group}
                  onChange={(event) =>
                    setEditing({ ...editing, group: event.target.value as RequestGroup })
                  }
                >
                  {REQUEST_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {t(`hr.requestGroups.${group}`)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t('hr.requests.typesDialog.color')} htmlFor="type-color">
                <Input
                  id="type-color"
                  type="color"
                  className="h-10 w-16 p-1"
                  value={editing.color}
                  onChange={(event) => setEditing({ ...editing, color: event.target.value })}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-4">
              <Label htmlFor="type-whole" className="flex items-center gap-2 font-normal">
                <Checkbox
                  id="type-whole"
                  checked={editing.wholeDays}
                  onCheckedChange={(next) => setEditing({ ...editing, wholeDays: next === true })}
                />
                {t('hr.requests.typesDialog.wholeDays')}
              </Label>
              <Label htmlFor="type-active" className="flex items-center gap-2 font-normal">
                <Checkbox
                  id="type-active"
                  checked={editing.active}
                  onCheckedChange={(next) => setEditing({ ...editing, active: next === true })}
                />
                {t('hr.requests.typesDialog.active')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('hr.requests.typesDialog.wholeDaysHint')}
            </p>
            <DialogFormFooter
              pending={mutations.saveRequestType.isPending}
              onCancel={() => setEditing(null)}
              disabled={editing.name.trim() === ''}
            />
          </form>
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => startEdit(null)}>
              <Plus />
              {t('hr.requests.typesDialog.add')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * «Цагийн хүсэлт» (ADR-0144): the employees' time requests — leave, trips, overtime, missed punches
 * — narrowed by status, type, employee and dates (the filters in the URL). HR approves (an approved
 * punch becomes the punch) or rejects with a note, adds a request for an employee and keeps the
 * types; a pending request can be cancelled by its sender.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const auth = useAuthState();
  const myId = auth.status === 'authenticated' ? auth.me.id : null;
  const canManage = useHasPermission('hr.attendance.manage');
  const types = useRequestTypes();
  const staff = useStaff();
  const when = useRequestWhen();
  const length = useRequestLength();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const creating = { open: creatingOpen, setOpen: setCreatingOpen };
  const [editingTypes, setEditingTypes] = useState(false);
  const [deciding, setDeciding] = useState<{ request: HrTimeRequest; approve: boolean } | null>(
    null,
  );
  const statusParam = search.get('status');
  const status = REQUEST_STATUSES.find((value) => value === statusParam);
  const typeParam = search.get('type') ?? '';
  const userParam = search.get('userId') ?? '';
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const requests = useTimeRequests({
    status,
    typeId: /^\d+$/.test(typeParam) ? Number(typeParam) : undefined,
    userId: /^\d+$/.test(userParam) ? Number(userParam) : undefined,
    from: DATE.test(from) ? from : undefined,
    to: DATE.test(to) ? to : undefined,
  });
  const photos = useMemo(
    () => new Map((staff.data ?? []).map((row) => [row.userId, row.photoUrl])),
    [staff.data],
  );
  const rows = requests.data ?? [];
  const filtered =
    Boolean(status) || typeParam !== '' || userParam !== '' || from !== '' || to !== '';

  const cancel = async (request: HrTimeRequest) => {
    const ok = await action.run(() => mutations.cancel.mutateAsync(request.id));
    if (ok) toast.success(t('hr.requests.cancelled'));
  };

  return (
    <div>
      <PageHeader
        title={t('hr.requests.title')}
        description={t('hr.requests.description')}
        actions={
          <>
            {canManage ? (
              <Button variant="outline" size="sm" onClick={() => setEditingTypes(true)}>
                <ListChecks />
                {t('hr.requests.types')}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => creating.setOpen(true)}>
              <Plus />
              {t('hr.requests.create')}
            </Button>
          </>
        }
      />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('hr.requests.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value || null)}
        >
          <option value="">{t('hr.requests.allStatuses')}</option>
          {REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.requestStatuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('hr.requests.type')}
          value={typeParam}
          onChange={(event) => setParam('type', event.target.value || null)}
        >
          <option value="">{t('hr.requests.allTypes')}</option>
          {(types.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </NativeSelect>
        <Combobox
          aria-label={t('hr.requests.employee')}
          value={userParam}
          emptyLabel={t('hr.requests.allEmployees')}
          options={(staff.data ?? []).map((row) => ({
            value: String(row.userId),
            label: row.fullName,
            hint: row.divisionName ?? undefined,
          }))}
          onChange={(value) => setParam('userId', value || null)}
        />
        <DateFilter
          label={t('hr.requests.from')}
          value={from || undefined}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('hr.requests.to')}
          value={to || undefined}
          onChange={(value) => setParam('to', value ?? null)}
        />
      </FilterBar>
      <ProblemAlert
        problem={action.problem ?? problemFromError(requests.error)}
        onRetry={requests.refetch}
      />
      <ListCard scroll>
        {requests.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('hr.requests.noMatch') : t('hr.requests.empty')}
            icon={ClipboardList}
            onClearFilters={
              filtered
                ? () => {
                    for (const key of ['status', 'type', 'userId', 'from', 'to'])
                      setParam(key, null);
                  }
                : undefined
            }
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.requests.columns.employee')}</TableHead>
                <TableHead>{t('hr.requests.columns.type')}</TableHead>
                <TableHead>{t('hr.requests.columns.when')}</TableHead>
                <TableHead>{t('hr.requests.columns.length')}</TableHead>
                <TableHead>{t('hr.requests.columns.note')}</TableHead>
                <TableHead>{t('hr.requests.columns.status')}</TableHead>
                <TableHead>{t('hr.requests.columns.createdAt')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.isPending ? <SkeletonRows columns={8} /> : null}
              {rows.map((request) => {
                const pendingRow = request.status === 'PENDING';
                const own = request.userId === myId;
                return (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar
                          name={request.fullName}
                          src={photos.get(request.userId) ?? null}
                          className="size-7 text-[0.6875rem]"
                        />
                        <span className="truncate font-medium">{request.fullName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: request.color }}
                        />
                        <span className="truncate">{request.typeName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">{when(request)}</TableCell>
                    <TableCell className="font-mono">{length(request)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block truncate" title={request.note ?? undefined}>
                        {request.note ?? t('common.none')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        title={
                          request.decidedBy && request.decidedAt
                            ? `${t('hr.requests.decidedBy', {
                                name: request.decidedBy,
                                at: formatUbMinute(request.decidedAt),
                              })}${request.decisionNote ? ` — ${request.decisionNote}` : ''}`
                            : undefined
                        }
                      >
                        <RequestStatusBadge status={request.status} />
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      {formatUbMinute(request.createdAt)}
                    </TableCell>
                    <RowActions>
                      {canManage && pendingRow ? (
                        <>
                          <RowAction
                            label={t('hr.requests.approveFor', { name: request.fullName })}
                            icon={Check}
                            onClick={() => setDeciding({ request, approve: true })}
                          />
                          <RowAction
                            label={t('hr.requests.rejectFor', { name: request.fullName })}
                            icon={X}
                            destructive
                            onClick={() => setDeciding({ request, approve: false })}
                          />
                        </>
                      ) : (
                        <>
                          <RowActionSpacer />
                          <RowActionSpacer />
                        </>
                      )}
                      {pendingRow && (own || canManage) ? (
                        <RowAction
                          label={t('hr.requests.cancelFor', { name: request.fullName })}
                          icon={Ban}
                          onClick={() => void cancel(request)}
                        />
                      ) : (
                        <RowActionSpacer />
                      )}
                    </RowActions>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      <DecideDialog target={deciding} onClose={() => setDeciding(null)} />
      {creating.open ? (
        <RequestCreateDialog chooseEmployee={canManage} onClose={() => creating.setOpen(false)} />
      ) : null}
      {editingTypes ? <TypesDialog onClose={() => setEditingTypes(false)} /> : null}
    </div>
  );
}
