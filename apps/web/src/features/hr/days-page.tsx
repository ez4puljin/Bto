import { ATTENDANCE_KINDS, HR_LIMITS } from '@tugeel/shared/hr';
import { addDays, businessDate, businessMonthStart } from '@tugeel/shared/time';
import { CalendarCheck, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ButtonRow,
  ChevronHead,
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordSheet } from '@/components/record-sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { formatUbTime, ubInstant } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type AttendanceDay,
  type AttendanceEvent,
  type DayStatus,
  type HrEmployee,
  useAttendanceCorrections,
  useAttendanceDays,
  useAttendanceEvents,
  useHrEmployees,
} from './api';
import { useWorded } from './hr-helpers';
import { StatusBadge, TimeCell } from './hr-kit';

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'OFF'] as const satisfies readonly DayStatus[];
const MAX_DAYS = 62;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date' },
  { key: 'employee', kind: 'text', weight: 3, min: 12 },
  { key: 'firstIn', kind: 'code', width: 5 },
  { key: 'lastOut', kind: 'code', width: 5 },
  { key: 'worked', kind: 'code', width: 7.5 },
  { key: 'late', kind: 'code', width: 6 },
  { key: 'status', kind: 'status', width: 11 },
  { key: 'site', kind: 'text', weight: 2, min: 8 },
  { key: 'chevron', kind: 'chevron' },
];

/** The employee picker's order: the tracked and active first, then the rest, each by name. */
function sortedEmployees(employees: readonly HrEmployee[]): HrEmployee[] {
  const rank = (e: HrEmployee) =>
    e.tracked && e.status === 'ACTIVE' ? 0 : e.status === 'ACTIVE' ? 1 : 2;
  return [...employees].sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));
}

/* ------------------------------------------------------------------ events sheet */

