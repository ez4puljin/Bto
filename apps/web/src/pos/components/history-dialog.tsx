import { useMutation } from '@tanstack/react-query';
import { type EdgeSaleListItem, TENDER_KINDS, type TenderKind } from '@tugeel/shared/pos';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight, Printer, Search } from 'lucide-react';
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
import { todayInUb } from '../day';
import { useKiosk } from '../kiosk-context';
import { useProblemText } from '../messages';
import { useSalesHistory } from '../queries';
import { DayField } from './day-field';
import { KioskAlert } from './layout';
import { useReprint } from './print-context';
import { ReceiptView } from './receipt';

const isTenderKind = (name: string): name is TenderKind =>
  (TENDER_KINDS as readonly string[]).includes(name);

/** «Борлуулалтын түүх» (ADR-0111): this till's sales and returns of a day; one opens on screen. */
export function HistoryDialog(props: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.history.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.history.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <HistoryPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}

function HistoryPanel() {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [day, setDay] = useState(todayInUb);
  const [q, setQ] = useState('');
  const history = useSalesHistory(day, q.trim());
  const reprint = useReprint();
  const opening = useMutation({ mutationFn: (clientId: string) => client.printReceipt(clientId) });
  // A payment type's name, or the kind's on a sale made before the payment types.
  const paymentName = (name: string) => (isTenderKind(name) ? t(`pos.tenderKinds.${name}`) : name);

  const opened = opening.data;
  if (opened) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="h-10 px-2"
            onClick={() => {
              opening.reset();
              reprint.reset();
            }}
          >
            <ChevronLeft />
            {t('posKiosk.history.backToList')}
          </Button>
          <Button
            variant="outline"
            className="h-10"
            disabled={reprint.isPending}
            onClick={() => reprint.mutate(opened.receipt.clientId)}
          >
            <Printer />
            {t('posKiosk.history.printCopy')}
          </Button>
        </div>
        {reprint.isError ? <KioskAlert>{problemText(reprint.error)}</KioskAlert> : null}
        <ReceiptView receipt={opened.receipt} copy={opened.copy} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DayField value={day} onChange={setDay} />
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-label={t('posKiosk.history.search')}
            placeholder={t('posKiosk.history.searchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-lg border border-input bg-background pr-3 pl-10 font-mono text-base shadow-control outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
      </div>
      {opening.isError ? <KioskAlert>{problemText(opening.error)}</KioskAlert> : null}
      {history.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : history.isError ? (
        <KioskAlert>{problemText(history.error)}</KioskAlert>
      ) : history.data.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">{t('posKiosk.history.empty')}</p>
      ) : (
        <ul className="max-h-[min(30rem,55svh)] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-border">
          {history.data.map((sale) => (
            <HistoryRow
              key={sale.clientId}
              sale={sale}
              payments={sale.payments.map(paymentName).join(' + ')}
              disabled={opening.isPending}
              onOpen={() => opening.mutate(sale.clientId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryRow(props: {
  sale: EdgeSaleListItem;
  payments: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { sale } = props;
  const refund = sale.kind === 'RETURN';
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
        aria-label={t('posKiosk.history.open', { number: sale.number })}
        disabled={props.disabled}
        onClick={props.onOpen}
      >
        <span className="w-14 shrink-0 font-mono text-muted-foreground">
          {dayjs(sale.soldAt).tz(BUSINESS_TZ).format('HH:mm')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono font-semibold">
            {sale.number}
            {refund ? (
              <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 font-sans text-xs text-destructive">
                {t('posKiosk.history.returnTag')}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {props.payments}
            {sale.customerName ? ` · ${sale.customerName}` : null}
          </span>
        </span>
        <span className="font-mono text-[15px] font-semibold">
          {refund ? '−' : null}
          {formatTugrik(sale.total)}
        </span>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
      </button>
    </li>
  );
}
