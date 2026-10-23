import { Decimal } from '@tugeel/shared/money';
import type { EdgeReceipt } from '@tugeel/shared/pos';
import { CircleCheck } from 'lucide-react';
import { type Ref, useRef } from 'react';
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

/**
 * The receipt on screen (no printer yet, S3): the company, a banner while the e-Barimt provider is
 * the fake one, the number and time, the lines, the totals with VAT, the tenders and the change.
 */
export function ReceiptView({ receipt }: { receipt: EdgeReceipt }) {
  const { t } = useTranslation();
  const discount = new Decimal(receipt.discountTotal).gt(0);
  const refund = receipt.kind === 'RETURN';
  return (
    <article
      aria-label={t('posKiosk.receipt.label', { number: receipt.number })}
      className="mx-auto w-full max-w-sm rounded-xl border border-dashed border-input bg-background px-5 py-4 font-mono text-[13px] leading-relaxed"
    >
      <header className="space-y-1 border-b border-dashed border-input pb-3 text-center">
        <p className="font-sans text-[15px] font-semibold">
          {receipt.companyName ?? t('brand.company')}
        </p>
        {receipt.ebarimt.mode === 'TEST' ? (
          <p className="rounded-md bg-warning-soft px-2 py-1 font-sans text-xs font-semibold text-warning">
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
        <dt className="font-sans text-[15px] font-semibold">{t('pos.fields.total')}</dt>
        <dd className="text-right text-[15px] font-semibold">{formatTugrik(receipt.total)}</dd>
        <dt className="text-muted-foreground">{t('posKiosk.receipt.vatIncluded')}</dt>
        <dd className="text-right text-muted-foreground">{formatMnt(receipt.vatTotal)}</dd>
      </dl>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 pt-3">
        {refund ? (
          <>
            <dt className="font-sans font-semibold">{t('posKiosk.receipt.refund')}</dt>
            <dd className="text-right font-semibold">{formatTugrik(receipt.total)}</dd>
          </>
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
      <p className="pt-3 text-center font-sans text-xs text-muted-foreground">
        {t('posKiosk.receipt.thanks')}
      </p>
    </article>
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

/** The receipt of the sale just paid; Enter, or the next scan, starts the next sale. */
export function ReceiptDialog(props: {
  open: boolean;
  /** Kept while the dialog fades out, so its content does not collapse. */
  receipt: EdgeReceipt | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  /** The dialog's content, where a scan starts the next sale. */
  contentRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const next = useRef<HTMLButtonElement>(null);
  const { receipt } = props;
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
        {receipt ? <ReceiptView receipt={receipt} /> : null}
        <DialogFooter>
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
