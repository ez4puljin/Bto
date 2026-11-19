import type { EbarimtPullReason } from '@tugeel/shared/ebarimt-check';
import { useTranslation } from 'react-i18next';
import { formatUbMinute } from '@/lib/dayjs';
import type { EbarimtConnection } from './api';

type LastPull = NonNullable<EbarimtConnection['lastPull']>;

/** The words for why a pull brought nothing; the service's own words follow when it gave any. */
export function usePullTexts() {
  const { t } = useTranslation();
  const reason = (code: EbarimtPullReason | null, message: string | null) => {
    const text = t(`ebarimtCheck.pull.reasons.${code ?? 'BAD_RESPONSE'}`);
    return message ? t('ebarimtCheck.pull.withMessage', { reason: text, message }) : text;
  };
  return {
    reason,
    /** «Сүүлд татсан: …, n баримт» or «Татаж чадсангүй: …». */
    status: (last: LastPull) =>
      last.ok
        ? t('ebarimtCheck.pull.last', {
            at: formatUbMinute(last.at),
            count: last.receipts ?? 0,
          })
        : t('ebarimtCheck.pull.failed', { reason: reason(last.reason, last.message) }),
  };
}
