import type { EdgeReceipt } from '@tugeel/shared/pos';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
import { useProblemText } from '../messages';
import { useRecentSales } from '../queries';
import { KioskAlert } from './layout';
import { ReceiptView } from './receipt';

/** «Сүүлийн баримтууд»: this shift's receipts, newest first; one opens on screen. */
export function RecentDialog(props: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.recent.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.recent.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <RecentPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RecentPanel() {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const recent = useRecentSales(true);
  const [open, setOpen] = useState<EdgeReceipt | null>(null);

  if (open) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" className="h-10 px-2" onClick={() => setOpen(null)}>
          <ChevronLeft />
          {t('posKiosk.recent.backToList')}
        </Button>
        <ReceiptView receipt={open} />
      </div>
    );
  }
  if (recent.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }
  if (recent.isError) return <KioskAlert>{problemText(recent.error)}</KioskAlert>;
  if (recent.data.length === 0) {
    return <p className="py-6 text-center text-muted-foreground">{t('posKiosk.recent.empty')}</p>;
  }
  return (
    <ul className="max-h-[min(30rem,60svh)] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-border">
      {recent.data.map((receipt) => (
        <li key={receipt.clientId}>
          <button
            type="button"
            className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            aria-label={t('posKiosk.recent.open', { number: receipt.number })}
            onClick={() => setOpen(receipt)}
          >
            <span className="w-14 shrink-0 font-mono text-muted-foreground">
              {dayjs(receipt.soldAt).tz(BUSINESS_TZ).format('HH:mm')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono font-semibold">
                {receipt.number}
                {receipt.kind === 'RETURN' ? (
                  <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 font-sans text-xs text-destructive">
                    {t('posKiosk.recent.returnTag')}
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {receipt.tenders.map((tender) => t(`pos.tenderKinds.${tender.kind}`)).join(' + ')}
                {' · '}
                {t('posKiosk.recent.lines', { count: receipt.lines.length })}
              </span>
            </span>
            <span className="font-mono text-[15px] font-semibold">
              {receipt.kind === 'RETURN' ? '−' : null}
              {formatTugrik(receipt.total)}
            </span>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}
