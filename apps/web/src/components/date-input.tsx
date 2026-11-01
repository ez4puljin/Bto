import { businessDate } from '@tugeel/shared/time';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
  inRange,
  monthGrid,
  parseDateText,
  parseMonthText,
  parseTimeText,
  partsOf,
  shiftDay,
  shiftMonth,
} from '@/lib/calendar';
import { cn } from '@/lib/utils';

/**
 * The Mongolian date inputs (owner 2026-11-01: «Системд байгаа бүх calendar-ийг монгол хэлтэй
 * болго»). The browser's own date, month and time inputs speak the browser's language (an
 * English «mm/dd/yyyy», «AM/PM»); these keep the value as text (`YYYY-MM-DD`, `YYYY-MM`,
 * `HH:mm`) that can be typed, and open a Mongolian calendar — «2026 оны 11-р сар», the week from
 * «Да» to «Ня» — beside it.
 */
interface FieldProps {
  id?: string;
  /** `YYYY-MM-DD` (DateInput), `YYYY-MM` (MonthInput) or `HH:mm` (TimeInput); '' for none. */
  value: string | null | undefined;
  /** A complete value as it is typed or picked; '' when the field is emptied. */
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  autoFocus?: boolean;
  className?: string;
  onBlur?: () => void;
  'aria-label'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
  /**
   * `filter`: a pill of a list's filter bar named by `label` (ADR-0042); `bare`: the box and
   * its button alone, inside a pill of the caller's (a date range).
   */
  variant?: 'default' | 'filter' | 'bare';
  label?: string;
}

type Kind = 'date' | 'month' | 'time';

const PARSE: Record<Kind, (text: string) => string | null> = {
  date: parseDateText,
  month: parseMonthText,
  time: parseTimeText,
};

/** A value typed in full (two-digit month, day, hour), committed while typing. */
const COMPLETE: Record<Kind, RegExp> = {
  date: /^\s*(\d{4}[-./]\d{2}[-./]\d{2}|\d{8})\s*$/,
  month: /^\s*(\d{4}[-./]\d{2}|\d{6})\s*$/,
  time: /^\s*(\d{2}[:.]\d{2}|\d{4})\s*$/,
};

/**
 * The typed text and its commit, like the browser's own input: a value typed in full goes out at
 * once (the form checks its range, as before) and the box then shows the value the caller holds;
 * a shorter form («2026.11.1») goes out on leaving the box, a broken one is undone there.
 */
function useDraft(kind: Kind, props: FieldProps) {
  const value = props.value ?? '';
  /** The text while it is not a value yet; null: the box shows `value`. */
  const [draft, setDraft] = useState<string | null>(null);
  // A render after every commit puts the caller's value back in the box when the caller kept
  // its old one (a refused day), as React does for the browser's own controlled input.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const change = (text: string) => {
    if (text.trim() === '') {
      setDraft(null);
      rerender();
      if (value !== '') props.onChange('');
      return;
    }
    const parsed = PARSE[kind](text);
    if (parsed && COMPLETE[kind].test(text)) {
      setDraft(null);
      rerender();
      if (parsed !== value) props.onChange(parsed);
      return;
    }
    setDraft(text);
  };
  const blur = () => {
    if (draft !== null) {
      const parsed = PARSE[kind](draft);
      if (parsed && parsed !== value) props.onChange(parsed);
      setDraft(null);
    }
    props.onBlur?.();
  };
  const pick = (next: string) => {
    setDraft(null);
    if (next !== value) props.onChange(next);
  };
  return { value, text: draft ?? value, change, blur, pick };
}

