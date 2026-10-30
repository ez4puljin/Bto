import { Decimal } from '@tugeel/shared/money';
import type { EdgePrintableReceipt, EdgePrintSecrets, EdgeReceipt } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { CircleCheck, Printer } from 'lucide-react';
import { Fragment, type Ref, useRef } from 'react';
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
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty, formatTugrik } from '@/lib/money';
import { useProblemText } from '../messages';
import { KioskAlert } from './layout';
import { QrCode } from './qr-code';
import { useReprint } from './print-context';

/**
 * The receipt, on screen and on the 80 mm paper (ADR-0065): the store's heading, the seller and
 * its TIN, a banner for a test receipt, a copy, a receipt still waiting or to be checked, the
 * number and time, a company buyer, the ДДТД, the lines, the totals with VAT, the tenders and the
 * change, the lottery and the QR code while the edge still holds them, the closing line.
 * ADR-0109: a sale with credit prints as a credit slip — the customer, the part on credit, no VAT,
 * QR or lottery (no e-Barimt), a line for the customer's signature, in two copies.
 */
export function ReceiptView({
  receipt,
  print = null,
  copy = false,
  paper = false,
  label,
  copyLabel,
}: {
  receipt: EdgeReceipt;
  /** The lottery and the QR data: only in memory, only to draw this receipt. */
  print?: EdgePrintSecrets | null;
  copy?: boolean;
  /** The printed sheet: no frame, the printer's width. */
  paper?: boolean;
  label?: string;
  /** Which of a credit slip's two copies this is. */
  copyLabel?: string;
}) {
  const { t } = useTranslation();
  const discount = new Decimal(receipt.discountTotal).gt(0);
  const refund = receipt.kind === 'RETURN';
  const facts = receipt.ebarimt;
  const credit = receipt.credit ?? null;
  const real = facts.mode === 'REAL' && credit === null;
  const waiting = real && (facts.status === 'PENDING' || facts.status === undefined);
  return (
    <article
      aria-label={label ?? t('posKiosk.receipt.label', { number: receipt.number })}
      className={cn(
        'bg-background font-mono leading-relaxed text-foreground',
        paper
          ? 'w-full px-1 py-2 text-[0.6875rem]'
          : 'mx-auto w-full max-w-sm rounded-xl border border-dashed border-input px-5 py-4 text-[0.8125rem]',
      )}
    >
      <header className="space-y-1 border-b border-dashed border-input pb-3 text-center">
        {receipt.title ? (
          <p className="font-sans text-[0.9375rem] font-semibold">{receipt.title}</p>
        ) : null}
        <p
          className={cn('font-sans', receipt.title ? 'text-xs' : 'text-[0.9375rem] font-semibold')}
        >
          {facts.merchantName ?? receipt.companyName ?? t('brand.company')}
        </p>
        {real && facts.merchantTin ? (
          <p className="text-xs">{t('posKiosk.receipt.sellerTin', { tin: facts.merchantTin })}</p>
        ) : null}
        {copy ? (
          <p className="rounded-md border border-foreground px-2 py-1 font-sans text-sm font-semibold tracking-widest">
            {t('posKiosk.receipt.copy')}
          </p>
        ) : null}
        {credit ? (
          <p className="rounded-md border border-foreground px-2 py-1 font-sans text-sm font-semibold tracking-wide">
            {t('posKiosk.receipt.creditSlip')}
          </p>
        ) : null}
        {credit && copyLabel ? <p className="font-sans text-xs">{copyLabel}</p> : null}
        {facts.mode === 'TEST' && credit === null ? (
          <p className="rounded-md bg-warning-soft px-2 py-1 font-sans text-sm font-semibold tracking-wide text-warning">
            {t('posKiosk.receipt.test')}
          </p>
        ) : null}
        {refund ? (
          <p className="rounded-md bg-danger-soft px-2 py-1 font-sans text-sm font-semibold tracking-wide text-destructive">
            {t('posKiosk.receipt.returnBanner')}
          </p>
        ) : null}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 border-b border-dashed border-input py-3">
        <dt className="text-muted-foreground">{t('pos.fields.number')}</dt>
        <dd className="text-right font-semibold">{receipt.number}</dd>
        <dt className="text-muted-foreground">{t('pos.fields.soldAt')}</dt>
        <dd className="text-right">{formatUbDateTime(Date.parse(receipt.soldAt))}</dd>
        {refund && receipt.refundsNumber ? (
          <>
            <dt className="text-muted-foreground">{t('posKiosk.receipt.refunds')}</dt>
            <dd className="text-right">{receipt.refundsNumber}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t('pos.fields.till')}</dt>
        <dd className="text-right">{receipt.tillCode}</dd>
        <dt className="text-muted-foreground">{t('pos.fields.cashier')}</dt>
        <dd className="truncate text-right">{receipt.cashierName}</dd>
        {credit ? (
          <>
            <dt className="text-muted-foreground">{t('posKiosk.receipt.creditCustomer')}</dt>
            <dd className="text-right font-semibold">
              {credit.customerName}
              <span className="block font-normal">{credit.customerCode}</span>
            </dd>
          </>
        ) : null}
        {facts.receiptType === 'B2B' && facts.customerTin ? (
          <>
            <dt className="text-muted-foreground">{t('posKiosk.receipt.buyer')}</dt>
            <dd className="text-right">
              {facts.customerName}
              <span className="block">
                {t('posKiosk.receipt.buyerTin', { tin: facts.customerTin })}
              </span>
            </dd>
          </>
        ) : null}
        {receipt.ebarimt.ddtd ? (
          <>
            <dt className="text-muted-foreground">{t('pos.fields.ddtd')}</dt>
            <dd className="text-right break-all">{receipt.ebarimt.ddtd}</dd>
          </>
        ) : null}
      </dl>
      <ul className="space-y-1.5 border-b border-dashed border-input py-3">
        {receipt.lines.map((line, index) => (
          <li key={index}>
            <p className="font-sans font-medium">{line.name}</p>
            <p className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {t('posKiosk.receipt.lineQty', {
                  qty: formatQty(line.qty),
                  uom: line.uomName,
                  price: formatMnt(line.unitPrice),
                })}
              </span>
              <span>{formatMnt(line.total)}</span>
            </p>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-dashed border-input py-3">
        {discount ? (
          <>
            <dt>{t('pos.fields.subtotal')}</dt>
            <dd className="text-right">{formatMnt(receipt.subtotal)}</dd>
            <dt>{t('pos.fields.discount')}</dt>
            <dd className="text-right">{`−${formatMnt(receipt.discountTotal)}`}</dd>
          </>
        ) : null}
        {(receipt.vouchers ?? [])
          .filter((voucher) => voucher.kind === 'COUPON')
          .map((voucher) => (
            <Fragment key={voucher.code}>
              <dt className="text-muted-foreground">
                {`${t('posKiosk.vouchers.kinds.COUPON')}: ${voucher.name}`}
              </dt>
              <dd className="text-right text-muted-foreground">{`−${formatMnt(voucher.amount)}`}</dd>
            </Fragment>
          ))}
        <dt className="font-sans text-[0.9375rem] font-semibold">{t('pos.fields.total')}</dt>
        <dd className="text-right text-[0.9375rem] font-semibold">{formatTugrik(receipt.total)}</dd>
        {credit ? null : (
          <>
            <dt className="text-muted-foreground">{t('posKiosk.receipt.vatIncluded')}</dt>
            <dd className="text-right text-muted-foreground">{formatMnt(receipt.vatTotal)}</dd>
          </>
        )}
      </dl>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 pt-3">
        {refund ? (
          receipt.tenders.map((tender, index) => (
            <RefundRow key={index} kind={tender.kind} amount={tender.amount} />
          ))
        ) : (
          <>
            {receipt.tenders.map((tender, index) => (
              <TenderRow key={index} tender={tender} />
            ))}
            <dt className="font-sans font-semibold">{t('pos.fields.change')}</dt>
            <dd className="text-right font-semibold">{formatTugrik(receipt.change)}</dd>
          </>
        )}
      </dl>
      {receipt.loyalty ? <LoyaltyBlock loyalty={receipt.loyalty} /> : null}
      {real ? <EbarimtBlock receipt={receipt} print={print} waiting={waiting} /> : null}
      {credit ? (
        <p className="border-t border-dashed border-input pt-6 font-sans text-xs">
          {t('posKiosk.receipt.signature')}
          <span className="block text-muted-foreground">{t('posKiosk.receipt.signatureHint')}</span>
        </p>
      ) : null}
      <p className="pt-3 text-center font-sans text-xs text-muted-foreground">
        {receipt.footer ?? t('posKiosk.receipt.thanks')}
      </p>
    </article>
  );
}

/** The e-Barimt part: its state, the replaced receipt, the lottery and the QR code. */
function EbarimtBlock({
  receipt,
  print,
  waiting,
}: {
  receipt: EdgeReceipt;
  print: EdgePrintSecrets | null;
  waiting: boolean;
}) {
  const { t } = useTranslation();
  const facts = receipt.ebarimt;
  const notice = waiting
    ? t('posKiosk.receipt.ebarimtPending')
    : facts.status === 'INDETERMINATE'
      ? t('posKiosk.receipt.ebarimtCheck')
      : facts.status === 'ERROR'
        ? t('posKiosk.receipt.ebarimtError')
        : facts.status === 'CANCELLED' && receipt.kind === 'SALE'
          ? t('posKiosk.receipt.ebarimtCancelled')
          : null;
  return (
    <section
      aria-label={t('posKiosk.receipt.ebarimt')}
      className="space-y-2 border-t border-dashed border-input pt-3 text-center"
    >
      {notice ? (
        <p className="rounded-md bg-warning-soft px-2 py-1 font-sans text-xs font-semibold text-warning">
          {notice}
        </p>
      ) : null}
      {receipt.kind === 'RETURN' && facts.inactiveId ? (
        <p className="text-xs break-all">
          {t('posKiosk.receipt.replaced', { ddtd: facts.inactiveId })}
        </p>
      ) : null}
      {print?.lottery ? (
        <p className="font-sans text-sm font-semibold">
          {t('posKiosk.receipt.lottery', { lottery: print.lottery })}
        </p>
      ) : null}
      {print?.qrData ? <QrCode data={print.qrData} label={t('posKiosk.receipt.qr')} /> : null}
    </section>
  );
}

/**
 * The bonus card's part (ADR-0112): the member, the tier the sale earned at, the points earned,
 * spent, given back and taken back, and the balance after it as the till counts it.
 */
function LoyaltyBlock({ loyalty }: { loyalty: NonNullable<EdgeReceipt['loyalty']> }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('posKiosk.loyalty.receipt.earned'), `+${formatMnt(loyalty.earned)}`],
    [t('posKiosk.loyalty.receipt.spent'), `−${formatMnt(loyalty.spent)}`],
    [t('posKiosk.loyalty.receipt.givenBack'), `+${formatMnt(loyalty.givenBack)}`],
    [t('posKiosk.loyalty.receipt.clawback'), `−${formatMnt(loyalty.clawback)}`],
  ];
  return (
    <section
      aria-label={t('posKiosk.loyalty.title')}
      className="border-t border-dashed border-input pt-3"
    >
      <p className="font-sans font-semibold">
        {t('posKiosk.loyalty.receipt.member', { name: loyalty.memberName, phone: loyalty.phone })}
      </p>
      {loyalty.tierName ? (
        <p className="font-sans text-xs text-muted-foreground">
          {t('posKiosk.loyalty.tier', {
            name: loyalty.tierName,
            percent: formatMnt(loyalty.percent),
          })}
        </p>
      ) : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-3">
        {rows
          .filter(
            (_, index) =>
              !new Decimal(
                [loyalty.earned, loyalty.spent, loyalty.givenBack, loyalty.clawback][index] ?? 0,
              ).isZero(),
          )
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd className="text-right">{value}</dd>
            </Fragment>
          ))}
        <dt className="font-sans font-semibold">{t('posKiosk.loyalty.receipt.balance')}</dt>
        <dd className="text-right font-semibold">{formatMnt(loyalty.balance)}</dd>
      </dl>
    </section>
  );
}

/** What a return paid back: off the customer's debt (a credit sale's) or in cash. */
function RefundRow({ kind, amount }: { kind: string; amount: string }) {
  const { t } = useTranslation();
  return (
    <>
      <dt className="font-sans font-semibold">
        {kind === 'CREDIT'
          ? t('posKiosk.receipt.creditRefund')
          : kind === 'POINTS'
            ? t('posKiosk.receipt.pointsRefund')
            : t('posKiosk.receipt.refund')}
      </dt>
      <dd className="text-right font-semibold">{formatTugrik(amount)}</dd>
    </>
  );
}

function TenderRow({ tender }: { tender: EdgeReceipt['tenders'][number] }) {
  const { t } = useTranslation();
  return (
    <>
      <dt>{t(`pos.tenderKinds.${tender.kind}`)}</dt>
      <dd className="text-right">
        {formatMnt(tender.amount)}
        {tender.tendered !== null && !new Decimal(tender.tendered).eq(tender.amount) ? (
          <span className="block text-xs text-muted-foreground">
            {t('posKiosk.receipt.tendered', { amount: formatMnt(tender.tendered) })}
          </span>
        ) : null}
      </dd>
    </>
  );
}

/** The receipt of the sale just paid (printed already); Enter, or the next scan, starts the next sale. */
export function ReceiptDialog(props: {
  open: boolean;
  /** Kept while the dialog fades out, so its content does not collapse. */
  printable: EdgePrintableReceipt | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  /** The dialog's content, where a scan starts the next sale. */
  contentRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const next = useRef<HTMLButtonElement>(null);
  const reprint = useReprint();
  const receipt = props.printable?.receipt ?? null;
  const refund = receipt?.kind === 'RETURN';
  return (
    <Dialog
      open={props.open && receipt !== null}
      onOpenChange={(open) => (open ? undefined : props.onClose())}
    >
      <DialogContent
        ref={props.contentRef}
        size="md"
        onCloseAutoFocus={props.onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          next.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {refund ? t('posKiosk.receipt.returnTitle') : t('posKiosk.receipt.title')}
          </DialogTitle>
          <DialogDescription>
            {receipt && refund
              ? t('posKiosk.receipt.returnSummary', { total: formatTugrik(receipt.total) })
              : receipt
                ? t('posKiosk.receipt.summary', {
                    total: formatTugrik(receipt.total),
                    change: formatTugrik(receipt.change),
                  })
                : null}
          </DialogDescription>
        </DialogHeader>
        {receipt && !refund && new Decimal(receipt.change).gt(0) ? (
          // The change to hand back, large above the receipt (ADR-0113).
          <p className="flex items-baseline justify-between rounded-xl bg-success-soft px-4 py-3 text-success">
            <span className="text-[0.9375rem] font-medium">{t('posKiosk.pay.change')}</span>
            <span className="font-mono text-3xl font-semibold tracking-tight">
              {formatTugrik(receipt.change)}
            </span>
          </p>
        ) : null}
        {receipt && props.printable ? (
          <ReceiptView
            receipt={receipt}
            print={props.printable.print}
            copy={props.printable.copy}
          />
        ) : null}
        {reprint.isError ? <KioskAlert>{problemText(reprint.error)}</KioskAlert> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-12 px-5 text-base"
            disabled={!receipt || reprint.isPending}
            onClick={() => receipt && reprint.mutate(receipt.clientId)}
          >
            <Printer />
            {t('posKiosk.print.again')}
          </Button>
          <Button
            ref={next}
            className="h-12 w-full px-6 text-base sm:w-auto"
            onClick={props.onClose}
          >
            {t('posKiosk.receipt.newSale')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
