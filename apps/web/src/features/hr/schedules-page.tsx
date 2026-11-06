import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { SCHEDULE_KINDS, type ScheduleKind, WORKFORCE_LIMITS } from '@tugeel/shared/hr';
import { addMonths, businessDate, businessMonthStart } from '@tugeel/shared/time';
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TimeInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, ListCard, SearchField, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { WEEKDAYS } from './hr-helpers';
import { Avatar } from './hr-kit';
import {
  type HrScheduleDay,
  type HrStaff,
  type HrWorkSchedule,
  useStaff,
  useWorkforceMutations,
  useWorkSchedules,
} from './workforce-api';

const MONTH = /^\d{4}-\d{2}$/;
const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#14b8a6',
  '#64748b',
];

/** Monday = 1 … Sunday = 7 of a `YYYY-MM-DD` date. */
function weekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysOfMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

/** The schedule's day for a weekday, when it is a working day. */
function workingDay(schedule: HrWorkSchedule, weekday: number): HrScheduleDay | null {
  const day = schedule.days.find((entry) => entry.weekday === weekday);
  if (!day) return null;
  return day.start !== null || day.minutes > 0 ? day : null;
}

/** «09:00–18:00» or «8 цаг» (flexible). */
function useDayText() {
  const { t } = useTranslation();
  return (schedule: HrWorkSchedule, day: HrScheduleDay): string =>
    schedule.kind === 'FLEXIBLE' || day.start === null || day.end === null
      ? t('hr.schedules.hoursValue', { hours: +(day.minutes / 60).toFixed(2) })
      : `${day.start}–${day.end}`;
}

/* ------------------------------------------------------------------ dialog */

interface DayDraft {
  works: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
  hours: string;
}

const emptyDay = (weekday: number): DayDraft => ({
  works: weekday <= 5,
  start: '09:00',
  end: '18:00',
  breakStart: '13:00',
  breakEnd: '14:00',
  hours: '8',
});

function dayDraftsOf(schedule: HrWorkSchedule | null): DayDraft[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    if (!schedule) return emptyDay(weekday);
    const day = workingDay(schedule, weekday);
    if (!day) return { ...emptyDay(weekday), works: false };
    return {
      works: true,
      start: day.start ?? '09:00',
      end: day.end ?? '18:00',
      breakStart: day.breakStart ?? '',
      breakEnd: day.breakEnd ?? '',
      hours: String(+(day.minutes / 60).toFixed(2)),
    };
  });
}

