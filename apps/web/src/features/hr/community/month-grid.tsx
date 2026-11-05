import { businessDate } from '@tugeel/shared/time';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { HrCalendarItem } from '../engagement-api';
import { CALENDAR_MARKS, isOnDay, monthOfDate, monthWeeks } from './community-helpers';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * A month as a grid, Monday first. Each day is a button with the marks of its items; the full size
 * also writes the first titles (the home page's small one writes only the marks).
 */
export function MonthGrid(props: {
  month: string;
  items: readonly HrCalendarItem[];
  selected?: string | null;
  onSelect?: (day: string) => void;
  size?: 'small' | 'full';
}) {
  const { t } = useTranslation();
  const today = businessDate();
  const weeks = useMemo(() => monthWeeks(props.month), [props.month]);
  const full = props.size === 'full';
  return (
    <div role="group" aria-label={t('hr.community.calendar.month')} className="flex flex-col">
      <div className="grid grid-cols-7">
        {WEEKDAY_KEYS.map((day) => (
          <span key={day} className="py-1 text-center text-xs font-medium text-muted-foreground">
            {t(`common.calendar.weekdays.${day}`)}
          </span>
        ))}
      </div>
      <div
        className={cn('grid grid-cols-7', full && 'gap-px overflow-hidden rounded-lg bg-border')}
      >
        {weeks.flat().map((day) => {
          const inMonth = monthOfDate(day) === props.month;
          const onDay = props.items.filter((item) => isOnDay(item, day));
          const selected = props.selected === day;
          const dayNumber = Number.parseInt(day.slice(8), 10);
          return (
            <button
              key={day}
              type="button"
              aria-label={t('hr.community.calendar.dayLabel', { day, count: onDay.length })}
              aria-pressed={props.onSelect ? selected : undefined}
              aria-current={day === today ? 'date' : undefined}
              disabled={!props.onSelect}
              className={cn(
                'flex min-w-0 flex-col outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                full
                  ? 'min-h-16 gap-1 bg-card p-1.5 text-left hover:bg-accent'
                  : 'items-center gap-0.5 rounded-lg py-1 enabled:hover:bg-accent',
                selected && (full ? 'bg-secondary hover:bg-secondary' : 'bg-secondary'),
                !inMonth && 'text-muted-foreground/50',
                !inMonth && full && 'bg-canvas',
              )}
              onClick={() => props.onSelect?.(day)}
            >
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full text-[0.8125rem] tabular-nums',
                  day === today && 'bg-primary font-semibold text-primary-foreground',
                )}
              >
                {dayNumber}
              </span>
              {full ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  {onDay.slice(0, 3).map((item) => (
                    <span
                      key={`${item.kind}-${item.eventId ?? item.userId ?? item.title}`}
                      className="flex min-w-0 items-center gap-1 text-xs"
                    >
                      <span
                        aria-hidden
                        className={cn('size-1.5 shrink-0 rounded-full', CALENDAR_MARKS[item.kind])}
                      />
                      <span className="truncate">{item.title}</span>
                    </span>
                  ))}
                  {onDay.length > 3 ? (
                    <span className="text-xs text-muted-foreground">
                      {t('hr.community.calendar.more', { count: onDay.length - 3 })}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span aria-hidden className="flex h-1.5 items-center gap-0.5">
                  {onDay.slice(0, 3).map((item) => (
                    <span
                      key={`${item.kind}-${item.eventId ?? item.userId ?? item.title}`}
                      className={cn('size-1.5 rounded-full', CALENDAR_MARKS[item.kind])}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
