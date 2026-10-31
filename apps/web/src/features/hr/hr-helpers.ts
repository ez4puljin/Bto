import { isSystemRole } from '@tugeel/shared/auth';
import { hoursAndMinutes } from '@tugeel/shared/hr';
import { useTranslation } from 'react-i18next';

/*
 * Wording helpers the attendance pages share (ADR-0131); the components sit in `hr-kit.tsx`.
 */

export const WEEKDAYS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const;

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
