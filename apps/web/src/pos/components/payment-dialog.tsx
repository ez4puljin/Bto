import { useMutation, useQuery } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeApproval,
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
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
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
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { fieldMoney, moneyOrZero, quickCash, wireMoney } from '../amounts';
import { edgeProblemOf } from '../edge-client';
import { useKiosk } from '../kiosk-context';
import { keepFocus, typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { useSession } from '../queries';
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
}

/** One payment row the cashier added: its type, its amount, a card's slip facts. */
interface PayRow {
  key: number;
  type: PayType;
  amount: string;
  terminalId: string;
  rrn: string;
}

/**
 * «Төлбөр (F12)» (ADR-0111, owner 2026-10-27): the admin's payment types as buttons (1–9 add the
 * one in that place); each tap adds a row with what is left to pay, typed over as needed — cash may
 * exceed it (the change), the rest may not; a CREDIT row needs its customer (ADR-0109). When the
 * rows make the total, «Баримт хэвлэх» asks «Хувь хүн НӨАТ» or «Байгууллага НӨАТ» — a sale with
 * credit prints its slip without VAT at once.
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
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
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
  const [rows, setRows] = useState<PayRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
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
  const ready = covered && creditReady && pointsReady && (rows.length > 0 || nothingDue);

  const addRow = (type: PayType) => {
    if (type.kind === 'CREDIT' && creditRow) return;
    if (type.kind === 'POINTS' && pointsRow) return;
    const prefill = type.kind === 'POINTS' ? Decimal.min(remaining.floor(), balance) : remaining;
    setRows((current) => [
      ...current,
      {
        key: nextKey,
        type,
        amount: prefill.gt(0) ? fieldMoney(prefill) : '',
        terminalId: '',
        rrn: '',
      },
    ]);
    setNextKey((key) => key + 1);
    setOverLimit(null);
  };
  const updateRow = (key: number, patch: Partial<PayRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeRow = (key: number) => {
    const removed = rows.find((row) => row.key === key);
    if (removed?.type.kind === 'CREDIT') setCustomer(null);
    if (removed?.type.kind === 'POINTS') setPin('');
    setRows((current) => current.filter((row) => row.key !== key));
    setOverLimit(null);
  };

  const tenders = (): EdgeTenderInput[] => {
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
          ? { terminalId: row.terminalId.trim() || null, rrn: row.rrn.trim() || null }
          : {}),
      });
    });
    return list;
  };
  const pay = (type: ReceiptType, acceptOverLimit = false) => {
    if (!ready || sale.isPending) return;
    setOverLimit(null);
    sale.mutate({
      clientId: props.attempt.clientId,
      lines: [...props.attempt.lines],
      tenders: tenders(),
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
    if (!ready || sale.isPending) return;
    if (creditRow) pay('B2C');
    else setStep('receipt');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'rows') printReceipt();
    else if (receiptType === 'B2C' || buyer) pay(receiptType);
  };
  // 1–9 add the type in that place while no field has the focus.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (step !== 'rows' || event.target instanceof HTMLInputElement) return;
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
    <form className="grid gap-4" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
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
      {member ? (
        <p className="flex items-center gap-2 rounded-xl bg-info-soft px-4 py-2 text-[15px]">
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

      {step === 'rows' && nothingDue ? (
        <p className="rounded-xl bg-success-soft px-4 py-3 text-[15px] text-success">
          {t('posKiosk.vouchers.allPaid')}
        </p>
      ) : step === 'rows' ? (
        <>
          {rows.length === 0 ? (
            <p className="rounded-xl bg-canvas px-4 py-3 text-[15px] text-muted-foreground">
              {t('posKiosk.pay.rows.empty')}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={t('posKiosk.pay.rows.add')}>
              {rows.map((row, index) => (
                <li key={row.key} className="space-y-2 rounded-xl bg-canvas p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold">
                      {KIND_ICONS[row.type.kind]}
                      <span className="truncate">{row.type.name}</span>
                    </span>
                    <Input
                      autoFocus={index === rows.length - 1}
                      aria-label={t('posKiosk.pay.rows.amount', { name: row.type.name })}
                      inputMode="decimal"
                      autoComplete="off"
                      className="h-12 w-48 text-right font-mono text-xl md:text-xl"
                      value={row.amount}
                      aria-invalid={amounts[index] === null}
                      onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                      onKeyDown={(event) => {
                        const set = (value: string) => updateRow(row.key, { amount: value });
                        guard(event, row.amount, set);
                        if (!event.defaultPrevented) typeDigits(event, row.amount, set);
                      }}
                    />
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
                          className="h-11 px-3 font-mono text-[15px]"
                          onClick={() => updateRow(row.key, { amount: fieldMoney(amount) })}
                        >
                          {formatTugrik(amount.toFixed(2))}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {row.type.kind === 'CARD' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label={t('posKiosk.pay.terminalId')}
                        placeholder={t('posKiosk.pay.terminalId')}
                        autoComplete="off"
                        maxLength={32}
                        className="h-11"
                        value={row.terminalId}
                        onChange={(event) => updateRow(row.key, { terminalId: event.target.value })}
                      />
                      <Input
                        aria-label={t('posKiosk.pay.rrn')}
                        placeholder={t('posKiosk.pay.rrn')}
                        autoComplete="off"
                        maxLength={32}
                        className="h-11"
                        value={row.rrn}
                        onChange={(event) => updateRow(row.key, { rrn: event.target.value })}
                      />
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
                        className="h-11 w-40 text-center font-mono text-lg tracking-[0.5em]"
                        value={pin}
                        onChange={(event) =>
                          setPin(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                        }
                      />
                      <span className="text-[13px] text-muted-foreground">
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
              <p className="text-[13px] font-medium text-muted-foreground">
                {t('posKiosk.pay.rows.add')}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {types.map((type, index) => (
                  <Button
                    key={type.id ?? type.kind}
                    type="button"
                    variant="outline"
                    onMouseDown={keepFocus}
                    className="h-12 justify-start gap-2 text-[15px] font-semibold"
                    disabled={
                      (type.kind === 'CREDIT' && creditRow !== null) ||
                      (type.kind === 'POINTS' && pointsRow !== null)
                    }
                    title={
                      type.kind === 'CREDIT' && creditRow
                        ? t('posKiosk.pay.rows.creditOnce')
                        : undefined
                    }
                    onClick={() => addRow(type)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(index + 1)}
                    </span>
                    {KIND_ICONS[type.kind]}
                    <span className="truncate">{type.name}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {nonCashOver ? <KioskAlert>{t('posKiosk.pay.rows.over')}</KioskAlert> : null}
        </>
      ) : (
        <section aria-labelledby="pay-receipt-title" className="space-y-3">
          <h3 id="pay-receipt-title" className="text-[15px] font-semibold">
            {t('posKiosk.pay.receiptChoice.title')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              autoFocus
              variant={receiptType === 'B2C' ? 'default' : 'outline'}
              className="h-14 gap-2 text-base"
              pending={sale.isPending && receiptType === 'B2C'}
              disabled={sale.isPending}
              onClick={() => {
                setReceiptType('B2C');
                setBuyer(null);
                pay('B2C');
              }}
            >
              <UserRound aria-hidden className="size-5" />
              {t('posKiosk.pay.receiptChoice.B2C')}
            </Button>
            <Button
              type="button"
              variant={receiptType === 'B2B' ? 'default' : 'outline'}
              className="h-14 gap-2 text-base"
              disabled={sale.isPending}
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

      {creditRow && step === 'rows' ? (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-[15px] text-warning">
          {t('posKiosk.pay.receiptChoice.noVat')}
        </p>
      ) : null}

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
            onClick={() => pay('B2C', true)}
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
        {step === 'rows' ? (
          <Button
            type="submit"
            className="h-11 px-6 text-base"
            pending={sale.isPending}
            disabled={!ready}
          >
            {sale.isPending ? t('posKiosk.pay.pending') : t('posKiosk.pay.print')}
          </Button>
        ) : receiptType === 'B2B' ? (
          <Button
            type="submit"
            className="h-11 px-6 text-base"
            pending={sale.isPending}
            disabled={!buyer}
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
      <dt className="text-[13px] font-medium">{props.label}</dt>
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
