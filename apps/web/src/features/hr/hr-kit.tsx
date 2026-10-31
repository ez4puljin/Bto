import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatUbTime } from '@/lib/dayjs';
import { cn } from '@/lib/utils';
import type { DayStatus } from './api';
import { WEEKDAYS } from './hr-helpers';

/*
 * Pieces the three attendance pages share (ADR-0131): the status pill, the «still in» dot, the
 * initials avatar and the weekday checkboxes; the wording helpers sit in `hr-helpers.ts`.
 */

const STATUS_VARIANT = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'destructive',
  OFF: 'outline',
} as const;

/** The day's status as a pill; a green dot beside it while the person is still in. */
export function StatusBadge(props: { status: DayStatus; inNow?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-1.5', props.className)}>
      <Badge variant={STATUS_VARIANT[props.status]}>{t(`hr.statuses.${props.status}`)}</Badge>
      {props.inNow ? <InDot /> : null}
    </span>
  );
}

/** «Байна»: a small green dot with its text for screen readers. */
export function InDot() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-success">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      {t('hr.inNow')}
    </span>
  );
}

/** A round avatar of the person's initials (the first letters of the first two words). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[0.75rem] font-semibold text-secondary-foreground',
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** The time of an instant in Ulaanbaatar, or «—». */
export function TimeCell({ iso }: { iso: string | null }) {
  const { t } = useTranslation();
  return <>{iso ? formatUbTime(iso) : t('common.none')}</>;
}

/** Seven checkboxes, Monday first, bound to a `1111100` string. */
export function WeekdayChecks(props: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-3">
      {WEEKDAYS.map((day, index) => {
        const id = `${props.idPrefix}-${day}`;
        const checked = props.value[index] === '1';
        return (
          <Label key={day} htmlFor={id} className="flex items-center gap-1.5 font-normal">
            <Checkbox
              id={id}
              checked={checked}
              disabled={props.disabled}
              onCheckedChange={(next) => {
                const flags = props.value.padEnd(7, '0').split('');
                flags[index] = next === true ? '1' : '0';
                props.onChange(flags.join(''));
              }}
            />
            {t(`hr.weekdays.${day}`)}
          </Label>
        );
      })}
    </div>
  );
}