/** The text box with the calendar button inside its right edge (or the filter pill). */
function Field(props: {
  kind: Kind;
  field: FieldProps;
  draft: ReturnType<typeof useDraft>;
  placeholder: string;
  width: string;
  calendar?: (close: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { field, draft } = props;
  const boxRef = useRef<HTMLInputElement>(null);
  // The box always shows the caller's value once nothing is being typed (after a refused day too).
  useLayoutEffect(() => {
    const node = boxRef.current;
    if (node && node.value !== draft.text) node.value = draft.text;
  });
  const filter = field.variant === 'filter' || field.variant === 'bare';
  const box = (
    <Input
      ref={boxRef}
      id={field.id}
      name={field.name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      autoFocus={field.autoFocus}
      disabled={field.disabled}
      required={field.required}
      placeholder={props.placeholder}
      aria-label={field['aria-label'] ?? (filter ? field.label : undefined)}
      aria-invalid={field['aria-invalid']}
      aria-describedby={field['aria-describedby']}
      value={draft.text}
      min={field.min}
      max={field.max}
      onChange={(event) => draft.change(event.target.value)}
      onBlur={draft.blur}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && event.altKey && props.calendar) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        'font-mono tabular-nums',
        props.calendar && 'pr-9',
        filter &&
          'h-full rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 md:text-[0.8125rem]',
        filter && props.width,
      )}
    />
  );
  const button = props.calendar ? (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={field.disabled}
          aria-label={t('common.calendar.open')}
          title={t('common.calendar.open')}
          className={cn(
            'grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
            !filter && 'absolute top-1/2 right-1.5 -translate-y-1/2',
          )}
        >
          {props.kind === 'time' ? (
            <Clock aria-hidden className="size-4" />
          ) : (
            <CalendarDays aria-hidden className="size-4" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-popover"
        >
          {props.calendar(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  ) : null;
  if (field.variant === 'bare') {
    return (
      <span className={cn('inline-flex items-center gap-0.5', field.className)}>
        {box}
        {button}
      </span>
    );
  }
  if (filter) {
    return (
      <span
        data-active={draft.value ? 'true' : undefined}
        className={cn(
          'group inline-flex h-8.5 items-center gap-2 rounded-full border border-border bg-background pr-1 pl-3 text-[0.8125rem] font-medium shadow-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring hover:bg-accent data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground',
          field.className,
        )}
      >
        {field.label ? (
          <span className="text-muted-foreground group-data-[active=true]:text-secondary-foreground">
            {field.label}
          </span>
        ) : null}
        {box}
        {button}
      </span>
    );
  }
  return (
    <div className={cn('relative w-full', field.className)}>
      {box}
      {button}
    </div>
  );
}

/** A date: typed as `2026-11-01` (or `2026.11.01`, `20261101`) or picked on the calendar. */
export function DateInput(props: FieldProps) {
  const { t } = useTranslation();
  const draft = useDraft('date', props);
  return (
    <Field
      kind="date"
      field={props}
      draft={draft}
      placeholder={t('common.calendar.datePlaceholder')}
      width="w-[6.75rem]"
      calendar={(close) => (
        <DayCalendar
          value={draft.value}
          min={props.min}
          max={props.max}
          clearable={!props.required && draft.value !== ''}
          onPick={(date) => {
            draft.pick(date);
            close();
          }}
        />
      )}
    />
  );
}

/** A month: typed as `2026-11` or picked among the twelve. */
export function MonthInput(props: FieldProps) {
  const { t } = useTranslation();
  const draft = useDraft('month', props);
  return (
    <Field
      kind="month"
      field={props}
      draft={draft}
      placeholder={t('common.calendar.monthPlaceholder')}
      width="w-[4.75rem]"
      calendar={(close) => (
        <MonthCalendar
          value={draft.value}
          min={props.min}
          max={props.max}
          clearable={!props.required && draft.value !== ''}
          onPick={(month) => {
            draft.pick(month);
            close();
          }}
        />
      )}
    />
  );
}

/** A time of day, 24 hours: typed as `08:30` (or `8.30`, `0830`). */
export function TimeInput(props: FieldProps) {
  const { t } = useTranslation();
  const draft = useDraft('time', props);
  return (
    <Field
      kind="time"
      field={props}
      draft={draft}
      placeholder={t('common.calendar.timePlaceholder')}
      width="w-[3.5rem]"
    />
  );
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** «‹ 2026 оны 11-р сар ›»: the title opens the months, the arrows step. */
function CalendarHeader(props: {
  title: string;
  titleLabel?: string;
  onTitle?: () => void;
  previous: { label: string; onClick: () => void; disabled?: boolean };
  next: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const arrow =
    'grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';
  return (
    <div className="mb-2 flex items-center justify-between gap-1">
      <button
        type="button"
        className={arrow}
        aria-label={props.previous.label}
        disabled={props.previous.disabled}
        onClick={props.previous.onClick}
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      {props.onTitle ? (
        <button
          type="button"
          aria-label={props.titleLabel}
          onClick={props.onTitle}
          className="rounded-md px-2 py-1 text-sm font-semibold hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          {props.title}
        </button>
      ) : (
        <span className="text-sm font-semibold">{props.title}</span>
      )}
      <button
        type="button"
        className={arrow}
        aria-label={props.next.label}
        disabled={props.next.disabled}
        onClick={props.next.onClick}
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** «Өнөөдөр» / «Энэ сар» and «Цэвэрлэх» under a calendar. */
function CalendarFooter(props: {
  now: { label: string; onClick: () => void; disabled: boolean };
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
      <button
        type="button"
        disabled={props.now.disabled}
        onClick={props.now.onClick}
        className="rounded-md px-2 py-1 text-[0.8125rem] font-medium text-link hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
      >
        {props.now.label}
      </button>
      {props.onClear ? (
        <button
          type="button"
          onClick={props.onClear}
          className="rounded-md px-2 py-1 text-[0.8125rem] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t('common.calendar.clear')}
        </button>
      ) : null}
    </div>
  );
}

/** A month of days, Monday first, the keyboard moving by day (← →), week (↑ ↓) and month (PgUp/PgDn). */
function DayCalendar(props: {
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (date: string) => void;
}) {
  const { t } = useTranslation();
  const today = businessDate();
  const start =
    props.value || (inRange(today, props.min, props.max) ? today : (props.min ?? today));
  const [month, setMonth] = useState(start.slice(0, 7));
  const [focus, setFocus] = useState(start);
  const [view, setView] = useState<'days' | 'months'>('days');
  const days = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (view === 'days') days.current.get(focus)?.focus();
  }, [focus, view]);
  const { year, month: mon } = partsOf(month);
  if (view === 'months') {
    return (
      <MonthGrid
        year={year}
        selected={month}
        min={props.min}
        max={props.max}
        onPick={(picked) => {
          setMonth(picked);
          setFocus(`${picked}-01`);
          setView('days');
        }}
      />
    );
  }
  const move = (next: string) => {
    setFocus(next);
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(focus, -1),
      ArrowRight: () => shiftDay(focus, 1),
      ArrowUp: () => shiftDay(focus, -7),
      ArrowDown: () => shiftDay(focus, 7),
      PageUp: () => clampDay(shiftMonth(focus.slice(0, 7), -1), focus),
      PageDown: () => clampDay(shiftMonth(focus.slice(0, 7), 1), focus),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    move(step());
  };
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <div>
      <CalendarHeader
        title={t('common.calendar.title', { year, month: mon })}
        titleLabel={t('common.calendar.chooseMonth')}
        onTitle={() => setView('months')}
        previous={{
          label: t('common.calendar.previousMonth'),
          onClick: () => setMonth(previous),
          disabled: !!props.min && previous < props.min.slice(0, 7),
        }}
        next={{
          label: t('common.calendar.nextMonth'),
          onClick: () => setMonth(next),
          disabled: !!props.max && next > props.max.slice(0, 7),
        }}
      />
      <div
        role="grid"
        aria-label={t('common.calendar.title', { year, month: mon })}
        onKeyDown={onKeyDown}
      >
        <div role="row" className="grid grid-cols-7 text-center">
          {WEEKDAYS.map((day) => (
            <span
              key={day}
              role="columnheader"
              className="py-1 text-[0.75rem] font-medium text-muted-foreground"
            >
              {t(`common.calendar.weekdays.${day}`)}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {monthGrid(month).map((date, index) => {
            if (!date) return <span key={`blank-${index}`} aria-hidden />;
            const parts = partsOf(date);
            const allowed = inRange(date, props.min, props.max);
            const selected = date === props.value;
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                ref={(node) => {
                  if (node) days.current.set(date, node);
                  else days.current.delete(date);
                }}
                tabIndex={date === focus ? 0 : -1}
                disabled={!allowed}
                aria-selected={selected}
                aria-label={t('common.calendar.day', {
                  year: parts.year,
                  month: parts.month,
                  day: parts.day,
                })}
                onClick={() => props.onPick(date)}
                className={cn(
                  'grid h-7.5 place-items-center rounded-md text-[0.8125rem] tabular-nums hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35',
                  weekdayIndex(index) >= 5 && !selected && 'text-muted-foreground',
                  date === today && !selected && 'font-semibold text-link ring-1 ring-link/40',
                  selected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                )}
              >
                {parts.day}
              </button>
            );
          })}
        </div>
      </div>
      <CalendarFooter
        now={{
          label: t('common.calendar.today'),
          disabled: !inRange(today, props.min, props.max),
          onClick: () => props.onPick(today),
        }}
        onClear={props.clearable ? () => props.onPick('') : undefined}
      />
    </div>
  );
}

/** The twelve months of a year with ‹ year › above. */
function MonthGrid(props: {
  year: number;
  selected: string;
  min?: string;
  max?: string;
  onPick: (month: string) => void;
}) {
  const { t } = useTranslation();
  const [year, setYear] = useState(props.year);
  return (
    <div>
      <CalendarHeader
        title={t('common.calendar.year', { year })}
        previous={{
          label: t('common.calendar.previousYear'),
          onClick: () => setYear(year - 1),
          disabled: !!props.min && `${year - 1}` < props.min.slice(0, 4),
        }}
        next={{
          label: t('common.calendar.nextYear'),
          onClick: () => setYear(year + 1),
          disabled: !!props.max && `${year + 1}` > props.max.slice(0, 4),
        }}
      />
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 12 }, (_, index) => {
          const month = `${year}-${String(index + 1).padStart(2, '0')}`;
          const selected = month === props.selected;
          return (
            <button
              key={month}
              type="button"
              disabled={!inRange(month, props.min, props.max)}
              aria-pressed={selected}
              onClick={() => props.onPick(month)}
              className={cn(
                'h-9 rounded-md text-[0.8125rem] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35',
                selected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
              )}
            >
              {t('common.calendar.month', { month: index + 1 })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The month picker of MonthInput, «Энэ сар» and «Цэвэрлэх» under it. */
function MonthCalendar(props: {
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (month: string) => void;
}) {
  const { t } = useTranslation();
  const now = businessDate().slice(0, 7);
  const year = partsOf(props.value || now).year;
  return (
    <div>
      <MonthGrid
        year={year}
        selected={props.value}
        min={props.min}
        max={props.max}
        onPick={props.onPick}
      />
      <CalendarFooter
        now={{
          label: t('common.calendar.thisMonth'),
          disabled: !inRange(now, props.min, props.max),
          onClick: () => props.onPick(now),
        }}
        onClear={props.clearable ? () => props.onPick('') : undefined}
      />
    </div>
  );
}

/** The day `date` keeps in another month, cut to that month's last day. */
function clampDay(month: string, date: string): string {
  const day = partsOf(date).day;
  const last = partsOf(shiftDay(`${shiftMonth(month, 1)}-01`, -1)).day;
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** 0 = Monday … 6 = Sunday of a grid cell. */
function weekdayIndex(index: number): number {
  return index % 7;
}
