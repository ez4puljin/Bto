import { CALENDAR_ITEM_KINDS, ENGAGEMENT_LIMITS, HR_EVENT_KINDS } from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, RowAction } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import {
  type HrCalendarItem,
  type HrEventRequest,
  useEngagementMutations,
  useHrCalendar,
} from '../engagement-api';
import { Avatar } from '../hr-kit';
import { CALENDAR_MARKS, isOnDay, monthOfDate, shiftMonth, thisMonth } from './community-helpers';
import { MonthGrid } from './month-grid';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
type EventKind = HrEventRequest['kind'];

/** «Үйл явдал нэмэх» / «Үйл явдал засах»: one day, or from a day to a day. */
function EventDialog(props: { item: HrCalendarItem | null; day: string; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const { item } = props;
  const [kind, setKind] = useState<EventKind>(
    item && item.kind !== 'BIRTHDAY' && item.kind !== 'ANNIVERSARY' ? item.kind : 'EVENT',
  );
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
    if (title.trim() === '' || !fromDate || !toDate) return;
    const ok = await action.run(() =>
      mutations.saveEvent.mutateAsync({
        id: item?.eventId ?? null,
        kind,
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
          <FormField label={t('hr.community.calendar.fields.kind')} htmlFor="event-kind">
            <NativeSelect
              id="event-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as EventKind)}
            >
              {HR_EVENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`hr.community.calendar.kinds.${value}`)}
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
      ) : (
        <span aria-hidden className="grid size-7 shrink-0 place-items-center">
          <span className={cn('size-2.5 rounded-full', CALENDAR_MARKS[item.kind])} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.title}>
          {item.title}
        </p>
        <p className="text-[0.8125rem] text-muted-foreground">
          {item.kind === 'ANNIVERSARY'
            ? t('hr.community.calendar.anniversaryYears', { years: item.years ?? 0 })
            : t(`hr.community.calendar.kinds.${item.kind}`)}
          {span ? ` · ${span}` : ''}
        </p>
        {item.note ? <p className="mt-0.5 text-[0.8125rem]">{item.note}</p> : null}
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

/**
 * «Үйл явдлын календарь» (ADR-0146): HR's events, the staff's birthdays and work anniversaries on a
 * month; the month and the chosen day are in the address.
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
  const mutations = useEngagementMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<HrCalendarItem | null>(null);
  const [archiving, setArchiving] = useState<HrCalendarItem | null>(null);
  const items = calendar.data ?? [];
  const onDay = items.filter((item) => isOnDay(item, day));
  const [year, monthNumber] = month.split('-');
  const go = (next: string) => {
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
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('hr.community.calendar.create')}
            </Button>
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
            <MonthGrid
              month={month}
              items={items}
              selected={day}
              size="full"
              onSelect={(next) => setParam('day', next)}
            />
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {CALENDAR_ITEM_KINDS.map((kind) => (
                <li key={kind} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className={cn('size-2 rounded-full', CALENDAR_MARKS[kind])} />
                  {t(`hr.community.calendar.kinds.${kind}`)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('hr.community.calendar.dayTitle', { day })}</CardTitle>
          </CardHeader>
          <CardContent>
            {calendar.data && onDay.length === 0 ? (
              <EmptyState
                title={t('hr.community.calendar.dayEmpty')}
                icon={CalendarDays}
                action={
                  canManage ? (
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
