import { useMutation } from '@tanstack/react-query';
import type { EdgeCardAttempt } from '@tugeel/shared/pos';
import { cn } from 'cn';
import dayjs from 'dayjs';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { type LookupResult, lookupOnTerminal } from '../card-charge';
import { todayInUb } from '../day';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { useCardAttempts } from '../queries';
import { DayField } from './day-field';
import { KioskAlert } from './layout';

const TONES: Record<EdgeCardAttempt['status'], string> = {
  PENDING: 'bg-warning-soft text-warning',
  APPROVED: 'bg-success-soft text-success',
  DECLINED: 'bg-danger-soft text-destructive',
  FAILED: 'bg-danger-soft text-destructive',
  VOIDED: 'bg-canvas text-muted-foreground',
};

/**
 * «Картын гүйлгээ» (ADR-0208): what this till sent its bank terminal on a day — every charge and
 * settlement with how it ended, the sale it paid, and the card, RRN, trace and batch the terminal
 * named. The list is the edge's own record: the terminal has no list to give. One charge can be
 * asked of the terminal by its reference («Терминалаас лавлах», free), which also fills its
 * facts and settles a charge that never got its answer.
 */
export function CardHistoryDialog(props: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" guard={false} onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.cards.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.cards.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <CardHistoryPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CardHistoryPanel() {
  const { t } = useTranslation();
  const { client, terminal } = useKiosk();
  const problemText = useProblemText();
  const [day, setDay] = useState(todayInUb);
  const attempts = useCardAttempts(day);
  const [asked, setAsked] = useState<{ id: string; result: LookupResult } | null>(null);
  const lookup = useMutation({
    mutationFn: (attempt: EdgeCardAttempt): Promise<LookupResult> =>
      terminal
        ? lookupOnTerminal({ client, terminal }, attempt)
        : Promise.resolve({ kind: 'UNKNOWN', message: null }),
    onSuccess: (result, attempt) => {
      setAsked({ id: attempt.id, result });
      void attempts.refetch();
    },
  });
  const noteOf = (result: LookupResult) =>
    result.kind === 'APPROVED'
      ? t('posKiosk.cards.found')
      : result.kind === 'NONE'
        ? t('posKiosk.cards.none')
        : result.kind === 'MISMATCH'
          ? t('posKiosk.cards.mismatch', { amount: formatTugrik(result.amount ?? '0') })
          : result.kind === 'ERROR'
            ? problemText(result.error)
            : t('posKiosk.cards.unknown');

  return (
    <div className="min-w-0 space-y-3">
      <DayField value={day} onChange={setDay} />
      {attempts.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : attempts.isError ? (
        <KioskAlert>{problemText(attempts.error)}</KioskAlert>
      ) : attempts.data.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">{t('posKiosk.cards.empty')}</p>
      ) : (
        <ul className="max-h-[min(32rem,60svh)] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-border">
          {attempts.data.map((attempt) => (
            <li key={attempt.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm text-muted-foreground">
                  {dayjs(attempt.createdAt).tz(BUSINESS_TZ).format('HH:mm')}
                </span>
                <span className="font-mono text-base font-semibold">
                  {attempt.kind === 'SETTLEMENT'
                    ? t('posKiosk.cards.settlement')
                    : formatTugrik(attempt.amount)}
                </span>
                <span
                  className={cn(
                    'rounded-lg px-2 py-0.5 text-[0.8125rem] font-semibold',
                    TONES[attempt.status],
                  )}
                >
                  {t(`posKiosk.cards.statuses.${attempt.status}`)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {[
                    attempt.saleNumber
                      ? t('posKiosk.cards.sale', { number: attempt.saleNumber })
                      : attempt.kind === 'SALE' && attempt.status === 'APPROVED'
                        ? t('posKiosk.cards.unused')
                        : null,
                    attempt.source === 'CASHIER' ? t('posKiosk.cards.byCashier') : null,
                    attempt.cashierName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {terminal && attempt.kind === 'SALE' ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    aria-label={t('posKiosk.cards.lookupOf', { refNo: attempt.refNo })}
                    disabled={lookup.isPending}
                    onClick={() => lookup.mutate(attempt)}
                  >
                    <Search />
                    {t('posKiosk.cards.lookup')}
                  </Button>
                ) : null}
              </div>
              <p className="font-mono text-xs break-words text-muted-foreground">
                {[
                  t('posKiosk.cards.refNo', { refNo: attempt.refNo }),
                  attempt.details?.maskedPan
                    ? t('posKiosk.cards.card', { pan: attempt.details.maskedPan })
                    : null,
                  attempt.details?.rrn
                    ? t('posKiosk.cards.rrn', { rrn: attempt.details.rrn })
                    : null,
                  attempt.details?.traceNo
                    ? t('posKiosk.cards.trace', { trace: attempt.details.traceNo })
                    : null,
                  attempt.details?.batchNo
                    ? t('posKiosk.cards.batch', { batch: attempt.details.batchNo })
                    : null,
                  attempt.details?.entryMode ?? null,
                  attempt.details?.appName ?? null,
                  attempt.message,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {asked?.id === attempt.id ? (
                <p role="status" className="text-sm font-medium">
                  {noteOf(asked.result)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
