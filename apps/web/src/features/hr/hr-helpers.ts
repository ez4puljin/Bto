import { isSystemRole } from '@tugeel/shared/auth';
import { hoursAndMinutes } from '@tugeel/shared/hr';
import { useTranslation } from 'react-i18next';

/*
 * Wording helpers the attendance pages share (ADR-0131); the components sit in `hr-kit.tsx`.
 */

export const WEEKDAYS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const;

/**
 * A row's title as the button that opens it (the keyboard's way in; the row itself is the finger's
 * and the mouse's): the text cuts inside it on one line (`<span className="block truncate">`), and
 * a finger still gets its reach above and below (ADR-0201).
 */
export const ROW_TITLE =
  'text-left font-medium text-link hover:underline touch:relative touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-3';

/** «7 ц 35 мин» for a minute count; under an hour only «35 мин». */
export function useWorded() {
  const { t } = useTranslation();
  return (minutes: number): string => {
    const parts = hoursAndMinutes(minutes);
    if (parts.hours === 0) return t('hr.minutes', { minutes: parts.minutes });
    return t('hr.hoursMinutes', { hours: parts.hours, minutes: parts.minutes });
  };
}

/** The Mongolian name of a system role, or the custom role's own name; several joined with «, ». */
export function useRoleLabel() {
  const { t } = useTranslation();
  return (roles: readonly string[]): string =>
    roles.map((role) => (isSystemRole(role) ? t(`roles.system.${role}`) : role)).join(', ');
}

/** «Да, Мя, Лх…» of a workdays string, for reading. */
export function useWorkdaysText() {
  const { t } = useTranslation();
  return (workdays: string): string =>
    WEEKDAYS.filter((_, index) => workdays[index] === '1')
      .map((day) => t(`hr.weekdays.${day}`))
      .join(', ');
}
