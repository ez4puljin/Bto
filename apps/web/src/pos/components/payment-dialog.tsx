import { useMutation } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeCartLine,
  EdgePrintableReceipt,
  EdgeSaleRequest,
  EdgeTaxpayer,
  EdgeTenderInput,
} from '@tugeel/shared/pos';
import { cn } from 'cn';
import { Banknote, Building2, CreditCard, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { formatTugrik } from '@/lib/money';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { fieldMoney, moneyOrZero, quickCash, wireMoney } from '../amounts';
import { useKiosk } from '../kiosk-context';
import { keepFocus, typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { KioskAlert } from './layout';

export interface PaymentAttempt {
  /** Drawn once per payment attempt and sent again on a retry: the edge answers the same receipt. */
  clientId: string;
  total: string;
  lines: readonly EdgeCartLine[];
}

/** «Төлбөр (F12)»: cash with the quick notes, card for the rest, change live; Enter pays. */
export function PaymentDialog(props: {
  open: boolean;
  /** Kept while the dialog fades out, so its content does not collapse. */
  attempt: PaymentAttempt | null;
  onClose: () => void;
  onPaid: (receipt: EdgePrintableReceipt) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const { attempt } = props;
  return (
    <Dialog
      open={props.open && attempt !== null}
      onOpenChange={(open) => (open ? undefined : props.onClose())}
    >
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.pay.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.pay.description')}</DialogDescription>
        </DialogHeader>
        {attempt ? (
          <PaymentForm
            key={attempt.clientId}
            attempt={attempt}
            onCancel={props.onClose}
            onPaid={props.onPaid}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ignoreScan(): void {
  // A scan during the payment is dropped; the cart is closed while the customer pays.
}

function PaymentForm(props: {
  attempt: PaymentAttempt;
  onCancel: () => void;
  onPaid: (receipt: EdgePrintableReceipt) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [buyer, setBuyer] = useState<EdgeTaxpayer | null>(null);
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [rrn, setRrn] = useState('');
  // A barcode scanned into an amount never becomes the amount, nor presses Enter (pays).
  const guard = useScanGuard(ignoreScan);
  const sale = useMutation({
    mutationFn: (body: EdgeSaleRequest) => client.sale(body),
    onSuccess: props.onPaid,
  });

  const total = new Decimal(props.attempt.total);
  const cardAmount = moneyOrZero(card);
  const cashAmount = moneyOrZero(cash);
  const cardOver = cardAmount !== null && cardAmount.gt(total);
  // The cash part is what the card leaves; the change is what the customer handed over beyond it.
  const cashDue = cardAmount !== null && !cardOver ? total.minus(cardAmount) : total;
  const change =
    cashAmount !== null && cashDue.gt(0) && cashAmount.gt(cashDue)
      ? cashAmount.minus(cashDue)
      : new Decimal(0);
  const short =
    cashAmount !== null && cardAmount !== null && !cardOver
      ? Decimal.max(cashDue.minus(cashAmount), 0)
      : null;
  const valid =
    total.gt(0) &&
    cashAmount !== null &&
    cardAmount !== null &&
    !cardOver &&
    cashAmount.plus(cardAmount).gte(total);
  const quick = quickCash(cashDue);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || sale.isPending) return;
    const tenders: EdgeTenderInput[] = [];
    if (cashDue.gt(0)) {
      tenders.push({ kind: 'CASH', amount: wireMoney(cashDue), tendered: wireMoney(cashAmount) });
    }
    if (cardAmount.gt(0)) {
      tenders.push({
        kind: 'CARD',
        amount: wireMoney(cardAmount),
        terminalId: terminalId.trim() || null,
        rrn: rrn.trim() || null,
      });
    }
    sale.mutate({
      clientId: props.attempt.clientId,
      lines: [...props.attempt.lines],
      tenders,
      buyer: buyer ? { tin: buyer.tin } : null,
    });
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="flex items-baseline justify-between rounded-xl bg-canvas px-4 py-3">
        <span className="text-[15px] font-medium text-muted-foreground">
          {t('posKiosk.pay.total')}
        </span>
        <span className="font-mono text-3xl font-semibold tracking-tight">
          {formatTugrik(props.attempt.total)}
        </span>
      </div>

      <section aria-labelledby="pay-cash-title" className="space-y-2">
        <h3 id="pay-cash-title" className="flex items-center gap-2 text-[15px] font-semibold">
          <Banknote aria-hidden className="size-5 text-success" />
          {t('pos.tenderKinds.CASH')}
        </h3>
        <Label htmlFor="pay-cash" className="sr-only">
          {t('posKiosk.pay.cashReceived')}
        </Label>
        <Input
          id="pay-cash"
          autoFocus
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('posKiosk.pay.cashReceived')}
          className="h-14 text-right font-mono text-2xl md:text-2xl"
          value={cash}
          aria-invalid={cashAmount === null}
          onChange={(event) => setCash(event.target.value)}
          onKeyDown={(event) => {
            guard(event, cash, setCash);
            if (!event.defaultPrevented) typeDigits(event, cash, setCash);
          }}
        />
        <div role="group" aria-label={t('posKiosk.pay.quick')} className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onMouseDown={keepFocus}
            className="h-11 px-4 text-[15px]"
            disabled={cashDue.lte(0)}
            onClick={() => setCash(fieldMoney(cashDue))}
          >
            {t('posKiosk.pay.exact')}
          </Button>
          {quick.map((amount) => (
            <Button
              key={amount.toFixed(2)}
              type="button"
              variant="outline"
              onMouseDown={keepFocus}
              className="h-11 px-4 font-mono text-[15px]"
              onClick={() => setCash(fieldMoney(amount))}
            >
              {formatTugrik(amount.toFixed(2))}
            </Button>
          ))}
        </div>
      </section>

      <section aria-labelledby="pay-card-title" className="space-y-2">
        <h3 id="pay-card-title" className="flex items-center gap-2 text-[15px] font-semibold">
          <CreditCard aria-hidden className="size-5 text-link" />
          {t('pos.tenderKinds.CARD')}
        </h3>
        <div className="flex gap-2">
          <Label htmlFor="pay-card" className="sr-only">
            {t('posKiosk.pay.cardAmount')}
          </Label>
          <Input
            id="pay-card"
            inputMode="decimal"
            autoComplete="off"
            placeholder={t('posKiosk.pay.cardAmount')}
            className="h-12 flex-1 text-right font-mono text-xl md:text-xl"
            value={card}
            aria-invalid={cardAmount === null || cardOver}
            aria-describedby={cardOver ? 'pay-card-error' : undefined}
            onChange={(event) => setCard(event.target.value)}
            onKeyDown={(event) => {
              guard(event, card, setCard);
              if (!event.defaultPrevented) typeDigits(event, card, setCard);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onMouseDown={keepFocus}
            className="h-12 px-4 text-[15px]"
            onClick={() => {
              const paidCash =
                cashAmount !== null ? Decimal.min(cashAmount, total) : new Decimal(0);
              setCard(fieldMoney(total.minus(paidCash)));
            }}
          >
            {t('posKiosk.pay.cardRest')}
          </Button>
        </div>
        {cardOver ? (
          <p id="pay-card-error" className="text-sm text-destructive">
            {t('posKiosk.pay.cardTooMuch')}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={t('posKiosk.pay.terminalId')}
            placeholder={t('posKiosk.pay.terminalId')}
            autoComplete="off"
            maxLength={40}
            className="h-10"
            value={terminalId}
            onChange={(event) => setTerminalId(event.target.value)}
          />
          <Input
            aria-label={t('posKiosk.pay.rrn')}
            placeholder={t('posKiosk.pay.rrn')}
            autoComplete="off"
            maxLength={40}
            className="h-10"
            value={rrn}
            onChange={(event) => setRrn(event.target.value)}
          />
        </div>
      </section>

      <BuyerSection buyer={buyer} onChange={setBuyer} />

      <div
        role="status"
        className={cn(
          'flex items-baseline justify-between rounded-xl px-4 py-3',
          short !== null && short.gt(0)
            ? 'bg-warning-soft text-warning'
            : 'bg-success-soft text-success',
        )}
      >
        <span className="text-[15px] font-medium">
          {short !== null && short.gt(0) ? t('posKiosk.pay.short') : t('posKiosk.pay.change')}
        </span>
        <span className="font-mono text-3xl font-semibold tracking-tight">
          {formatTugrik((short !== null && short.gt(0) ? short : change).toFixed(2))}
        </span>
      </div>

      {sale.isError ? <KioskAlert>{problemText(sale.error)}</KioskAlert> : null}

      <DialogFooter>
        <Button type="button" variant="ghost" className="h-11" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="h-11 px-6 text-base" disabled={!valid || sale.isPending}>
          {sale.isPending ? t('posKiosk.pay.pending') : t('posKiosk.pay.confirm')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * A company's receipt (B2B, ADR-0065): its registration number or TIN, the name from the tax
 * office's lookup; only online (owner 2026-10-26), otherwise the receipt is a citizen's.
 */
function BuyerSection(props: {
  buyer: EdgeTaxpayer | null;
  onChange: (buyer: EdgeTaxpayer | null) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState('');
  const lookup = useMutation({
    mutationFn: (value: string) => client.taxpayer(value),
    onSuccess: props.onChange,
  });
  if (!open && !props.buyer) {
    return (
      <Button
        type="button"
        variant="outline"
        onMouseDown={keepFocus}
        className="h-11 justify-start gap-2 text-[15px]"
        onClick={() => setOpen(true)}
      >
        <Building2 className="size-5" />
        {t('posKiosk.pay.buyer.open')}
      </Button>
    );
  }
  return (
    <section aria-labelledby="pay-buyer-title" className="space-y-2 rounded-xl bg-canvas p-3">
      <h3 id="pay-buyer-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <Building2 aria-hidden className="size-5 text-primary" />
        {t('posKiosk.pay.buyer.title')}
      </h3>
      {props.buyer ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0">
            <span className="block truncate font-semibold">{props.buyer.name}</span>
            <span className="block font-mono text-sm text-muted-foreground">
              {t('posKiosk.receipt.buyerTin', { tin: props.buyer.tin })}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            onClick={() => {
              props.onChange(null);
              setNo('');
              setOpen(false);
            }}
          >
            {t('posKiosk.pay.buyer.remove')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            aria-label={t('posKiosk.pay.buyer.number')}
            placeholder={t('posKiosk.pay.buyer.number')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            className="h-11 flex-1 font-mono"
            value={no}
            onChange={(event) => setNo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter finds the company here; it never pays.
              event.preventDefault();
              if (no.trim()) lookup.mutate(no.trim());
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-11 px-4"
            disabled={!no.trim() || lookup.isPending}
            onClick={() => lookup.mutate(no.trim())}
          >
            <Search />
            {lookup.isPending ? t('posKiosk.pay.buyer.finding') : t('posKiosk.pay.buyer.find')}
          </Button>
        </div>
      )}
      {lookup.isError ? <KioskAlert>{problemText(lookup.error)}</KioskAlert> : null}
    </section>
  );
}
