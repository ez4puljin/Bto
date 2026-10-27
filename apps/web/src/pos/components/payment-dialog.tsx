import { useMutation, useQuery } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeApproval,
  EdgeCartLine,
  EdgeCustomer,
  EdgePrintableReceipt,
  EdgeQuotedVoucher,
  EdgeSaleRequest,
  EdgeTaxpayer,
  EdgeTenderInput,
  ReceiptType,
} from '@tugeel/shared/pos';
import { cn } from 'cn';
import {
  Banknote,
  Building2,
  CreditCard,
  HandCoins,
  Search,
  Shuffle,
  TriangleAlert,
  User,
  UserRound,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
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
import { edgeProblemOf } from '../edge-client';
import { useKiosk } from '../kiosk-context';
import { keepFocus, typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { KioskAlert } from './layout';

export interface PaymentAttempt {
  /** Drawn once per payment attempt and sent again on a retry: the edge answers the same receipt. */
  clientId: string;
  /** What is left to pay: the cart's total less what partner vouchers pay (ADR-0110). */
  total: string;
  lines: readonly EdgeCartLine[];
  /** ADR-0110: the coupons and partner vouchers taken, and the supervisor's PIN for them. */
  codes?: readonly string[];
  vouchers?: readonly EdgeQuotedVoucher[];
  voucherApproval?: EdgeApproval | null;
}

/** How the customer pays (ADR-0109): the cashier chooses it before the amounts. */
const PAY_MODES = ['CASH', 'CARD', 'MIXED', 'CREDIT'] as const;
type PayMode = (typeof PAY_MODES)[number];

/**
 * «Төлбөр (F12)» (ADR-0109): the payment chosen first — cash with the quick notes, card, the two
 * mixed, or credit to a registered customer (part of it paid now if the customer wishes) — then
 * the receipt, «Хувь хүн» or «Байгууллага» (a sale with credit gets none); Enter pays.
 */
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

const MODE_ICONS: Record<PayMode, ReactNode> = {
  CASH: <Banknote aria-hidden className="size-5" />,
  CARD: <CreditCard aria-hidden className="size-5" />,
  MIXED: <Shuffle aria-hidden className="size-5" />,
  CREDIT: <HandCoins aria-hidden className="size-5" />,
};

function PaymentForm(props: {
  attempt: PaymentAttempt;
  onCancel: () => void;
  onPaid: (receipt: EdgePrintableReceipt) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [mode, setMode] = useState<PayMode>('CASH');
  const [receiptType, setReceiptType] = useState<ReceiptType>('B2C');
  const [buyer, setBuyer] = useState<EdgeTaxpayer | null>(null);
  const [customer, setCustomer] = useState<EdgeCustomer | null>(null);
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [rrn, setRrn] = useState('');
  // The offline warning on a passed limit (ADR-0109 #7): the cashier goes on or not.
  const [overLimit, setOverLimit] = useState<string | null>(null);
  // A barcode scanned into an amount never becomes the amount, nor presses Enter (pays).
  const guard = useScanGuard(ignoreScan);
  const sale = useMutation({
    mutationFn: (body: EdgeSaleRequest) => client.sale(body),
    onSuccess: props.onPaid,
    onError: (error) => {
      const problem = edgeProblemOf(error);
      if (problem.code === 'POS_CREDIT_OFFLINE_OVER_LIMIT') {
        setOverLimit(textParam(problem.params?.excess));
      }
    },
  });

  const total = new Decimal(props.attempt.total);
  const vouchers = props.attempt.vouchers ?? [];
  // ADR-0110: partner vouchers may pay it all (nothing left to tender), and never beside credit.
  const nothingDue = total.isZero() && vouchers.length > 0;
  const partnerPaid = vouchers.some((voucher) => voucher.kind === 'PARTNER');
  const credit = mode === 'CREDIT' && !nothingDue;
  const takesCash = !nothingDue && (mode === 'CASH' || mode === 'MIXED' || credit);
  const takesCard = !nothingDue && (mode === 'CARD' || mode === 'MIXED' || credit);
  const cardAmount = mode === 'CARD' ? total : takesCard ? moneyOrZero(card) : new Decimal(0);
  const cashAmount = takesCash ? moneyOrZero(cash) : new Decimal(0);
  const cardOver = cardAmount !== null && cardAmount.gt(total);
  // The cash part is what the card leaves (on credit: what the customer pays now in cash); the
  // change is what the customer handed over beyond it.
  const cashDue = credit
    ? Decimal.min(cashAmount ?? new Decimal(0), total.minus(cardAmount ?? new Decimal(0)))
    : cardAmount !== null && !cardOver
      ? total.minus(cardAmount)
      : total;
  const creditAmount =
    credit && cashAmount !== null && cardAmount !== null && !cardOver
      ? Decimal.max(total.minus(cardAmount).minus(cashDue), 0)
      : new Decimal(0);
  const change =
    !credit && cashAmount !== null && cashDue.gt(0) && cashAmount.gt(cashDue)
      ? cashAmount.minus(cashDue)
      : new Decimal(0);
  const short =
    !credit && cashAmount !== null && cardAmount !== null && !cardOver
      ? Decimal.max(cashDue.minus(cashAmount), 0)
      : null;
  const amountsValid =
    nothingDue ||
    (total.gt(0) &&
    cashAmount !== null &&
    cardAmount !== null &&
    !cardOver &&
    (credit
      ? creditAmount.gt(0) && cashAmount.lte(total.minus(cardAmount))
      : cashAmount.plus(cardAmount).gte(total)));
  const receiptValid = credit || receiptType === 'B2C' || buyer !== null;
  const customerValid = !credit || (customer !== null && !customer.creditHold);
  const valid = amountsValid && receiptValid && customerValid;
  const quick = quickCash(cashDue);

  const pay = (acceptOverLimit: boolean) => {
    if (!valid || sale.isPending || cashAmount === null || cardAmount === null) return;
    const tenders: EdgeTenderInput[] = [];
    if (cashDue.gt(0)) {
      tenders.push({
        kind: 'CASH',
        amount: wireMoney(cashDue),
        tendered: wireMoney(credit ? cashDue : cashAmount),
      });
    }
    if (cardAmount.gt(0)) {
      tenders.push({
        kind: 'CARD',
        amount: wireMoney(cardAmount),
        terminalId: terminalId.trim() || null,
        rrn: rrn.trim() || null,
      });
    }
    if (credit) tenders.push({ kind: 'CREDIT', amount: wireMoney(creditAmount) });
    setOverLimit(null);
    sale.mutate({
      clientId: props.attempt.clientId,
      lines: [...props.attempt.lines],
      tenders,
      receiptType: credit ? 'B2C' : receiptType,
      buyer: !credit && receiptType === 'B2B' && buyer ? { tin: buyer.tin } : null,
      customerId: credit ? (customer?.id ?? null) : null,
      ...(acceptOverLimit ? { acceptOverLimit: true } : {}),
      ...(props.attempt.codes?.length
        ? {
            codes: [...props.attempt.codes],
            voucherApproval: props.attempt.voucherApproval ?? null,
          }
        : {}),
    });
  };
  // The credit check's refusal in the till's words (the generic message speaks of an order).
  const saleProblem = (error: unknown) => {
    const problem = edgeProblemOf(error);
    const reason = problem.params?.reason;
    if (
      problem.code === 'CREDIT_BLOCKED' &&
      (reason === 'HOLD' || reason === 'LIMIT' || reason === 'INACTIVE')
    ) {
      return t(`posKiosk.pay.credit.blocked.${reason}`, {
        excess: formatTugrik(textParam(problem.params?.excess)),
      });
    }
    return problemText(error);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    pay(false);
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="flex items-baseline justify-between rounded-xl bg-canvas px-4 py-3">
        <span className="text-[15px] font-medium text-muted-foreground">
          {vouchers.length > 0 ? t('posKiosk.vouchers.due') : t('posKiosk.pay.total')}
        </span>
        <span className="font-mono text-3xl font-semibold tracking-tight">
          {formatTugrik(props.attempt.total)}
        </span>
      </div>

      {vouchers.length > 0 ? (
        <ul aria-label={t('posKiosk.vouchers.taken')} className="space-y-1 text-[15px]">
          {vouchers.map((voucher) => (
            <li key={voucher.code} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-muted-foreground">
                {`${t(`posKiosk.vouchers.kinds.${voucher.kind}`)} · ${voucher.name}`}
              </span>
              <span className="font-mono">{`−${formatTugrik(voucher.amount)}`}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {nothingDue ? null : (
      <Segmented
        label={t('posKiosk.pay.mode.title')}
        value={mode}
        options={PAY_MODES.filter((value) => !(partnerPaid && value === 'CREDIT')).map((value) => ({
          value,
          label: t(`posKiosk.pay.mode.${value}`),
          icon: MODE_ICONS[value],
        }))}
        onChange={(value) => {
          setMode(value);
          setCash('');
          setCard('');
          setOverLimit(null);
        }}
      />
      )}

      {credit ? <CustomerSection customer={customer} onChange={setCustomer} /> : null}

      {takesCash ? (
        <section aria-labelledby="pay-cash-title" className="space-y-2">
          <h3 id="pay-cash-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <Banknote aria-hidden className="size-5 text-success" />
            {credit ? t('posKiosk.pay.credit.cashPart') : t('pos.tenderKinds.CASH')}
          </h3>
          <Label htmlFor="pay-cash" className="sr-only">
            {credit ? t('posKiosk.pay.credit.cashPart') : t('posKiosk.pay.cashReceived')}
          </Label>
          <Input
            id="pay-cash"
            autoFocus={!credit}
            inputMode="decimal"
            autoComplete="off"
            placeholder={credit ? t('posKiosk.pay.credit.paidNow') : t('posKiosk.pay.cashReceived')}
            className={cn(
              'text-right font-mono',
              credit ? 'h-12 text-xl md:text-xl' : 'h-14 text-2xl md:text-2xl',
            )}
            value={cash}
            aria-invalid={cashAmount === null}
            onChange={(event) => setCash(event.target.value)}
            onKeyDown={(event) => {
              guard(event, cash, setCash);
              if (!event.defaultPrevented) typeDigits(event, cash, setCash);
            }}
          />
          {credit ? null : (
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
          )}
        </section>
      ) : null}

      {takesCard ? (
        <section aria-labelledby="pay-card-title" className="space-y-2">
          <h3 id="pay-card-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <CreditCard aria-hidden className="size-5 text-link" />
            {credit ? t('posKiosk.pay.credit.cardPart') : t('pos.tenderKinds.CARD')}
          </h3>
          {mode === 'CARD' ? (
            <p className="flex items-baseline justify-between rounded-xl bg-canvas px-4 py-2">
              <span className="text-[15px] text-muted-foreground">
                {t('posKiosk.pay.cardAmount')}
              </span>
              <span className="font-mono text-xl font-semibold">
                {formatTugrik(props.attempt.total)}
              </span>
            </p>
          ) : (
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
              {credit ? null : (
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
              )}
            </div>
          )}
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
      ) : null}

      {credit ? (
        <p className="rounded-xl bg-canvas px-4 py-3 text-[15px] text-muted-foreground">
          {t('posKiosk.pay.receiptType.none')}
        </p>
      ) : (
        <div className="space-y-2">
          <Segmented
            label={t('posKiosk.pay.receiptType.title')}
            value={receiptType}
            options={[
              {
                value: 'B2C' as const,
                label: t('posKiosk.pay.receiptType.B2C'),
                icon: <UserRound aria-hidden className="size-5" />,
              },
              {
                value: 'B2B' as const,
                label: t('posKiosk.pay.receiptType.B2B'),
                icon: <Building2 aria-hidden className="size-5" />,
              },
            ]}
            onChange={(value) => {
              setReceiptType(value);
              if (value === 'B2C') setBuyer(null);
            }}
          />
          {receiptType === 'B2B' ? <BuyerSection buyer={buyer} onChange={setBuyer} /> : null}
        </div>
      )}

      {credit ? (
        <div
          role="status"
          className="flex items-baseline justify-between rounded-xl bg-warning-soft px-4 py-3 text-warning"
        >
          <span className="text-[15px] font-medium">{t('posKiosk.pay.credit.amount')}</span>
          <span className="font-mono text-3xl font-semibold tracking-tight">
            {formatTugrik(creditAmount.toFixed(2))}
          </span>
        </div>
      ) : nothingDue ? null : (
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
      )}

      {overLimit !== null ? (
        <div role="alert" className="space-y-2 rounded-xl bg-warning-soft p-3 text-warning">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <TriangleAlert aria-hidden className="size-5" />
            {t('posKiosk.pay.credit.overLimitTitle')}
          </p>
          <p className="text-sm">{t('posKiosk.pay.credit.overLimitText', { excess: overLimit })}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={sale.isPending}
            onClick={() => pay(true)}
          >
            {t('posKiosk.pay.credit.overLimitConfirm')}
          </Button>
        </div>
      ) : sale.isError ? (
        <KioskAlert>{saleProblem(sale.error)}</KioskAlert>
      ) : null}

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

/** A row of large choice buttons, one pressed (a radio group for screen readers). */
function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="space-y-1.5">
      <p className="text-[13px] font-medium text-muted-foreground">{props.label}</p>
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {props.options.map((option) => {
          const checked = option.value === props.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onMouseDown={keepFocus}
              onClick={() => props.onChange(option.value)}
              className={cn(
                'flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors',
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-muted',
              )}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The customer a sale on credit charges (ADR-0109): found by code, name, phone or registration
 * number in the edge's feed (offline too), with what is left of its limit; one on hold cannot be
 * chosen.
 */
function CustomerSection(props: {
  customer: EdgeCustomer | null;
  onChange: (customer: EdgeCustomer | null) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const found = useQuery({
    queryKey: ['kiosk', 'customers', query],
    queryFn: ({ signal }) => client.customers(query, signal),
    enabled: query.length > 0,
  });
  const available = (customer: EdgeCustomer) =>
    customer.available === null
      ? t('posKiosk.pay.credit.unlimited')
      : t('posKiosk.pay.credit.available', { amount: formatTugrik(customer.available) });
  return (
    <section aria-labelledby="pay-customer-title" className="space-y-2 rounded-xl bg-canvas p-3">
      <h3 id="pay-customer-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <User aria-hidden className="size-5 text-primary" />
        {t('posKiosk.pay.credit.title')}
      </h3>
      {props.customer ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0">
            <span className="block truncate font-semibold">{props.customer.name}</span>
            <span className="block font-mono text-sm text-muted-foreground">
              {`${props.customer.code} · ${available(props.customer)}`}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            onClick={() => props.onChange(null)}
          >
            {t('posKiosk.pay.credit.change')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              aria-label={t('posKiosk.pay.credit.search')}
              placeholder={t('posKiosk.pay.credit.search')}
              autoFocus
              autoComplete="off"
              maxLength={80}
              className="h-11 flex-1"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Enter finds the customer here; it never pays.
                event.preventDefault();
                setQuery(q.trim());
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4"
              disabled={!q.trim()}
              onClick={() => setQuery(q.trim())}
            >
              <Search />
              {t('posKiosk.pay.credit.find')}
            </Button>
          </div>
          {found.data && found.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('posKiosk.pay.credit.none')}</p>
          ) : null}
          {found.data && found.data.length > 0 ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {found.data.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    disabled={customer.creditHold}
                    onClick={() => props.onChange(customer)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{customer.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {customer.code}
                        {customer.phone ? ` · ${customer.phone}` : ''}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        customer.creditHold
                          ? 'font-semibold text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {customer.creditHold ? t('posKiosk.pay.credit.hold') : available(customer)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {found.isError ? <KioskAlert>{problemText(found.error)}</KioskAlert> : null}
        </>
      )}
    </section>
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
  const [no, setNo] = useState('');
  const lookup = useMutation({
    mutationFn: (value: string) => client.taxpayer(value),
    onSuccess: props.onChange,
  });
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
            }}
          >
            {t('posKiosk.pay.buyer.remove')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              aria-label={t('posKiosk.pay.buyer.number')}
              placeholder={t('posKiosk.pay.buyer.number')}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
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
          <p className="text-sm text-muted-foreground">
            {t('posKiosk.pay.receiptType.buyerNeeded')}
          </p>
        </>
      )}
      {lookup.isError ? <KioskAlert>{problemText(lookup.error)}</KioskAlert> : null}
    </section>
  );
}

/** A problem's amount parameter as text (the edge sends money as strings). */
function textParam(value: unknown): string {
  return typeof value === 'string' ? value : '0';
}
