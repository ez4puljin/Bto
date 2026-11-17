import type { EdgeSession } from '@tugeel/shared/pos';
import { cn } from 'cn';
import dayjs from 'dayjs';
import { CreditCard, LoaderCircle, RefreshCw } from 'lucide-react';
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
import { useCardTerminalStatus } from '../queries';

/**
 * ADR-0208: whether this till PC's bank card terminal answers, beside the «Холбогдсон» pill.
 * Shown only when a payment type of the till drives a terminal; then it asks the terminal's
 * service itself (the payment dialog shares the same query). Pressing it opens a small panel:
 * the state in words, the terminal's name and port, the last check, «Холболт шалгах» and the
 * card charges list. Nothing here moves money.
 */
export function TerminalPill(props: {
  session: EdgeSession;
  onOpenCards: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const hasTerminal = (props.session.paymentTypes ?? []).some((type) => Boolean(type.terminal));
  if (!hasTerminal) return null;
  return <TerminalPillBody {...props} />;
}

function TerminalPillBody(props: {
  onOpenCards: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const status = useCardTerminalStatus(true);
  const [open, setOpen] = useState(false);
  const checking = status.isFetching;
  const ready = status.isSuccess;
  const state = checking
    ? {
        tone: 'bg-fill text-muted-foreground',
        dot: 'bg-muted-foreground',
        text: t('posKiosk.terminal.checking'),
      }
    : ready
      ? { tone: 'bg-success-soft text-success', dot: 'bg-success', text: t('posKiosk.terminal.ready') }
      : {
          tone: 'bg-warning-soft text-warning',
          dot: 'bg-warning',
          text: t('posKiosk.terminal.offline'),
        };
  const checkedAt = Math.max(status.dataUpdatedAt, status.errorUpdatedAt);
  const info = status.data;
  return (
    <>
      <button
        type="button"
        aria-label={t('posKiosk.terminal.label', { status: state.text })}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 text-[0.8125rem] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11',
          state.tone,
        )}
      >
        <span aria-hidden className={cn('size-2 rounded-full', state.dot)} />
        {state.text}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent guard={false} onCloseAutoFocus={props.onCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>{t('posKiosk.terminal.title')}</DialogTitle>
            <DialogDescription>{state.text}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[0.9375rem]">
            {ready && info ? (
              <p>
                {t('posKiosk.terminal.info', {
                  name: info.terminalName ?? info.terminalId ?? '',
                  port: info.port ?? '—',
                })}
              </p>
            ) : null}
            {!ready && !checking ? (
              <p className="text-warning">{t('posKiosk.terminal.hint')}</p>
            ) : null}
            {checkedAt > 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('posKiosk.terminal.checkedAt', {
                  time: dayjs(checkedAt).tz(BUSINESS_TZ).format('HH:mm:ss'),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={checking}
              onClick={() => void status.refetch()}
            >
              {checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {t('posKiosk.terminal.recheck')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setOpen(false);
                props.onOpenCards();
              }}
            >
              <CreditCard />
              {t('posKiosk.terminal.history')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
