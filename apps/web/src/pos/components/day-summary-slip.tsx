import type { EdgeDaySummary } from '@tugeel/shared/pos';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatCount, formatMnt } from '@/lib/money';

const timeOf = (iso: string) => dayjs(iso).tz(BUSINESS_TZ).format('HH:mm');

/**
 * The day's summary on the 80 mm paper (ADR-0111), as the owner wrote it: the till and the day,
 * when it started and when this was printed, a line per payment type with dots for the hand-written
 * figure, the banknotes handed over (only the notes counted), and the two signature lines.
 */
export function DaySummarySlip({
  summary,
  printedAt,
}: {
  summary: EdgeDaySummary;
  printedAt: string;
}) {
  const { t } = useTranslation();
  const till = summary.tillName;
  const counted = summary.counted;
  const notes = (counted?.counts ?? []).filter((row) => row.count > 0);
  return (
    <article
      aria-label={t('posKiosk.daySummary.slip.label')}
      className="w-full space-y-3 bg-background px-1 py-2 font-mono text-[11px] leading-relaxed text-foreground"
    >
      <header className="space-y-0.5 border-b border-dashed border-input pb-2 text-center">
        <p className="font-sans text-[15px] font-semibold">
          {t('posKiosk.daySummary.slip.till', { till })}
        </p>
        <p>{summary.day}</p>
        <p>
          {t('posKiosk.daySummary.slip.started', {
            time: summary.startedAt ? timeOf(summary.startedAt) : t('posKiosk.daySummary.none'),
          })}
        </p>
        <p>{t('posKiosk.daySummary.slip.printed', { time: timeOf(printedAt) })}</p>
      </header>
      <ul className="space-y-1">
        {summary.payments.map((payment) => (
          <li key={`${payment.paymentTypeId ?? payment.kind}:${payment.name}`}>
            {t('posKiosk.daySummary.slip.payment', {
              name: payment.name,
              amount: formatMnt(payment.net),
            })}
          </li>
        ))}
      </ul>
      <section className="space-y-1 border-t border-dashed border-input pt-2">
        <p className="font-semibold">{t('posKiosk.daySummary.slip.notes')}</p>
        <ul>
          {notes.map((row) => (
            <li key={row.note}>
              {t('posKiosk.daySummary.slip.note', {
                note: formatCount(row.note),
                count: row.count,
              })}
            </li>
          ))}
        </ul>
        <p className="font-semibold">
          {t('posKiosk.daySummary.slip.total', { amount: formatMnt(counted?.total ?? '0') })}
        </p>
      </section>
      <footer className="space-y-3 border-t border-dashed border-input pt-3">
        <p>{t('posKiosk.daySummary.slip.handedBy', { till })}</p>
        <p>{t('posKiosk.daySummary.slip.receivedBy')}</p>
      </footer>
    </article>
  );
}

/** «Хэвлэгч шалгах»: the till, the time and a line that says the printer works. */
export function TestSlip({ tillName, printedAt }: { tillName: string; printedAt: string }) {
  const { t } = useTranslation();
  return (
    <article
      aria-label={t('posKiosk.printTest.label')}
      className="w-full space-y-1 bg-background px-1 py-2 text-center font-mono text-[11px] leading-relaxed text-foreground"
    >
      <p className="font-sans text-[15px] font-semibold">
        {t('posKiosk.daySummary.slip.till', { till: tillName })}
      </p>
      <p>{dayjs(printedAt).tz(BUSINESS_TZ).format('YYYY-MM-DD HH:mm')}</p>
      <p className="font-semibold">{t('posKiosk.printTest.works')}</p>
    </article>
  );
}