function ScheduleDialog(props: {
  schedule: HrWorkSchedule | null;
  staff: readonly HrStaff[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const schedule = props.schedule;
  const [name, setName] = useState(schedule?.name ?? '');
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? 'FIXED');
  const [color, setColor] = useState(schedule?.color ?? COLORS[0] ?? '#3b82f6');
  const [days, setDays] = useState<DayDraft[]>(() => dayDraftsOf(schedule));
  const [members, setMembers] = useState<Set<number>>(() => new Set(schedule?.userIds ?? []));
  const [search, setSearch] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const people = useMemo(() => {
    const terms = queryTerms(search);
    return props.staff
      .filter((row) => row.leftOn === null)
      .filter(
        (row) =>
          terms.length === 0 ||
          matchesQuery(
            searchKeys(row.fullName, [row.divisionName ?? '', row.position ?? '']),
            terms,
          ),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }, [props.staff, search]);

  const setDay = (index: number, patch: Partial<DayDraft>) =>
    setDays((prev) => prev.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  const copyMonday = () =>
    setDays((prev) => {
      const monday = prev[0];
      if (!monday) return prev;
      return prev.map((day, index) =>
        index === 0 || !day.works ? day : { ...monday, works: true },
      );
    });
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') {
      setNameError('validation.required');
      return;
    }
    const body = {
      id: schedule?.id ?? null,
      name: name.trim(),
      kind,
      color,
      days: days.flatMap((day, index) => {
        if (!day.works) return [];
        const hours = Number(day.hours.replace(',', '.'));
        return [
          kind === 'FLEXIBLE'
            ? {
                weekday: index + 1,
                start: null,
                end: null,
                breakStart: null,
                breakEnd: null,
                minutes: Number.isFinite(hours) ? Math.round(hours * 60) : 0,
              }
            : {
                weekday: index + 1,
                start: day.start || null,
                end: day.end || null,
                breakStart: day.breakStart || null,
                breakEnd: day.breakEnd || null,
                minutes: 0,
              },
        ];
      }),
      userIds: [...members],
    };
    const ok = await action.run(() => mutations.saveSchedule.mutateAsync(body));
    if (ok) {
      toast.success(schedule ? t('hr.schedules.dialog.saved') : t('hr.schedules.dialog.created'));
      close();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <DialogHeader>
          <DialogTitle>
            {schedule ? t('hr.schedules.dialog.editTitle') : t('hr.schedules.dialog.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('hr.schedules.dialog.kindHint')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto]">
            <FormField
              label={t('hr.schedules.dialog.name')}
              htmlFor="schedule-name"
              error={nameError}
            >
              <Input
                id="schedule-name"
                maxLength={WORKFORCE_LIMITS.maxScheduleName}
                value={name}
                onChange={(event) => {
                  setNameError(undefined);
                  setName(event.target.value);
                }}
              />
            </FormField>
            <FormField label={t('hr.schedules.dialog.kind')} htmlFor="schedule-kind">
              <NativeSelect
                id="schedule-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as ScheduleKind)}
              >
                {SCHEDULE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`hr.scheduleKinds.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t('hr.schedules.dialog.color')} htmlFor="schedule-color">
              <div className="flex h-10 items-center gap-1.5">
                {COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={value}
                    aria-pressed={color === value}
                    className={cn(
                      'size-6 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      color === value && 'ring-2 ring-foreground',
                    )}
                    style={{ backgroundColor: value }}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
            </FormField>
          </div>
          <fieldset className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <legend className="text-sm font-medium">{t('hr.schedules.dialog.days')}</legend>
              {kind === 'FIXED' ? (
                <Button type="button" size="xs" variant="ghost" onClick={copyMonday}>
                  <Copy />
                  {t('hr.schedules.dialog.copyMonday')}
                </Button>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[0.8125rem]">
                <thead className="bg-fill text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">
                      {t('hr.schedules.week.weekday')}
                    </th>
                    {kind === 'FIXED' ? (
                      <>
                        <th className="px-2 py-1.5 text-left font-medium">
                          {t('hr.schedules.week.start')}
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          {t('hr.schedules.week.end')}
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          {t('hr.schedules.week.breakStart')}
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          {t('hr.schedules.week.breakEnd')}
                        </th>
                      </>
                    ) : (
                      <th className="px-2 py-1.5 text-left font-medium">
                        {t('hr.schedules.week.hours')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, index) => {
                    const label = t(`hr.weekdays.${WEEKDAYS[index] ?? 'd0'}`);
                    const id = `schedule-day-${index}`;
                    return (
                      <tr key={id} className="border-t">
                        <td className="px-3 py-1">
                          <Label htmlFor={id} className="flex items-center gap-2 font-normal">
                            <Checkbox
                              id={id}
                              checked={day.works}
                              onCheckedChange={(next) => setDay(index, { works: next === true })}
                            />
                            {label}
                          </Label>
                        </td>
                        {kind === 'FIXED' ? (
                          (['start', 'end', 'breakStart', 'breakEnd'] as const).map((field) => (
                            <td key={field} className="px-2 py-1">
                              {day.works ? (
                                <TimeInput
                                  aria-label={`${label} ${t(`hr.schedules.week.${field}`)}`}
                                  value={day[field]}
                                  onChange={(value) => setDay(index, { [field]: value })}
                                />
                              ) : (
                                <span className="text-muted-foreground">
                                  {t('hr.schedules.dayOff')}
                                </span>
                              )}
                            </td>
                          ))
                        ) : (
                          <td className="px-2 py-1">
                            {day.works ? (
                              <Input
                                aria-label={`${label} ${t('hr.schedules.week.hours')}`}
                                inputMode="decimal"
                                className="h-8 w-20"
                                value={day.hours}
                                onChange={(event) => setDay(index, { hours: event.target.value })}
                              />
                            ) : (
                              <span className="text-muted-foreground">
                                {t('hr.schedules.dayOff')}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <legend className="text-sm font-medium">{t('hr.schedules.dialog.members')}</legend>
              <span className="text-xs text-muted-foreground">
                {t('hr.schedules.dialog.selected', { count: members.size })}
              </span>
              <SearchField
                className="ml-auto sm:w-56"
                aria-label={t('hr.schedules.dialog.membersSearch')}
                placeholder={t('hr.schedules.dialog.membersSearch')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('hr.schedules.dialog.membersHint')}</p>
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {people.map((person) => {
                const id = `schedule-member-${person.userId}`;
                const elsewhere =
                  person.scheduleId !== null && person.scheduleId !== schedule?.id
                    ? person.scheduleName
                    : null;
                return (
                  <Label
                    key={person.userId}
                    htmlFor={id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 font-normal hover:bg-accent"
                  >
                    <Checkbox
                      id={id}
                      checked={members.has(person.userId)}
                      onCheckedChange={(next) =>
                        setMembers((prev) => {
                          const updated = new Set(prev);
                          if (next === true) updated.add(person.userId);
                          else updated.delete(person.userId);
                          return updated;
                        })
                      }
                    />
                    <Avatar
                      name={person.fullName}
                      src={person.photoUrl}
                      className="size-6 text-[0.625rem]"
                    />
                    <span className="min-w-0 truncate">{person.fullName}</span>
                    {elsewhere ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {elsewhere}
                      </span>
                    ) : null}
                  </Label>
                );
              })}
            </div>
          </fieldset>
          <DialogFormFooter
            pending={mutations.saveSchedule.isPending}
            onCancel={close}
            submitLabel={schedule ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * «Цагийн хуваарь» (ADR-0144): the schedules over a month like timely's calendar — one row per
 * schedule, its working days coloured with the hours — or as a list of their weeks; HR adds and
 * edits a schedule (the hours per weekday, fixed or flexible, who follows it) and removes one
 * (its people go back to the company's hours). The employees without a schedule are counted.
 */
export function SchedulesPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('hr.attendance.manage');
  const schedules = useWorkSchedules();
  const staff = useStaff();
  const mutations = useWorkforceMutations();
  const action = useAction();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const creating = { open: creatingOpen, setOpen: setCreatingOpen };
  const dayText = useDayText();
  const [editing, setEditing] = useState<HrWorkSchedule | null>(null);
  const [removing, setRemoving] = useState<HrWorkSchedule | null>(null);
  const monthParam = search.get('month');
  const month =
    monthParam && MONTH.test(monthParam) ? monthParam : businessMonthStart().slice(0, 7);
  const view = search.get('view') === 'list' ? 'list' : 'calendar';
  const today = businessDate();
  const days = daysOfMonth(month);
  const rows = schedules.data ?? [];
  const active = (staff.data ?? []).filter((row) => row.leftOn === null && row.status === 'ACTIVE');
  const unassigned = active.filter((row) => row.scheduleId === null).length;

  const remove = async () => {
    if (!removing) return;
    const ok = await action.run(() => mutations.archiveSchedule.mutateAsync(removing.id));
    if (ok) {
      toast.success(t('hr.schedules.archived'));
      setRemoving(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('hr.schedules.title')}
        description={t('hr.schedules.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => creating.setOpen(true)}>
              <Plus />
              {t('hr.schedules.create')}
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={['calendar', 'list'] as const}
          value={view}
          label={(value) => t(`hr.schedules.${value}`)}
          onChange={(value) => setParam('view', value === 'list' ? 'list' : null)}
        />
        {view === 'calendar' ? (
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('hr.schedules.prevMonth')}
              onClick={() => setParam('month', addMonths(`${month}-01`, -1).slice(0, 7))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-20 text-center font-mono text-sm font-semibold">{month}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('hr.schedules.nextMonth')}
              onClick={() => setParam('month', addMonths(`${month}-01`, 1).slice(0, 7))}
            >
              <ChevronRight />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setParam('month', null)}>
              {t('hr.schedules.thisMonth')}
            </Button>
          </div>
        ) : null}
        {staff.data && unassigned > 0 ? (
          <Link
            to="/hr/staff"
            title={t('hr.schedules.unassignedHint')}
            className="ml-auto rounded-full bg-warning-soft px-3 py-1 text-[0.8125rem] font-medium text-warning hover:underline"
          >
            {t('hr.schedules.unassigned', { count: unassigned })}
          </Link>
        ) : null}
      </div>
      <ProblemAlert
        problem={action.problem ?? problemFromError(schedules.error ?? staff.error)}
        onRetry={schedules.refetch}
      />
      {schedules.data && rows.length === 0 ? (
        <ListCard>
          <EmptyState title={t('hr.schedules.empty')} icon={CalendarClock} />
        </ListCard>
      ) : null}
      {rows.length > 0 && view === 'calendar' ? (
        <ListCard scroll>
          <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-10 min-w-48 border-b bg-card px-3 py-2 text-left text-[0.8125rem] font-semibold">
                  {t('hr.schedules.title')}
                </th>
                {days.map((date) => {
                  const weekday = weekdayOf(date);
                  return (
                    <th
                      key={date}
                      className={cn(
                        'min-w-11 border-b px-0.5 py-1.5 text-center font-medium',
                        weekday >= 6 && 'text-muted-foreground',
                        date === today && 'text-link',
                      )}
                    >
                      <span className="block text-[0.6875rem]">
                        {t(`hr.weekdays.${WEEKDAYS[weekday - 1] ?? 'd0'}`)}
                      </span>
                      <span
                        className={cn(
                          'mx-auto mt-0.5 grid size-6 place-items-center rounded-full font-mono',
                          date === today && 'bg-primary text-primary-foreground',
                        )}
                      >
                        {date.slice(8)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((schedule) => (
                <tr key={schedule.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] border-b bg-card px-3 py-2 text-left font-normal"
                  >
                    <button
                      type="button"
                      disabled={!canManage}
                      className="flex w-full min-w-0 items-center gap-2 text-left outline-none enabled:hover:underline focus-visible:underline"
                      aria-label={t('hr.schedules.editFor', { name: schedule.name })}
                      onClick={() => setEditing(schedule)}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: schedule.color }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[0.8125rem] font-medium">
                          {schedule.name}
                        </span>
                        <span className="block text-[0.6875rem] text-muted-foreground">
                          {t(`hr.scheduleKinds.${schedule.kind}`)} ·{' '}
                          {schedule.userIds.length > 0
                            ? t('hr.schedules.members', { count: schedule.userIds.length })
                            : t('hr.schedules.noMembers')}
                        </span>
                      </span>
                    </button>
                  </th>
                  {days.map((date) => {
                    const day = workingDay(schedule, weekdayOf(date));
                    return (
                      <td key={date} className="border-b px-0.5 py-1 text-center">
                        {day ? (
                          <span
                            className="block rounded-md px-0.5 py-1 font-mono text-[0.625rem] leading-tight text-white"
                            style={{ backgroundColor: schedule.color }}
                            title={dayText(schedule, day)}
                          >
                            {schedule.kind === 'FLEXIBLE' || day.start === null ? (
                              `${+(day.minutes / 60).toFixed(1)}`
                            ) : (
                              <>
                                {day.start}
                                <br />
                                {day.end}
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="block py-1 text-muted-foreground/60">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ListCard>
      ) : null}
      {rows.length > 0 && view === 'list' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((schedule) => (
            <article
              key={schedule.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-control"
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-1 size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: schedule.color }}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[0.9375rem] font-semibold">{schedule.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {t(`hr.scheduleKinds.${schedule.kind}`)} ·{' '}
                    {schedule.userIds.length > 0
                      ? t('hr.schedules.members', { count: schedule.userIds.length })
                      : t('hr.schedules.noMembers')}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-7"
                      aria-label={t('hr.schedules.editFor', { name: schedule.name })}
                      onClick={() => setEditing(schedule)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-7 hover:bg-danger-soft hover:text-destructive"
                      aria-label={t('hr.schedules.archiveFor', { name: schedule.name })}
                      onClick={() => setRemoving(schedule)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              <dl className="grid grid-cols-[2.5rem_1fr] gap-x-2 gap-y-1 text-[0.8125rem]">
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                  const day = workingDay(schedule, weekday);
                  return (
                    <div key={weekday} className="contents">
                      <dt className="text-muted-foreground">
                        {t(`hr.weekdays.${WEEKDAYS[weekday - 1] ?? 'd0'}`)}
                      </dt>
                      <dd className={cn('font-mono', !day && 'text-muted-foreground')}>
                        {day ? dayText(schedule, day) : t('hr.schedules.dayOff')}
                        {day?.breakStart && day.breakEnd ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({day.breakStart}–{day.breakEnd})
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))}
        </div>
      ) : null}
      {view === 'calendar' && rows.length > 0 && unassigned > 0 ? (
        <Alert className="mt-3">
          <AlertDescription>{t('hr.schedules.unassignedHint')}</AlertDescription>
        </Alert>
      ) : null}
      {creating.open ? (
        <ScheduleDialog
          schedule={null}
          staff={staff.data ?? []}
          onClose={() => creating.setOpen(false)}
        />
      ) : null}
      {editing ? (
        <ScheduleDialog
          schedule={editing}
          staff={staff.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title={t('hr.schedules.archiveTitle')}
        description={
          removing ? t('hr.schedules.archiveDescription', { name: removing.name }) : undefined
        }
        confirmLabel={t('common.delete')}
        pending={mutations.archiveSchedule.isPending}
        problem={action.problem}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
