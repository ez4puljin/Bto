import type { EdgeParkedBasket } from '@tugeel/shared/pos';
import dayjs from 'dayjs';
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
import { useProblemText } from '../messages';
import { useParked } from '../queries';
import { KioskAlert } from './layout';

/**
 * «Хадгалсан сагс (F10)» (ADR-0104): this till's parked baskets, oldest first; «Дуудах» puts one
 * back into the empty cart at today's prices, «Цуцлах» drops it with a supervisor's approval.
 */
export function ParkedDialog(props: {
  open: boolean;
  /** A basket comes back only into an empty cart. */
  cartEmpty: boolean;
  onClose: () => void;
  onResume: (basket: EdgeParkedBasket) => void;
  onDiscard: (basket: EdgeParkedBasket) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.parked.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.parked.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? (
          <ParkedList
            cartEmpty={props.cartEmpty}
            onResume={props.onResume}
            onDiscard={props.onDiscard}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ParkedList(props: {
  cartEmpty: boolean;
  onResume: (basket: EdgeParkedBasket) => void;
  onDiscard: (basket: EdgeParkedBasket) => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const parked = useParked();
  if (parked.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (parked.isError) return <KioskAlert>{problemText(parked.error)}</KioskAlert>;
  if (parked.data.length === 0) {
    return <p className="py-6 text-center text-muted-foreground">{t('posKiosk.parked.empty')}</p>;
  }
  return (
    <div className="space-y-3">
      {props.cartEmpty ? null : (
        <KioskAlert tone="warning">{t('posKiosk.parked.cartNotEmpty')}</KioskAlert>
      )}
      <ul className="max-h-[min(30rem,60svh)] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-border">
        {parked.data.map((basket) => {
          const time = dayjs(basket.parkedAt).tz(BUSINESS_TZ).format('HH:mm');
          return (
            <li key={basket.clientId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-medium">
                  {basket.preview}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('posKiosk.parked.meta', {
                    time,
                    cashier: basket.cashierName,
                    count: basket.itemCount,
                  })}
                </span>
              </span>
              <span className="font-mono text-[0.9375rem] font-semibold">
                {formatTugrik(basket.total)}
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                aria-label={t('posKiosk.parked.discardLabel', { time })}
                onClick={() => props.onDiscard(basket)}
              >
                {t('posKiosk.parked.discard')}
              </Button>
              <Button
                type="button"
                className="h-10"
                disabled={!props.cartEmpty}
                aria-label={t('posKiosk.parked.resumeLabel', { time })}
                onClick={() => props.onResume(basket)}
              >
                {t('posKiosk.parked.resume')}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