/** «Бүртгэл нэмэх»: an OFFICE correction typed by HR — the kind, the time on that day, a note. */
function AddEventDialog(props: {
  open: boolean;
  onClose: () => void;
  userId: number;
  date: string;
}) {
  const { t } = useTranslation();
  const { addEvent } = useAttendanceCorrections();
  const action = useAction();
  const [kind, setKind] = useState<(typeof ATTENDANCE_KINDS)[number]>('IN');
  const [time, setTime] = useState('09:00');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{
    time?: 'validation.required';
    note?: 'validation.required';
  }>({});
  const close = () => {
    action.clear();
    setErrors({});
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!time) next.time = 'validation.required';
    if (note.trim() === '') next.note = 'validation.required';
    setErrors(next);
    if (next.time || next.note) return;
    const ok = await action.run(() =>
      addEvent.mutateAsync({
        userId: props.userId,
        kind,
        at: ubInstant(props.date, time),
        note: note.trim(),
      }),
    );
    if (ok) {
      toast.success(t('hr.days.sheet.added'));
      setNote('');
      close();
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('hr.days.sheet.add')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField label={t('hr.days.sheet.kind')} htmlFor="event-kind">
            <NativeSelect
              id="event-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as (typeof ATTENDANCE_KINDS)[number])}
            >
              {ATTENDANCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`hr.kinds.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('hr.days.sheet.time')} htmlFor="event-time" error={errors.time}>
            <Input
              id="event-time"
              type="time"
              className="font-mono sm:w-40"
              value={time}
              onChange={(event) => {
                setErrors((prev) => ({ ...prev, time: undefined }));
                setTime(event.target.value);
              }}
            />
          </FormField>
          <FormField label={t('hr.days.sheet.note')} htmlFor="event-note" error={errors.note}>
            <Textarea
              id="event-note"
              maxLength={HR_LIMITS.maxNote}
              value={note}
              onChange={(event) => {
                setErrors((prev) => ({ ...prev, note: undefined }));
                setNote(event.target.value);
              }}
            />
          </FormField>
          <DialogFormFooter
            pending={addEvent.isPending}
            onCancel={close}
            submitLabel={t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «Хасах»: strikes an event out with a reason; the row stays in the history crossed through. */
function StrikeDialog(props: { event: AttendanceEvent | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { strikeEvent } = useAttendanceCorrections();
  const action = useAction();
  const [reason, setReason] = useState('');
  const event = props.event;
  const close = () => {
    action.clear();
    setReason('');
    props.onClose();
  };
  return (
    <ConfirmDialog
      open={event !== null}
      title={t('hr.days.sheet.strikeTitle')}
      description={
        event
          ? t('hr.days.sheet.strikeDescription', {
              time: formatUbTime(event.at),
              kind: t(`hr.kinds.${event.kind}`),
            })
          : undefined
      }
      confirmLabel={t('hr.days.sheet.strike')}
      initialFocus="first"
      pending={strikeEvent.isPending}
      disabled={reason.trim() === ''}
      problem={action.problem}
      onClose={close}
      onConfirm={() =>
        void (async () => {
          if (!event) return;
          const ok = await action.run(() =>
            strikeEvent.mutateAsync({ id: event.id, reason: reason.trim() }),
          );
          if (ok) {
            toast.success(t('hr.days.sheet.struckOut'));
            close();
          }
        })()
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="strike-reason">{t('hr.days.sheet.reason')}</Label>
        <Textarea
          id="strike-reason"
          maxLength={HR_LIMITS.maxNote}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/** One person's day: every event, the struck-out ones crossed through with their reason. */
function EventsSheet(props: {
  open: { userId: number; date: string; name: string } | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const events = useAttendanceEvents(props.open?.userId ?? null, props.open?.date ?? null);
  const [adding, setAdding] = useState(false);
  const [striking, setStriking] = useState<AttendanceEvent | null>(null);
  const open = props.open;
  return (
    <RecordSheet
      open={open !== null}
      onClose={props.onClose}
      title={open ? t('hr.days.sheet.title', { name: open.name, date: open.date }) : ''}
      description={t('hr.days.events')}
      actions={
        props.canManage && open ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            {t('hr.days.sheet.add')}
          </Button>
        ) : undefined
      }
    >
      <ProblemAlert problem={problemFromError(events.error)} onRetry={events.refetch} />
      {events.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : null}
      {events.data && events.data.length === 0 ? (
        <EmptyState title={t('hr.days.sheet.empty')} icon={CalendarCheck} />
      ) : null}
      {events.data && events.data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('hr.days.sheet.time')}</TableHead>
              <TableHead>{t('hr.days.sheet.kind')}</TableHead>
              <TableHead>{t('hr.days.sheet.source')}</TableHead>
              <TableHead>{t('hr.days.sheet.site')}</TableHead>
              <TableHead className="text-right">{t('hr.days.sheet.distance')}</TableHead>
              <TableHead>{t('hr.days.sheet.note')}</TableHead>
              {props.canManage ? (
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.data.map((event) => {
              const struck = event.deletedAt !== null;
              const time = formatUbTime(event.at);
              const kind = t(`hr.kinds.${event.kind}`);
              return (
                <TableRow key={event.id} className={cn(struck && 'text-muted-foreground')}>
                  <TableCell className={cn('font-mono', struck && 'line-through')}>
                    {time}
                  </TableCell>
                  <TableCell className={cn(struck && 'line-through')}>
                    {struck ? (
                      kind
                    ) : (
                      <Badge variant={event.kind === 'IN' ? 'success' : 'secondary'}>{kind}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{t(`hr.sources.${event.source}`)}</TableCell>
                  <TableCell>{event.siteName ?? t('common.none')}</TableCell>
                  <TableCell className="text-right font-mono">
                    {event.distanceM === null
                      ? t('common.none')
                      : t('hr.days.sheet.distanceValue', { m: event.distanceM })}
                  </TableCell>
                  <TableCell className="max-w-64">
                    {event.note ? (
                      <span className="block truncate" title={event.note}>
                        {event.note}
                      </span>
                    ) : null}
                    {struck ? (
                      <span className="block text-[0.75rem] text-destructive">
                        {t('hr.days.sheet.struckReason', { reason: event.deleteReason ?? '' })}
                      </span>
                    ) : null}
                  </TableCell>
                  {props.canManage ? (
                    <TableCell className="w-px py-0.5 text-right whitespace-nowrap">
                      {struck ? null : (
                        <RowAction
                          label={t('hr.days.sheet.strikeFor', { time, kind })}
                          icon={Trash2}
                          destructive
                          onClick={() => setStriking(event)}
                        />
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {open ? (
        <AddEventDialog
          open={adding}
          onClose={() => setAdding(false)}
          userId={open.userId}
          date={open.date}
        />
      ) : null}
      <StrikeDialog event={striking} onClose={() => setStriking(null)} />
    </RecordSheet>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * «Ирцийн бүртгэл» (ADR-0131, hr.attendance.view): the day log of a period — one row per person
 * and day — narrowed by employee and status; a row opens the day's events, where HR adds an
 * OFFICE correction or strikes an event out. The filters live in the URL.
 */
export function AttendanceDaysPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('hr.attendance.manage');
  const worded = useWorded();
  const today = businessDate();
  const from = search.get('from') ?? businessMonthStart();
  const to = search.get('to') ?? today;
  const userParam = search.get('userId');
  const userId = userParam && /^\d+$/.test(userParam) ? Number(userParam) : undefined;
  const statusParam = search.get('status');
  const status = STATUSES.find((value) => value === statusParam);
  const validRange = DATE.test(from) && DATE.test(to) && from <= to;
  const tooLong = validRange && addDays(from, MAX_DAYS) < to;
  const employees = useHrEmployees();
  const days = useAttendanceDays(from, to, userId, validRange && !tooLong);
  const [open, setOpen] = useState<{ userId: number; date: string; name: string } | null>(null);

  const names = new Map((employees.data ?? []).map((e) => [e.userId, e.fullName]));
  const nameOf = (id: number) => names.get(id) ?? `#${id}`;
  const rows = (days.data ?? []).filter((row: AttendanceDay) => !status || row.status === status);

  return (
    <div>
      <PageHeader title={t('hr.days.title')} description={t('hr.days.description')} />
      <FilterBar>
        <DateFilter
          label={t('hr.days.from')}
          value={from}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('hr.days.to')}
          value={to}
          onChange={(value) => setParam('to', value ?? null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('hr.days.employee')}
          value={userId === undefined ? '' : String(userId)}
          onChange={(event) => setParam('userId', event.target.value || null)}
        >
          <option value="">{t('hr.days.allEmployees')}</option>
          {sortedEmployees(employees.data ?? []).map((employee) => (
            <option key={employee.userId} value={employee.userId}>
              {employee.fullName}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('hr.days.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value || null)}
        >
          <option value="">{t('hr.days.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      {tooLong ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{t('hr.days.rangeTooLong')}</AlertDescription>
        </Alert>
      ) : null}
      <ProblemAlert
        problem={problemFromError(days.error ?? employees.error)}
        onRetry={days.refetch}
      />
      <ListCard scroll>
        {days.data && rows.length === 0 ? (
          <EmptyState
            title={t('hr.days.empty')}
            icon={CalendarCheck}
            onClearFilters={
              userId !== undefined || status
                ? () => {
                    setParam('userId', null);
                    setParam('status', null);
                  }
                : undefined
            }
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.days.columns.date')}</TableHead>
                <TableHead>{t('hr.days.columns.employee')}</TableHead>
                <TableHead>{t('hr.days.columns.firstIn')}</TableHead>
                <TableHead>{t('hr.days.columns.lastOut')}</TableHead>
                <TableHead>{t('hr.days.columns.worked')}</TableHead>
                <TableHead>{t('hr.days.columns.late')}</TableHead>
                <TableHead>{t('hr.days.columns.status')}</TableHead>
                <TableHead>{t('hr.days.columns.site')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.isPending ? <SkeletonRows columns={9} /> : null}
              {rows.map((row) => {
                const name = nameOf(row.userId);
                const openRow = () => setOpen({ userId: row.userId, date: row.date, name });
                return (
                  <ButtonRow key={`${row.userId}:${row.date}`} onOpen={openRow}>
                    <TableCell className="font-mono">
                      <button
                        type="button"
                        className="text-link underline-offset-2 outline-none hover:underline focus-visible:underline"
                        aria-label={t('hr.days.rowMenu', { name, date: row.date })}
                        onClick={openRow}
                      >
                        {row.date}
                      </button>
                    </TableCell>
                    <TableCell className="truncate font-medium">{name}</TableCell>
                    <TableCell className="font-mono">
                      <TimeCell iso={row.firstIn} />
                    </TableCell>
                    <TableCell className="font-mono">
                      <TimeCell iso={row.lastOut} />
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {row.workedMinutes > 0 ? worded(row.workedMinutes) : t('common.none')}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'font-mono whitespace-nowrap',
                        row.lateMinutes > 0 && 'text-warning',
                      )}
                    >
                      {row.lateMinutes > 0 ? worded(row.lateMinutes) : t('common.none')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} inNow={row.state === 'IN'} />
                      {row.openIn && row.state !== 'IN' ? (
                        <span className="ml-1.5 text-[0.6875rem] text-muted-foreground">
                          {t('hr.openIn')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {row.siteName ?? t('common.none')}
                    </TableCell>
                  </ButtonRow>
                );
              })}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      <EventsSheet open={open} onClose={() => setOpen(null)} canManage={canManage} />
    </div>
  );
}
