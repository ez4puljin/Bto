import { Decimal } from '@tugeel/shared/money';
import { DENOMINATIONS, type EdgeDaySummary, denominationTotal } from '@tugeel/shared/pos';
import { cn } from 'cn';
import dayjs from 'dayjs';
import { Printer, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatCount, formatMnt, formatTugrik } from '@/lib/money';
import { randomUuid } from '@/lib/uuid';
import { todayInUb } from '../day';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { useCountDay, useDaySummary } from '../queries';
import { DayField } from './day-field';
import { KioskAlert } from './layout';
import { usePrint } from './print-context';

/** At most this many notes of one kind: the field takes digits only. */
const COUNT_DIGITS = 5;

/**
 * «Өдрийн нэгтгэл» (ADR-0111): the till's day by payment type and the cash it should hold; the
 * cashier counts the banknotes handed over, the count is kept on the edge and printed on the 80 mm
 * paper for both signatures. A count kept before fills the fields and can be printed again.
 */
export function DaySummaryDialog(props: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.daySummary.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.daySummary.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <DaySummaryPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DaySummaryPanel() {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [day, setDay] = useState(todayInUb);
  const summary = useDaySummary(day);
  const data = summary.data;
  return (
    <div className="max-h-[min(40rem,70svh)] space-y-4 overflow-y-auto">
      <DayField value={day} onChange={setDay} />
      {summary.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : summary.isError ? (
        <KioskAlert>{problemText(summary.error)}</KioskAlert>
      ) : data ? (
        <>
          <Figures summary={data} />
          <CountForm key={`${data.day}:${data.counted?.clientId ?? ''}`} summary={data} />
        </>
      ) : null}
    </div>
  );
}

function Figures({ summary }: { summary: EdgeDaySummary }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('posKiosk.daySummary.figures')} className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[0.9375rem]">
        <dt className="text-muted-foreground">{t('posKiosk.daySummary.till')}</dt>
        <dd className="text-right font-semibold">{summary.tillName}</dd>
        <dt className="text-muted-foreground">{t('posKiosk.daySummary.date')}</dt>
        <dd className="text-right font-mono">{summary.day}</dd>
        <dt className="text-muted-foreground">{t('posKiosk.daySummary.started')}</dt>
        <dd className="text-right font-mono">
          {summary.startedAt
            ? dayjs(summary.startedAt).tz(BUSINESS_TZ).format('HH:mm')
            : t('posKiosk.daySummary.none')}
        </dd>
        <dt className="text-muted-foreground">{t('posKiosk.daySummary.counts')}</dt>
        <dd className="text-right">
          {t('posKiosk.daySummary.countsValue', {
            sales: summary.salesCount,
            returns: summary.returnsCount,
          })}
        </dd>
      </dl>
      <table className="w-full text-[0.9375rem]">
        <caption className="sr-only">{t('posKiosk.daySummary.payments')}</caption>
        <tbody className="divide-y divide-border rounded-xl ring-1 ring-border">
          {summary.payments.length === 0 ? (
            <tr>
              <td className="px-4 py-2.5 text-muted-foreground">
                {t('posKiosk.daySummary.noPayments')}
              </td>
            </tr>
          ) : (
            summary.payments.map((payment) => (
              <tr key={`${payment.paymentTypeId ?? payment.kind}:${payment.name}`}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  {payment.name}
                </th>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">
                  {formatTugrik(payment.net)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-[0.9375rem]">
        <span className="font-medium">{t('posKiosk.daySummary.expectedCash')}</span>
        <span data-testid="day-expected" className="font-mono text-lg font-semibold">
          {formatTugrik(summary.expectedCash)}
        </span>
      </div>
    </section>
  );
}

function countOf(text: string | undefined): number {
  const value = Number.parseInt(text ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** The banknotes handed over: one field per note, the live total and its difference. */
function CountForm({ summary }: { summary: EdgeDaySummary }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const { printDaySummary } = usePrint();
  const countDay = useCountDay();
  const [counts, setCounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      (summary.counted?.counts ?? [])
        .filter((row) => row.count > 0)
        .map((row) => [row.note, String(row.count)]),
    ),
  );
  // One client id per count: a retry of the same notes after a timeout sends the same id.
  const pending = useRef<{ key: string; clientId: string } | null>(null);

  const rows = DENOMINATIONS.map((note) => ({ note, count: countOf(counts[note]) }));
  const total = denominationTotal(rows);
  const difference = total.minus(new Decimal(summary.expectedCash));
  const setCount = (note: number, text: string) =>
    setCounts((current) => ({
      ...current,
      [note]: text.replace(/\D/g, '').slice(0, COUNT_DIGITS),
    }));

  const save = () => {
    const key = JSON.stringify({ day: summary.day, rows });
    if (pending.current?.key !== key) pending.current = { key, clientId: randomUuid() };
    countDay.mutate(
      { clientId: pending.current.clientId, day: summary.day, counts: rows },
      {
        onSuccess: (saved) => {
          pending.current = null;
          printDaySummary(saved, new Date().toISOString());
        },
      },
    );
  };

  return (
    <section aria-label={t('posKiosk.daySummary.countTitle')} className="space-y-3">
      <h3 className="text-[0.9375rem] font-semibold">{t('posKiosk.daySummary.countTitle')}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {DENOMINATIONS.map((note) => {
          const value = counts[note] ?? '';
          return (
            <label key={note} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-right font-mono text-[0.9375rem]">
                {formatCount(note)}
              </span>
              <Input
                aria-label={t('posKiosk.daySummary.noteCount', { note: formatCount(note) })}
                inputMode="numeric"
                autoComplete="off"
                className="h-11 w-24 text-right font-mono text-base md:text-base"
                value={value}
                onChange={(event) => setCount(note, event.target.value)}
                onKeyDown={(event) => typeDigits(event, value, (next) => setCount(note, next))}
              />
              <span className="min-w-0 flex-1 truncate text-right font-mono text-sm text-muted-foreground">
                {formatMnt(new Decimal(note).times(countOf(value)).toFixed(2))}
              </span>
            </label>
          );
        })}
      </div>
      <dl className="space-y-1 border-t border-border pt-3 text-[0.9375rem]">
        <div className="flex justify-between">
          <dt className="font-medium">{t('posKiosk.daySummary.handedOver')}</dt>
          <dd data-testid="day-counted" className="font-mono text-lg font-semibold">
            {formatTugrik(total.toFixed(2))}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('posKiosk.daySummary.difference')}</dt>
          <dd
            data-testid="day-difference"
            className={cn(
              'font-mono font-semibold',
              difference.isZero()
                ? 'text-success'
                : difference.isNegative()
                  ? 'text-destructive'
                  : 'text-warning',
            )}
          >
            {difference.gt(0) ? '+' : null}
            {formatTugrik(difference.toFixed(2))}
          </dd>
        </div>
      </dl>
      {summary.counted ? (
        <p className="text-sm text-muted-foreground">
          {t('posKiosk.daySummary.countedBy', {
            name: summary.counted.cashierName,
            time: dayjs(summary.counted.countedAt).tz(BUSINESS_TZ).format('HH:mm'),
          })}
        </p>
      ) : null}
      {countDay.isError ? <KioskAlert>{problemText(countDay.error)}</KioskAlert> : null}
      <DialogFooter>
        {summary.counted ? (
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => printDaySummary(summary, new Date().toISOString())}
          >
            <Printer />
            {t('posKiosk.daySummary.reprint')}
          </Button>
        ) : null}
        <Button type="button" className="h-12" disabled={countDay.isPending} onClick={save}>
          <Save />
          {t('posKiosk.daySummary.save')}
        </Button>
      </DialogFooter>
    </section>
  );
}
