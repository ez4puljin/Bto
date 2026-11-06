import { useTranslation } from 'react-i18next';
import { formatUbTime } from '@/lib/dayjs';
import { useWorded } from './hr-helpers';
import type { HrTimeRequest } from './workforce-api';

/*
 * Wording of a time request (ADR-0144) the employees page and «Цагийн хүсэлт» share.
 */

/** «2026-11-04 – 2026-11-06», «2026-11-04 09:00–12:00» or «2026-11-04 Ирсэн 08:55». */
export function useRequestWhen() {
  const { t } = useTranslation();
  return (request: HrTimeRequest): string => {
    if (request.punchKind && request.startsAt) {
      return `${request.fromDate} ${t('hr.requests.punchValue', {
        kind: t(`hr.kinds.${request.punchKind}`),
        time: formatUbTime(request.startsAt),
      })}`;
    }
    if (request.startsAt && request.endsAt) {
      return `${request.fromDate} ${formatUbTime(request.startsAt)}–${formatUbTime(request.endsAt)}`;
    }
    return request.fromDate === request.toDate
      ? request.fromDate
      : `${request.fromDate} – ${request.toDate}`;
  };
}

/** «3 өдөр», «2 ц 30 мин» or nothing for a punch. */
export function useRequestLength() {
  const { t } = useTranslation();
  const worded = useWorded();
  return (request: HrTimeRequest): string => {
    if (request.punchKind) return t('common.none');
    if (request.wholeDays) return t('hr.requests.daysValue', { count: request.days });
    return request.minutes === null ? t('common.none') : worded(request.minutes);
  };
}
