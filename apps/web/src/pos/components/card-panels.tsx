import type { EdgeCardAttempt } from '@tugeel/shared/pos';
import dayjs from 'dayjs';
import { CreditCard, Search, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';

const timeOf = (iso: string) => dayjs(iso).tz(BUSINESS_TZ).format('HH:mm');

/** While the terminal waits for the card and the PIN: nothing else on the payment can be pressed. */
export function CardWaiting(props: { name: string; amount: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="assertive"
      className="flex flex-col items-center gap-3 rounded-xl bg-info-soft px-6 py-10 text-center"
    >
      <CreditCard aria-hidden className="size-12 animate-pulse text-primary" />
      <p className="text-2xl font-semibold">{t('posKiosk.pay.card.waitingTitle')}</p>
      <p className="font-mono text-3xl font-semibold tracking-tight">
        {formatTugrik(props.amount)}
      </p>
      <p className="text-[0.9375rem] text-muted-foreground">
        {t('posKiosk.pay.card.waitingText', { name: props.name })}
      </p>
      <p className="text-sm font-medium text-warning">{t('posKiosk.pay.card.waitingHint')}</p>
    </div>
  );
}

/**
 * A charge (or a settlement) sent to the terminal and never answered: only the terminal's paper
 * slip tells whether the money moved. The cashier says which; nothing is sent again before that.
 */
export function UnansweredPanel(props: {
  attempt: EdgeCardAttempt;
  busy: boolean;
  onResolve: (outcome: 'APPROVED' | 'FAILED') => void;
  /** Asks the terminal itself about the charge's reference (free); absent: no terminal here. */
  onLookup?: (() => void) | undefined;
  lookingUp?: boolean;
  /** What the last lookup found, when it decided nothing. */
  lookupNote?: string | null;
}) {
  const { t } = useTranslation();
  const { attempt } = props;
  const settlement = attempt.kind === 'SETTLEMENT';
  return (
    <div role="alert" className="space-y-2 rounded-xl bg-warning-soft p-3 text-warning">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
        <TriangleAlert aria-hidden className="size-5" />
        {t(
          settlement
            ? 'posKiosk.pay.card.unknown.settlementTitle'
            : 'posKiosk.pay.card.unknown.title',
        )}
      </p>
      <p className="text-sm">
        {t(
          settlement
            ? 'posKiosk.pay.card.unknown.settlementText'
            : 'posKiosk.pay.card.unknown.text',
          {
            amount: formatTugrik(attempt.amount),
            time: timeOf(attempt.createdAt),
            refNo: attempt.refNo,
          },
        )}
      </p>
      {props.lookupNote ? <p className="text-sm font-medium">{props.lookupNote}</p> : null}
      <div className="flex flex-wrap gap-2">
        {props.onLookup && !settlement ? (
          <Button
            type="button"
            className="h-11"
            disabled={props.busy || props.lookingUp}
            onClick={props.onLookup}
          >
            <Search />
            {t(
              props.lookingUp
                ? 'posKiosk.pay.card.unknown.lookingUp'
                : 'posKiosk.pay.card.unknown.lookup',
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={props.busy}
          onClick={() => props.onResolve('APPROVED')}
        >
          {t('posKiosk.pay.card.unknown.charged')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={props.busy}
          onClick={() => props.onResolve('FAILED')}
        >
          {t('posKiosk.pay.card.unknown.notCharged')}
        </Button>
      </div>
    </div>
  );
}

/** Approved charges no sale has used: the payment was left, or the page was loaded again. */
export function UnusedPanel(props: {
  attempts: readonly EdgeCardAttempt[];
  busy: boolean;
  onUse: (attempt: EdgeCardAttempt) => void;
  onVoid: (attempt: EdgeCardAttempt) => void;
}) {
  const { t } = useTranslation();
  if (props.attempts.length === 0) return null;
  return (
    <section
      aria-labelledby="pay-card-unused-title"
      className="space-y-2 rounded-xl bg-info-soft p-3"
    >
      <h3 id="pay-card-unused-title" className="text-[0.9375rem] font-semibold">
        {t('posKiosk.pay.card.unused.title')}
      </h3>
      <ul className="space-y-2">
        {props.attempts.map((attempt) => (
          <li key={attempt.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-sm">
              {t('posKiosk.pay.card.unused.text', {
                amount: formatTugrik(attempt.amount),
                time: timeOf(attempt.createdAt),
                refNo: attempt.refNo,
              })}
            </span>
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={props.busy}
              onClick={() => props.onUse(attempt)}
            >
              {t('posKiosk.pay.card.unused.use')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              disabled={props.busy}
              onClick={() => props.onVoid(attempt)}
            >
              {t('posKiosk.pay.card.unused.void')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
