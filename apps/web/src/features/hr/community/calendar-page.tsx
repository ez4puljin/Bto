import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Settings2,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, RowAction } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import {
  type HrCalendarItem,
  useEngagementMutations,
  useHrCalendar,
  useHrEventTypes,
} from '../engagement-api';
import { Avatar } from '../hr-kit';
import {
  CALENDAR_MARKS,
  calendarTypeKey,
  isOnDay,
  itemMark,
  monthOfDate,
  shiftMonth,
  thisMonth,
} from './community-helpers';
import { MonthGrid } from './month-grid';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The days the system works out itself; every other type is HR's own list (ADR-0171). */
const PERSON_KINDS = ['BIRTHDAY', 'ANNIVERSARY'] as const;

/** «Үйл явдал нэмэх» / «Үйл явдал засах»: one day, or from a day to a day. */
function EventDialog(props: { item: HrCalendarItem | null; day: string; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const { item } = props;
  const types = useHrEventTypes();
  const [picked, setPicked] = useState<number | null>(item?.typeId ?? null);
  const typeId = picked ?? types.data?.[0]?.id ?? null;
  // An archived type takes no new event, and stays selectable on the event that already holds it.
  const keepsArchived =
    item?.typeId != null && !(types.data ?? []).some((type) => type.id === item.typeId);
  const [title, setTitle] = useState(item?.title ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [fromDate, setFromDate] = useState(item?.date ?? props.day);
  const [toDate, setToDate] = useState(item?.toDate ?? item?.date ?? props.day);
  const [tried, setTried] = useState(false);
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (typeId === null || title.trim() === '' || !fromDate || !toDate) return;
    const ok = await action.run(() =>
      mutations.saveEvent.mutateAsync({
        id: item?.eventId ?? null,
        typeId,
        title: title.trim(),
        note: note.trim() || null,
        fromDate,
        toDate,
      }),
    );
    if (ok) {
      toast.success(t('hr.community.calendar.saved'));
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>
            {item ? t('hr.community.calendar.edit') : t('hr.community.calendar.create')}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <ProblemAlert problem={problemFromError(types.error)} onRetry={types.refetch} />
          <FormField
            label={t('hr.community.calendar.fields.kind')}
            htmlFor="event-kind"
            hint={typeId === null && types.data ? t('hr.community.calendar.noTypes') : undefined}
            error={tried && typeId === null ? 'validation.required' : undefined}
          >
            <NativeSelect
              id="event-kind"
              disabled={types.isPending}
              value={typeId ?? ''}
              onChange={(event) => setPicked(Number.parseInt(event.target.value, 10))}
            >
              {keepsArchived && item?.typeId != null ? (
                <option value={item.typeId}>{item.typeName}</option>
              ) : null}
              {(types.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={t('hr.community.calendar.fields.title')}
            htmlFor="event-title"
            error={tried && title.trim() === '' ? 'validation.required' : undefined}
          >
            <Input
              id="event-title"
              maxLength={ENGAGEMENT_LIMITS.maxTitle}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('hr.community.calendar.fields.from')} htmlFor="event-from">
              <DateInput
                id="event-from"
                required
                value={fromDate}
                onChange={(value) => {
                  setFromDate(value);
                  if (value && toDate < value) setToDate(value);
                }}
              />
            </FormField>
            <FormField label={t('hr.community.calendar.fields.to')} htmlFor="event-to">
              <DateInput
                id="event-to"
                required
                min={fromDate}
                value={toDate}
                onChange={setToDate}
              />
            </FormField>
          </div>
          <FormField label={t('hr.community.calendar.fields.note')} htmlFor="event-note">
            <Textarea
              id="event-note"
              rows={2}
              maxLength={ENGAGEMENT_LIMITS.maxNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.saveEvent.isPending}
            onCancel={close}
            submitLabel={item ? t('common.save') : t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One line of a day's list; a person's day shows the photo, HR's own entries can be changed. */
export function CalendarItemLine(props: {
  item: HrCalendarItem;
  onEdit?: (item: HrCalendarItem) => void;
  onArchive?: (item: HrCalendarItem) => void;
  /** Marks the work done; without it the line only shows whether it is (ADR-0171 #8). */
  onToggleDone?: (item: HrCalendarItem) => void;
  doneDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { item } = props;
  const person = item.kind === 'BIRTHDAY' || item.kind === 'ANNIVERSARY';
  const span =
    item.toDate && item.toDate !== item.date
      ? t('hr.community.calendar.span', { from: item.date, to: item.toDate })
      : null;
  return (
    <li className="flex items-start gap-2.5 py-2">
      {person ? (
        <Avatar name={item.title} src={item.photoUrl} className="size-7 text-[0.6875rem]" />
      ) : props.onToggleDone ? (
        <span className="grid size-7 shrink-0 place-items-center">
          <Checkbox
            aria-label={t('hr.community.calendar.doneFor', { title: item.title })}
            checked={item.doneAt !== null}
            disabled={props.doneDisabled}
            onCheckedChange={() => props.onToggleDone?.(item)}
          />
        </span>
      ) : (
        <span aria-hidden className="grid size-7 shrink-0 place-items-center">
          <span
            style={itemMark(item).style}
            className={cn('size-2.5 rounded-full', itemMark(item).className)}
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate font-medium',
            item.doneAt && 'text-muted-foreground line-through',
          )}
          title={item.title}
        >
          {item.title}
        </p>
        <p className="text-[0.8125rem] text-muted-foreground">
          {props.onToggleDone && !person ? (
            <span
              aria-hidden
              style={itemMark(item).style}
              className={cn('mr-1.5 inline-block size-2 rounded-full', itemMark(item).className)}
            />
          ) : null}
          {item.kind === 'ANNIVERSARY'
            ? t('hr.community.calendar.anniversaryYears', { years: item.years ?? 0 })
            : (item.typeName ?? t(`hr.community.calendar.kinds.${item.kind}`))}
          {span ? ` · ${span}` : ''}
        </p>
        {item.note ? <p className="mt-0.5 text-[0.8125rem]">{item.note}</p> : null}
        {item.doneAt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.doneByName
              ? t('hr.community.calendar.doneBy', {
                  name: item.doneByName,
                  at: formatUbMinute(item.doneAt),
                })
              : t('hr.community.calendar.doneAt', { at: formatUbMinute(item.doneAt) })}
          </p>
        ) : null}
      </div>
      {item.eventId !== null && props.onEdit && props.onArchive ? (
        <span className="flex shrink-0 gap-0.5">
          <RowAction
            label={t('hr.community.calendar.editFor', { title: item.title })}
            icon={Pencil}
            onClick={() => props.onEdit?.(item)}
          />
          <RowAction
            label={t('hr.community.calendar.archiveFor', { title: item.title })}
            icon={Archive}
            destructive
            onClick={() => props.onArchive?.(item)}
          />
        </span>
      ) : null}
    </li>
  );
}

/** One type above the month: the legend's dot and name, and a pill that shows only its kind. */
function TypePill(props: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring',
        props.pressed
          ? 'border-transparent bg-secondary text-secondary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/**
 * «Үйл явдлын календарь» (ADR-0146): HR's events, the staff's birthdays and work anniversaries on a
 * month; the month, the chosen day and the chosen types (`?types=`, several at once) are in the
 * address.
 */
export function CalendarPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const monthParam = params.get('month') ?? '';
  const month = MONTH.test(monthParam) ? monthParam : thisMonth();
  const today = businessDate();
  const dayParam = params.get('day') ?? '';
  const fallbackDay = monthOfDate(today) === month ? today : `${month}-01`;
  const day = monthOfDate(dayParam) === month ? dayParam : fallbackDay;
  const calendar = useHrCalendar(month);
  const types = useHrEventTypes();
  const mutations = useEngagementMutations();
  const action = useAction();
  const doneAction = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<HrCalendarItem | null>(null);
  const [archiving, setArchiving] = useState<HrCalendarItem | null>(null);
  const items = calendar.data ?? [];
  const [year, monthNumber] = month.split('-');
  const go = (next: string) => {
    doneAction.clear();
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.delete('day');
        if (next === thisMonth()) updated.delete('month');
        else updated.set('month', next);
        return updated;
      },
      { replace: true },
    );
  };
  const toggleDone = (item: HrCalendarItem) => {
    const id = item.eventId;
    if (id === null) return;
    void doneAction.run(() =>
      mutations.setEventDone.mutateAsync({ id, done: item.doneAt === null }),
    );
  };
  // What the month holds per type, whatever the list says now: an archived type still has its events.
  const typeRows = new Map(
    (types.data ?? []).map((type) => [
      type.id,
      { id: type.id, name: type.name, color: type.color, total: 0, done: 0 },
    ]),
  );
  for (const item of items) {
    if (item.typeId === null) continue;
    const row = typeRows.get(item.typeId) ?? {
      id: item.typeId,
      name: item.typeName ?? '',
      color: item.typeColor ?? '',
      total: 0,
      done: 0,
    };
    row.total += 1;
    if (item.doneAt) row.done += 1;
    typeRows.set(item.typeId, row);
  }
  // The type filter: none chosen shows every kind; a key no pill carries (a type archived since) is
  // dropped once the types are known, so the filter never hides the month behind an unseen pill.
  const known = new Set<string>([...[...typeRows.keys()].map(String), ...PERSON_KINDS]);
  const chosen = new Set(
    (params.get('types') ?? '')
      .split(',')
      .filter((key) => key !== '' && (!types.data || known.has(key))),
  );
  const shown =
    chosen.size === 0 ? items : items.filter((item) => chosen.has(calendarTypeKey(item)));
  const onDay = shown.filter((item) => isOnDay(item, day));
  const choose = (key: string | null) => {
    doneAction.clear();
    const next = new Set(key === null ? [] : chosen);
    if (key !== null && !next.delete(key)) next.add(key);
    setParam('types', [...next].join(','));
  };
  const archive = async () => {
    if (archiving?.eventId == null) return;
    const id = archiving.eventId;
    const ok = await action.run(() => mutations.archiveEvent.mutateAsync(id));
    if (ok) {
      toast.success(t('hr.community.calendar.archived'));
      setArchiving(null);
    }
  };
  return (
    <div>
      <PageHeader
        title={t('nav.hrCalendar')}
        description={t('hr.community.calendar.description')}
        actions={
          canManage ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link to="/hr/setup">
                  <Settings2 />
                  {t('hr.community.calendar.types')}
                </Link>
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t('hr.community.calendar.create')}
              </Button>
            </>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(calendar.error)} onRetry={calendar.refetch} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle aria-live="polite">
              {t('common.calendar.title', {
                year,
                month: Number.parseInt(monthNumber ?? '1', 10),
              })}
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t('common.calendar.previousMonth')}
                onClick={() => go(shiftMonth(month, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button size="sm" variant="outline" onClick={() => go(thisMonth())}>
                {t('common.calendar.thisMonth')}
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t('common.calendar.nextMonth')}
                onClick={() => go(shiftMonth(month, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              role="group"
              aria-label={t('hr.community.calendar.filter')}
              className="flex flex-wrap gap-1.5"
            >
              <TypePill pressed={chosen.size === 0} onClick={() => choose(null)}>
                {t('common.all')}
              </TypePill>
              {[...typeRows.values()].map((type) => (
                <TypePill
                  key={type.id}
                  pressed={chosen.has(String(type.id))}
                  onClick={() => choose(String(type.id))}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: type.color }}
                  />
                  {type.name}
                  {type.total > 0 ? (
                    <span className="font-mono font-normal opacity-80">
                      {t('hr.community.calendar.progress', {
                        done: type.done,
                        total: type.total,
                      })}
                    </span>
                  ) : null}
                </TypePill>
              ))}
              {PERSON_KINDS.map((kind) => (
                <TypePill key={kind} pressed={chosen.has(kind)} onClick={() => choose(kind)}>
                  <span aria-hidden className={cn('size-2 rounded-full', CALENDAR_MARKS[kind])} />
                  {t(`hr.community.calendar.kinds.${kind}`)}
                </TypePill>
              ))}
            </div>
            <MonthGrid
              month={month}
              items={shown}
              selected={day}
              size="full"
              onSelect={(next) => {
                doneAction.clear();
                setParam('day', next);
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.community.calendar.dayTitle', { day })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProblemAlert problem={doneAction.problem} />
            {calendar.data && onDay.length === 0 ? (
              <EmptyState
                title={
                  chosen.size > 0
                    ? t('hr.community.calendar.dayEmptyFiltered')
                    : t('hr.community.calendar.dayEmpty')
                }
                icon={CalendarDays}
                action={
                  chosen.size > 0 ? (
                    <Button size="sm" variant="outline" onClick={() => choose(null)}>
                      {t('common.clearFilters')}
                    </Button>
                  ) : canManage ? (
                    <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                      <Plus />
                      {t('hr.community.calendar.create')}
                    </Button>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {onDay.map((item) => (
                  <CalendarItemLine
                    key={`${item.kind}-${item.eventId ?? item.userId ?? item.title}`}
                    item={item}
                    onEdit={canManage ? setEditing : undefined}
                    onArchive={canManage ? setArchiving : undefined}
                    onToggleDone={item.eventId === null ? undefined : toggleDone}
                    doneDisabled={mutations.setEventDone.isPending}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {canManage && creating ? (
        <EventDialog item={null} day={day} onClose={() => setCreating(false)} />
      ) : null}
      {canManage && editing ? (
        <EventDialog
          key={editing.eventId}
          item={editing}
          day={day}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={archiving !== null}
        title={t('hr.community.calendar.archiveTitle')}
        description={t('hr.community.calendar.archiveDescription', {
          title: archiving?.title ?? '',
        })}
        confirmLabel={t('hr.community.calendar.archive')}
        pending={mutations.archiveEvent.isPending}
        problem={action.problem}
        onConfirm={() => void archive()}
        onClose={() => {
          action.clear();
          setArchiving(null);
        }}
      />
    </div>
  );
}
