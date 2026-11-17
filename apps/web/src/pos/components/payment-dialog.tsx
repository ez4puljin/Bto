import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import type {
  CardTerminal,
  EdgeApproval,
  EdgeCardAttempt,
  EdgeCartLine,
  EdgeCustomer,
  EdgeMember,
  EdgePrintableReceipt,
  EdgeQuotedVoucher,
  EdgeSaleRequest,
  EdgeTaxpayer,
  EdgeTenderInput,
  ReceiptType,
  SnapshotPaymentType,
  TenderKind,
} from '@tugeel/shared/pos';
import { cn } from 'cn';
import {
  ArrowLeft,
  Banknote,
  Building2,
  CreditCard,
  Gift,
  HandCoins,
  Landmark,
  Search,
  Ticket,
  TriangleAlert,
  User,
  UserRound,
  X,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
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
import { formatMnt, formatTugrik } from '@/lib/money';
import { useDebounced } from '@/lib/use-debounced';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { fieldMoney, moneyOrZero, quickCash, wireMoney } from '../amounts';
import { type ChargeResult, chargeOnTerminal, recordOutcome } from '../card-charge';
import { edgeProblemOf } from '../edge-client';
import { TerminalUnavailable } from '../khan-terminal';
import { useKiosk } from '../kiosk-context';
import { keepFocus, typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { useSession } from '../queries';
import { CardWaiting, TerminalStatusLine, UnansweredPanel, UnusedPanel } from './card-panels';
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
  /** ADR-0112: the bonus card member found by phone; points are spent with the member's PIN. */
  member?: EdgeMember | null;
}

/** A way to pay as the till lists it; an edge older than ADR-0111 has kinds only (no id). */
interface PayType {
  id: number | null;
  name: string;
  kind: TenderKind;
  /** ADR-0208: the bank terminal the till drives for this card type. */
  terminal?: CardTerminal | null;
}

/** A card type whose amount the till sends to its terminal itself (ADR-0208). */
const driven = (type: PayType): boolean =>
  type.kind === 'CARD' && type.id !== null && Boolean(type.terminal);

/** Where a card charge of this payment stands (ADR-0208); `idle`: nothing to say. */
type CardPhase =
  | { phase: 'idle' }
  | { phase: 'waiting'; name: string; amount: string }
  | { phase: 'refused'; message: string | null }
  | { phase: 'offline' }
  | { phase: 'blocked'; error: unknown }
  | { phase: 'unrecorded'; rowKey: number; held: Extract<ChargeResult, { kind: 'UNRECORDED' }> };

/** One payment row the cashier added: its type, its amount, a card's slip facts. */
interface PayRow {
  key: number;
  type: PayType;
  amount: string;
}

/**
 * «Төлбөр (F12)» (ADR-0111, owner 2026-10-27): the admin's payment types as buttons (1–9 add the
 * one in that place). It opens with the first type (cash) for the whole amount (owner 2026-11-04:
 * «илүү ухаалаг хялбар»); a tap on another type while one row pays it all swaps that row, otherwise
 * it adds a row with what is left — cash may exceed it (the change), the rest may not; a CREDIT row
 * needs its customer (ADR-0109). A card row of a type without a terminal asks nothing more (the
 * cashier keys the amount on the bank's terminal); one with a terminal (ADR-0208) is sent to the
 * terminal when the sale is paid, and the sale is written only after the terminal approved. When
 * the rows make the total, «Баримт хэвлэх» asks «Хувь хүн НӨАТ» or «Байгууллага НӨАТ» — a sale
 * with credit prints its slip without VAT at once.
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
  // ADR-0208: while the terminal waits for the card the payment cannot be closed.
  const [locked, setLocked] = useState(false);
  return (
    <Dialog
      open={props.open && attempt !== null}
      onOpenChange={(open) => (open || locked ? undefined : props.onClose())}
    >
      <DialogContent
        size="lg"
        onCloseAutoFocus={props.onCloseAutoFocus}
        // The form, not the prefilled amount, takes the focus: 1–9 pick a type, Enter goes on.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.target as HTMLElement | null)
            ?.querySelector<HTMLFormElement>('form[data-pay-form]')
            ?.focus();
        }}
      >
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
            onBusy={setLocked}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ignoreScan(): void {
  // A scan during the payment is dropped; the cart is closed while the customer pays.
}

const KIND_ICONS: Record<TenderKind, ReactNode> = {
  CASH: <Banknote aria-hidden className="size-5" />,
  CARD: <CreditCard aria-hidden className="size-5" />,
  TRANSFER: <Landmark aria-hidden className="size-5" />,
  CREDIT: <HandCoins aria-hidden className="size-5" />,
  VOUCHER: <Ticket aria-hidden className="size-5" />,
  POINTS: <Gift aria-hidden className="size-5" />,
};

/** The till's types; an older edge sends none, so its kinds stand in for them. */
function usePayTypes(): PayType[] {
  const { t } = useTranslation();
  const session = useSession();
  const types: readonly SnapshotPaymentType[] | undefined = session.data?.paymentTypes;
  if (types && types.length > 0) return types.map((type) => ({ ...type }));
  return (['CASH', 'CARD', 'CREDIT'] as const).map((kind) => ({
    id: null,
    name: t(`pos.tenderKinds.${kind}`),
    kind,
  }));
}

function PaymentForm(props: {
  attempt: PaymentAttempt;
  onCancel: () => void;
  onPaid: (receipt: EdgePrintableReceipt) => void;
  /** ADR-0208: the terminal is waiting for a card; the dialog stays open. */
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const { client, terminal } = useKiosk();
  const problemText = useProblemText();
  const vouchers = props.attempt.vouchers ?? [];
  // ADR-0110: no credit beside a partner voucher; partner vouchers may leave nothing to pay.
  const partnerPaid = vouchers.some((voucher) => voucher.kind === 'PARTNER');
  // ADR-0112: a member pays with points (a row of its own) and never on credit.
  const member = props.attempt.member ?? null;
  const balance = member ? Decimal.max(new Decimal(member.balance).floor(), 0) : new Decimal(0);
  const types = [
    ...usePayTypes().filter((type) => !((partnerPaid || member) && type.kind === 'CREDIT')),
    ...(member && balance.gt(0)
      ? [{ id: null, name: t('pos.tenderKinds.POINTS'), kind: 'POINTS' as const }]
      : []),
  ];
  const [pin, setPin] = useState('');
  const [rows, setRows] = useState<PayRow[]>(() => {
    const first =
      types.find((type) => type.kind === 'CASH') ?? types.find((type) => type.kind === 'CARD');
    const due = new Decimal(props.attempt.total);
    return first && due.gt(0) ? [{ key: 1, type: first, amount: fieldMoney(due) }] : [];
  });
  const [nextKey, setNextKey] = useState(2);
  const [step, setStep] = useState<'rows' | 'receipt'>('rows');
  const [receiptType, setReceiptType] = useState<ReceiptType>('B2C');
  const [buyer, setBuyer] = useState<EdgeTaxpayer | null>(null);
  const [customer, setCustomer] = useState<EdgeCustomer | null>(null);
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

  // ADR-0208: the card terminal on this till PC, the charges it approved for this payment
  // (by row), and what the edge still holds open for this till.
  const hasTerminalType = types.some(driven);
  const terminalStatus = useQuery({
    queryKey: ['kiosk', 'card-terminal', 'status'],
    queryFn: ({ signal }) => {
      if (!terminal) throw new TerminalUnavailable();
      return terminal.checkStatus(signal);
    },
    enabled: hasTerminalType,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const openAttempts = useQuery({
    queryKey: ['kiosk', 'card-attempts', 'open'],
    queryFn: ({ signal }) => client.openCardAttempts(signal),
    enabled: hasTerminalType,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const [charges, setCharges] = useState<Record<number, EdgeCardAttempt>>({});
  const [card, setCard] = useState<CardPhase>({ phase: 'idle' });
  // One payment at a time, also between two presses of the same render.
  const working = useRef(false);
  const waiting = card.phase === 'waiting';
  const busy = sale.isPending || waiting;
  const usedIds = new Set(Object.values(charges).map((attempt) => attempt.id));
  const unanswered = openAttempts.data?.find((attempt) => attempt.status === 'PENDING') ?? null;
  const unused = (openAttempts.data ?? []).filter(
    (attempt) => attempt.status === 'APPROVED' && !usedIds.has(attempt.id),
  );
  const canCharge = terminalStatus.isSuccess && !unanswered;

  const total = new Decimal(props.attempt.total);
  const nothingDue = total.isZero() && vouchers.length > 0;
  const amounts = rows.map((row) => moneyOrZero(row.amount));
  const valid = amounts.every((amount) => amount !== null);
  const sumOf = (pick: (row: PayRow) => boolean) =>
    rows.reduce(
      (sum, row, index) => (pick(row) ? sum.plus(amounts[index] ?? 0) : sum),
      new Decimal(0),
    );
  const cashGiven = sumOf((row) => row.type.kind === 'CASH');
  const nonCash = sumOf((row) => row.type.kind !== 'CASH');
  const creditRow = rows.find((row) => row.type.kind === 'CREDIT') ?? null;
  const creditAmount = sumOf((row) => row.type.kind === 'CREDIT');
  const paid = cashGiven.plus(nonCash);
  const remaining = Decimal.max(total.minus(paid), 0);
  // Only cash may be more than its share: the rest of the rows never pass the total.
  const nonCashOver = nonCash.gt(total);
  const cashDue = Decimal.max(total.minus(nonCash), 0);
  const change = !nonCashOver && cashGiven.gt(cashDue) ? cashGiven.minus(cashDue) : new Decimal(0);
  const covered = valid && !nonCashOver && paid.gte(total) && (total.gt(0) || nothingDue);
  const creditReady = creditRow === null || (customer !== null && creditAmount.gt(0));
  const pointsRow = rows.find((row) => row.type.kind === 'POINTS') ?? null;
  const pointsAmount = sumOf((row) => row.type.kind === 'POINTS');
  // Whole points, at most the card's balance, with the member's four-digit PIN.
  const pointsBad = pointsRow !== null && (!pointsAmount.isInteger() || pointsAmount.gt(balance));
  const pointsReady = pointsRow === null || (!pointsBad && /^[0-9]{4}$/.test(pin));
  const earnPercent = member?.tier ? new Decimal(member.tier.percent) : new Decimal(0);
  const earnBase = Decimal.min(
    Decimal.max(cashDue, 0).plus(
      sumOf((row) => row.type.kind === 'CARD' || row.type.kind === 'TRANSFER'),
    ),
    Decimal.max(total.minus(pointsAmount), 0),
  );
  const toEarn = earnBase.times(earnPercent).dividedBy(100).floor();
  const toCharge = rows.some(
    (row, index) => driven(row.type) && !charges[row.key] && Boolean(amounts[index]?.gt(0)),
  );
  const chargedTotal = sumOf((row) => Boolean(charges[row.key]));
  const ready =
    covered &&
    creditReady &&
    pointsReady &&
    (rows.length > 0 || nothingDue) &&
    (!toCharge || canCharge) &&
    card.phase !== 'unrecorded';

  const addRow = (type: PayType) => {
    if (type.kind === 'CREDIT' && creditRow) return;
    if (type.kind === 'POINTS' && pointsRow) return;
    if (driven(type) && !canCharge) return;
    // One row paying it all: another type takes its place (cash ↔ card in one tap) — never a
    // card row the terminal has already charged.
    const only = rows.length === 1 ? rows[0] : undefined;
    if (only && !charges[only.key] && amounts[0]?.gte(total)) {
      if (only.type.id === type.id && only.type.kind === type.kind) return;
      if (only.type.kind === 'CREDIT') setCustomer(null);
      if (only.type.kind === 'POINTS') setPin('');
      const amount = type.kind === 'POINTS' ? Decimal.min(total.floor(), balance) : total;
      setRows([{ key: nextKey, type, amount: amount.gt(0) ? fieldMoney(amount) : '' }]);
      setNextKey((key) => key + 1);
      setOverLimit(null);
      return;
    }
    const prefill = type.kind === 'POINTS' ? Decimal.min(remaining.floor(), balance) : remaining;
    setRows((current) => [
      ...current,
      {
        key: nextKey,
        type,
        amount: prefill.gt(0) ? fieldMoney(prefill) : '',
      },
    ]);
    setNextKey((key) => key + 1);
    setOverLimit(null);
  };
  const updateRow = (key: number, patch: Partial<PayRow>) => {
    if (charges[key]) return;
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const removeRow = (key: number) => {
    // A charged row taken off is not lost: the charge goes back to the list of charges no sale
    // used, to be put into the sale again or marked as given back on the terminal.
    if (charges[key]) {
      setCharges((current) =>
        Object.fromEntries(Object.entries(current).filter(([rowKey]) => rowKey !== String(key))),
      );
      void openAttempts.refetch();
    }
    const removed = rows.find((row) => row.key === key);
    if (removed?.type.kind === 'CREDIT') setCustomer(null);
    if (removed?.type.kind === 'POINTS') setPin('');
    setRows((current) => current.filter((row) => row.key !== key));
    setOverLimit(null);
  };

  const tenders = (charged: Record<number, EdgeCardAttempt>): EdgeTenderInput[] => {
    const list: EdgeTenderInput[] = [];
    // The cash rows are one tender: what the cash pays and what was handed over.
    const cashType = rows.find((row) => row.type.kind === 'CASH')?.type ?? null;
    if (cashType && cashDue.gt(0)) {
      list.push({
        kind: 'CASH',
        paymentTypeId: cashType.id,
        amount: wireMoney(cashDue),
        tendered: wireMoney(cashGiven),
      });
    }
    rows.forEach((row, index) => {
      const amount = amounts[index];
      if (row.type.kind === 'CASH' || !amount || !amount.gt(0)) return;
      list.push({
        kind: row.type.kind,
        paymentTypeId: row.type.id,
        amount: wireMoney(amount),
        ...(row.type.kind === 'CARD'
          ? {
              // Keyed on the bank's terminal by hand (owner 2026-11-04), or the terminal's own
              // approved charge (ADR-0208): the edge takes the terminal's id from it.
              terminalId: null,
              rrn: null,
              ...(charged[row.key] ? { cardAttemptId: charged[row.key]?.id ?? null } : {}),
            }
          : {}),
      });
    });
    return list;
  };

  /** What a charge came to: the approved attempt, or null with the reason on the screen. */
  const landed = (rowKey: number, result: ChargeResult): EdgeCardAttempt | null => {
    switch (result.kind) {
      case 'APPROVED':
        setCharges((current) => ({ ...current, [rowKey]: result.attempt }));
        return result.attempt;
      case 'REFUSED':
        setCard({ phase: 'refused', message: result.message });
        return null;
      case 'OFFLINE':
        setCard({ phase: 'offline' });
        void terminalStatus.refetch();
        return null;
      case 'BLOCKED':
        setCard({ phase: 'blocked', error: result.error });
        void openAttempts.refetch();
        return null;
      case 'UNKNOWN':
        // Sent and not answered: the edge holds it PENDING and the panel asks for the slip.
        setCard({ phase: 'idle' });
        void openAttempts.refetch();
        return null;
      case 'UNRECORDED':
        setCard({ phase: 'unrecorded', rowKey, held: result });
        return null;
    }
  };
  /**
   * Sends every card row with a terminal that is not charged yet to the terminal, one after
   * another; answers the charges of all rows, or null when one did not go through (the rows the
   * terminal approved stay charged and are never sent again).
   */
  const chargeRows = async (
    receipt: ReceiptType,
  ): Promise<Record<number, EdgeCardAttempt> | null> => {
    let done = charges;
    for (const [index, row] of rows.entries()) {
      const amount = amounts[index];
      if (!driven(row.type) || row.type.id === null || done[row.key] || !amount?.gt(0)) continue;
      if (!terminal) {
        setCard({ phase: 'offline' });
        return null;
      }
      setCard({ phase: 'waiting', name: row.type.name, amount: amount.toFixed(2) });
      props.onBusy(true);
      let result: ChargeResult;
      try {
        result = await chargeOnTerminal(
          { client, terminal },
          {
            saleClientId: props.attempt.clientId,
            paymentTypeId: row.type.id,
            amount: wireMoney(amount),
            // TODO-VERIFY (ADR-0208): «1» a citizen's, «3» a company's, as Erxes sends its
            // billType; Databank has not confirmed the values.
            billType: receipt === 'B2B' ? '3' : '1',
          },
        );
      } finally {
        props.onBusy(false);
      }
      const attempt = landed(row.key, result);
      if (!attempt) return null;
      done = { ...done, [row.key]: attempt };
    }
    setCard({ phase: 'idle' });
    return done;
  };
  const pay = async (type: ReceiptType, acceptOverLimit = false) => {
    if (!ready || busy || working.current) return;
    working.current = true;
    let charged: Record<number, EdgeCardAttempt> | null;
    try {
      setOverLimit(null);
      charged = await chargeRows(creditRow ? 'B2C' : type);
    } finally {
      working.current = false;
    }
    if (!charged) return;
    sale.mutate({
      clientId: props.attempt.clientId,
      lines: [...props.attempt.lines],
      tenders: tenders(charged),
      receiptType: creditRow ? 'B2C' : type,
      buyer: !creditRow && type === 'B2B' && buyer ? { tin: buyer.tin } : null,
      customerId: creditRow ? (customer?.id ?? null) : null,
      ...(acceptOverLimit ? { acceptOverLimit: true } : {}),
      ...(member ? { member: { id: member.id, pin: pointsRow ? pin : null } } : {}),
      ...(props.attempt.codes?.length
        ? {
            codes: [...props.attempt.codes],
            voucherApproval: props.attempt.voucherApproval ?? null,
          }
        : {}),
    });
  };
  // «Баримт хэвлэх»: with credit the slip prints at once; otherwise the receipt is chosen first.
  const printReceipt = () => {
    if (!ready || busy) return;
    if (creditRow) void pay('B2C');
    else setStep('receipt');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'rows') printReceipt();
    else if (receiptType === 'B2C' || buyer) void pay(receiptType);
  };

  // ADR-0208: an approved charge no sale used pays this one as a row that cannot be changed. A
  // lone row not charged yet (the cash the dialog opened with) gives way to it.
  const adopt = (attempt: EdgeCardAttempt) => {
    const type =
      types.find((entry) => entry.id !== null && entry.id === attempt.paymentTypeId) ??
      types.find(driven);
    if (!type || usedIds.has(attempt.id)) return;
    const key = nextKey;
    const amount = new Decimal(attempt.amount);
    setRows((current) => {
      const only = current.length === 1 ? current[0] : undefined;
      const kept =
        only && !charges[only.key]
          ? []
          : current.filter(
              (row) =>
                charges[row.key] || !driven(row.type) || !moneyOrZero(row.amount)?.eq(amount),
            );
      return [...kept, { key, type, amount: fieldMoney(amount) }];
    });
    setNextKey((next) => next + 1);
    setCharges((current) => ({ ...current, [key]: attempt }));
    setCard({ phase: 'idle' });
  };
  // The cashier read the terminal's slip of a charge that was never answered.
  const resolve = useMutation({
    mutationFn: (input: { attempt: EdgeCardAttempt; outcome: 'APPROVED' | 'FAILED' }) =>
      client.finishCardAttempt(input.attempt.id, {
        outcome: input.outcome,
        source: 'CASHIER',
        response: null,
        message: null,
      }),
    onSuccess: (kept) => {
      if (
        kept.kind === 'SALE' &&
        kept.status === 'APPROVED' &&
        kept.saleClientId === props.attempt.clientId
      ) {
        adopt(kept);
      }
      void openAttempts.refetch();
    },
  });
  const release = useMutation({
    mutationFn: (attempt: EdgeCardAttempt) => client.voidCardAttempt(attempt.id),
    onSuccess: () => void openAttempts.refetch(),
  });
  // The terminal answered but the edge was not told: tell it again, never the terminal.
  const record = useMutation({
    mutationFn: (phase: Extract<CardPhase, { phase: 'unrecorded' }>) =>
      recordOutcome(client, phase.held.attempt, phase.held.outcome),
    onSuccess: (result, phase) => {
      if (landed(phase.rowKey, result)) setCard({ phase: 'idle' });
    },
  });
  // 1–9 add the type in that place while no field has the focus.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    // Enter on the form itself (no field, no button) goes on, as in a field.
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      if (step === 'rows') printReceipt();
      else if (receiptType === 'B2C' || buyer) void pay(receiptType);
      return;
    }
    if (busy || step !== 'rows' || event.target instanceof HTMLInputElement) return;
    const place = /^[1-9]$/.test(event.key) ? Number.parseInt(event.key, 10) - 1 : -1;
    const type = types[place];
    if (type) {
      event.preventDefault();
      addRow(type);
    }
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

  return (
    <form
      data-pay-form
      tabIndex={-1}
      // One column no wider than the dialog: a long customer or voucher name is cut with «…»
      // in its own row and never widens the whole payment past the dialog's edge.
      className="grid min-w-0 grid-cols-1 gap-4 outline-none"
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
    >
      {vouchers.length > 0 ? (
        <ul aria-label={t('posKiosk.vouchers.taken')} className="space-y-1 text-[0.9375rem]">
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
      {member ? (
        <p className="flex items-center gap-2 rounded-xl bg-info-soft px-4 py-2 text-[0.9375rem]">
          <Gift aria-hidden className="size-5 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            {t('posKiosk.loyalty.payLine', {
              name: member.name,
              balance: formatMnt(member.balance),
            })}
          </span>
          {toEarn.gt(0) ? (
            <span className="font-semibold text-primary">
              {t('posKiosk.loyalty.toEarn', { points: formatMnt(toEarn.toFixed(2)) })}
            </span>
          ) : null}
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2">
        <Figure
          label={vouchers.length > 0 ? t('posKiosk.vouchers.due') : t('posKiosk.pay.total')}
          value={formatTugrik(props.attempt.total)}
          strong
        />
        <Figure label={t('posKiosk.pay.rows.paid')} value={formatTugrik(paid.toFixed(2))} />
        <Figure
          label={change.gt(0) ? t('posKiosk.pay.change') : t('posKiosk.pay.rows.remaining')}
          value={formatTugrik((change.gt(0) ? change : remaining).toFixed(2))}
          tone={change.gt(0) ? 'success' : remaining.gt(0) ? 'warning' : 'success'}
          emphasis={change.gt(0)}
        />
      </dl>

      {card.phase === 'waiting' ? (
        <CardWaiting name={card.name} amount={card.amount} />
      ) : step === 'rows' && nothingDue ? (
        <p className="rounded-xl bg-success-soft px-4 py-3 text-[0.9375rem] text-success">
          {t('posKiosk.vouchers.allPaid')}
        </p>
      ) : step === 'rows' ? (
        <>
          {rows.length === 0 ? (
            <p className="rounded-xl bg-canvas px-4 py-3 text-[0.9375rem] text-muted-foreground">
              {t('posKiosk.pay.rows.empty')}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={t('posKiosk.pay.rows.add')}>
              {rows.map((row, index) => (
                <li key={row.key} className="space-y-2 rounded-xl bg-canvas p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[0.9375rem] font-semibold">
                      {KIND_ICONS[row.type.kind]}
                      <span className="truncate">{row.type.name}</span>
                    </span>
                    <Input
                      autoFocus={index === rows.length - 1 && row.key > 1}
                      aria-label={t('posKiosk.pay.rows.amount', { name: row.type.name })}
                      inputMode="decimal"
                      autoComplete="off"
                      className="h-12 w-48 text-right font-mono text-xl md:text-xl"
                      value={row.amount}
                      aria-invalid={amounts[index] === null}
                      disabled={Boolean(charges[row.key])}
                      onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                      onKeyDown={(event) => {
                        const set = (value: string) => updateRow(row.key, { amount: value });
                        guard(event, row.amount, set);
                        if (!event.defaultPrevented) typeDigits(event, row.amount, set);
                      }}
                    />
                    {charges[row.key] ? (
                      <span className="rounded-lg bg-success-soft px-2 py-1 text-[0.8125rem] font-semibold text-success">
                        {t('posKiosk.pay.card.charged')}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t('posKiosk.pay.rows.remove', { name: row.type.name })}
                      onClick={() => removeRow(row.key)}
                    >
                      <X />
                    </Button>
                  </div>
                  {row.type.kind === 'CASH' ? (
                    <div
                      role="group"
                      aria-label={t('posKiosk.pay.quick')}
                      className="flex flex-wrap gap-2"
                    >
                      {quickCash(cashDue).map((amount) => (
                        <Button
                          key={amount.toFixed(2)}
                          type="button"
                          variant="outline"
                          onMouseDown={keepFocus}
                          className="h-11 px-3 font-mono text-[0.9375rem]"
                          onClick={() => updateRow(row.key, { amount: fieldMoney(amount) })}
                        >
                          {formatTugrik(amount.toFixed(2))}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {row.type.kind === 'CREDIT' ? (
                    <CustomerSection customer={customer} onChange={setCustomer} />
                  ) : null}
                  {row.type.kind === 'POINTS' ? (
                    <div className="flex items-center gap-3">
                      <Input
                        aria-label={t('posKiosk.loyalty.pin')}
                        placeholder={t('posKiosk.loyalty.pin')}
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        className="h-11 w-40 text-center font-mono text-lg tracking-[0.5em] placeholder:font-sans placeholder:tracking-normal md:text-lg"
                        value={pin}
                        onChange={(event) =>
                          setPin(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                        }
                      />
                      <span className="text-[0.8125rem] text-muted-foreground">
                        {pointsBad
                          ? t('posKiosk.loyalty.pointsBad', {
                              balance: formatMnt(balance.toFixed(2)),
                            })
                          : t('posKiosk.loyalty.pinHint')}
                      </span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {types.length === 0 ? (
            <KioskAlert>{t('posKiosk.pay.rows.noTypes')}</KioskAlert>
          ) : (
            <div role="group" aria-label={t('posKiosk.pay.rows.add')} className="space-y-1.5">
              <p className="text-[0.8125rem] font-medium text-muted-foreground">
                {t('posKiosk.pay.rows.add')}
              </p>
              {/* Three to a row in the dialog's 632px: a name has 128px and may take two lines
                  («Khaanbank terminal»); four to a row left it 74px, eight letters. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {types.map((type, index) => (
                  <Button
                    key={type.id ?? type.kind}
                    type="button"
                    variant={
                      rows.some((row) => row.type.id === type.id && row.type.kind === type.kind)
                        ? 'secondary'
                        : 'outline'
                    }
                    onMouseDown={keepFocus}
                    className="h-12 justify-start gap-2 text-[0.9375rem] font-semibold"
                    disabled={
                      (type.kind === 'CREDIT' && creditRow !== null) ||
                      (type.kind === 'POINTS' && pointsRow !== null) ||
                      (driven(type) && !canCharge)
                    }
                    title={
                      type.kind === 'CREDIT' && creditRow
                        ? t('posKiosk.pay.rows.creditOnce')
                        : driven(type) && !canCharge
                          ? t(
                              unanswered
                                ? 'posKiosk.pay.card.pendingBlocks'
                                : 'posKiosk.pay.card.offlineShort',
                            )
                          : undefined
                    }
                    onClick={() => addRow(type)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(index + 1)}
                    </span>
                    {KIND_ICONS[type.kind]}
                    <span className="line-clamp-2 text-left leading-tight break-words whitespace-normal">
                      {type.name}
                    </span>
                  </Button>
                ))}
              </div>
              {hasTerminalType ? (
                <TerminalStatusLine
                  checking={terminalStatus.isFetching}
                  info={terminalStatus.isSuccess ? terminalStatus.data : null}
                  onRecheck={() => void terminalStatus.refetch()}
                />
              ) : null}
            </div>
          )}
          {nonCashOver ? <KioskAlert>{t('posKiosk.pay.rows.over')}</KioskAlert> : null}
        </>
      ) : (
        <section aria-labelledby="pay-receipt-title" className="space-y-3">
          <h3 id="pay-receipt-title" className="text-[0.9375rem] font-semibold">
            {t('posKiosk.pay.receiptChoice.title')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              autoFocus
              variant={receiptType === 'B2C' ? 'default' : 'outline'}
              className="h-14 gap-2 text-base"
              pending={sale.isPending && receiptType === 'B2C'}
              disabled={busy}
              onClick={() => {
                setReceiptType('B2C');
                setBuyer(null);
                void pay('B2C');
              }}
            >
              <UserRound aria-hidden className="size-5" />
              {t('posKiosk.pay.receiptChoice.B2C')}
            </Button>
            <Button
              type="button"
              variant={receiptType === 'B2B' ? 'default' : 'outline'}
              className="h-14 gap-2 text-base"
              disabled={busy}
              onClick={() => setReceiptType('B2B')}
            >
              <Building2 aria-hidden className="size-5" />
              {t('posKiosk.pay.receiptChoice.B2B')}
            </Button>
          </div>
          {receiptType === 'B2B' ? <BuyerSection buyer={buyer} onChange={setBuyer} /> : null}
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => {
              setStep('rows');
              setReceiptType('B2C');
              setBuyer(null);
            }}
          >
            <ArrowLeft />
            {t('posKiosk.pay.receiptChoice.back')}
          </Button>
        </section>
      )}

      {waiting ? null : (
        <>
          {unanswered ? (
            <UnansweredPanel
              attempt={unanswered}
              busy={resolve.isPending}
              onResolve={(outcome) => resolve.mutate({ attempt: unanswered, outcome })}
            />
          ) : null}
          <UnusedPanel
            attempts={unused}
            busy={release.isPending || busy}
            onUse={adopt}
            onVoid={(attempt) => release.mutate(attempt)}
          />
          {card.phase === 'refused' ? (
            <KioskAlert>
              {card.message
                ? t('posKiosk.pay.card.refused', { message: card.message })
                : t('posKiosk.pay.card.refusedPlain')}
            </KioskAlert>
          ) : card.phase === 'offline' ? (
            <KioskAlert>{t('posKiosk.pay.card.offline')}</KioskAlert>
          ) : card.phase === 'blocked' ? (
            <KioskAlert>{problemText(card.error)}</KioskAlert>
          ) : card.phase === 'unrecorded' ? (
            <div role="alert" className="space-y-2 rounded-xl bg-warning-soft p-3 text-warning">
              <p className="text-sm font-medium">{t('posKiosk.pay.card.unrecorded.text')}</p>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={record.isPending}
                onClick={() => record.mutate(card)}
              >
                {t('posKiosk.pay.card.unrecorded.retry')}
              </Button>
            </div>
          ) : null}
          {resolve.isError ? <KioskAlert>{problemText(resolve.error)}</KioskAlert> : null}
          {release.isError ? <KioskAlert>{problemText(release.error)}</KioskAlert> : null}
          {chargedTotal.gt(0) ? (
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
              {t('posKiosk.pay.card.chargedNote', {
                amount: formatTugrik(chargedTotal.toFixed(2)),
              })}
            </p>
          ) : null}
        </>
      )}

      {creditRow && step === 'rows' ? (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-[0.9375rem] text-warning">
          {t('posKiosk.pay.receiptChoice.noVat')}
        </p>
      ) : null}

      {overLimit !== null ? (
        <div role="alert" className="space-y-2 rounded-xl bg-warning-soft p-3 text-warning">
          <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <TriangleAlert aria-hidden className="size-5" />
            {t('posKiosk.pay.credit.overLimitTitle')}
          </p>
          <p className="text-sm">{t('posKiosk.pay.credit.overLimitText', { excess: overLimit })}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void pay('B2C', true)}
          >
            {t('posKiosk.pay.credit.overLimitConfirm')}
          </Button>
        </div>
      ) : sale.isError ? (
        <KioskAlert>{saleProblem(sale.error)}</KioskAlert>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={waiting}
          onClick={props.onCancel}
        >
          {t('common.cancel')}
        </Button>
        {step === 'rows' ? (
          <Button
            type="submit"
            className="h-11 px-6 text-base"
            pending={sale.isPending}
            disabled={!ready || waiting}
          >
            {sale.isPending ? t('posKiosk.pay.pending') : t('posKiosk.pay.print')}
          </Button>
        ) : receiptType === 'B2B' ? (
          <Button
            type="submit"
            className="h-11 px-6 text-base"
            pending={sale.isPending}
            disabled={!buyer || waiting}
          >
            {sale.isPending ? t('posKiosk.pay.pending') : t('posKiosk.pay.print')}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}

/** One figure of the payment's head: what is due, what the rows pay, what is left or the change. */
function Figure(props: {
  label: string;
  value: string;
  strong?: boolean;
  /** The change due: the largest figure, read at arm's length (ADR-0113). */
  emphasis?: boolean;
  tone?: 'success' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2',
        props.tone === 'success'
          ? 'bg-success-soft text-success'
          : props.tone === 'warning'
            ? 'bg-warning-soft text-warning'
            : 'bg-canvas',
      )}
    >
      <dt className="text-[0.8125rem] font-medium">{props.label}</dt>
      <dd
        className={cn(
          'font-mono font-semibold tracking-tight',
          props.emphasis ? 'text-3xl' : props.strong ? 'text-2xl' : 'text-xl',
        )}
      >
        {props.value}
      </dd>
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
  // The list shows at once and narrows as the cashier types (owner 2026-11-04).
  const query = useDebounced(q.trim(), 200);
  const found = useQuery({
    queryKey: ['kiosk', 'customers', query],
    queryFn: ({ signal }) => client.customers(query, signal),
    placeholderData: keepPreviousData,
  });
  const available = (customer: EdgeCustomer) =>
    customer.available === null
      ? t('posKiosk.pay.credit.unlimited')
      : t('posKiosk.pay.credit.available', { amount: formatTugrik(customer.available) });
  return (
    <section aria-labelledby="pay-customer-title" className="space-y-2 rounded-xl bg-canvas p-3">
      <h3
        id="pay-customer-title"
        className="flex items-center gap-2 text-[0.9375rem] font-semibold"
      >
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
            className="h-11"
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
              className="h-11 flex-1 text-base md:text-base"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Enter takes the only customer found here; it never pays.
                event.preventDefault();
                const only = found.data?.length === 1 ? found.data[0] : undefined;
                if (only && !only.creditHold && query === q.trim()) props.onChange(only);
              }}
            />
          </div>
          {found.data && found.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('posKiosk.pay.credit.none')}</p>
          ) : null}
          {found.data && found.data.length > 0 ? (
            <ul
              aria-label={t('posKiosk.pay.credit.title')}
              className="max-h-64 space-y-1 overflow-y-auto"
            >
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
      <h3 id="pay-buyer-title" className="flex items-center gap-2 text-[0.9375rem] font-semibold">
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
            className="h-11"
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
              className="h-11 flex-1 font-mono text-base md:text-base"
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
