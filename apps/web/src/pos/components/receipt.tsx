import { Decimal } from '@tugeel/shared/money';
import type { EdgePrintableReceipt } from '@tugeel/shared/pos';
import { CircleCheck, Printer } from 'lucide-react';
import { type ComponentProps, type Ref, useRef } from 'react';
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
import { formatTugrik } from '@/lib/money';
import { useProblemText } from '../messages';
import { useReceiptLayout, useReceiptTillId } from '../receipt-layout';
import { KioskAlert } from './layout';
import { useReprint } from './print-context';
import { ReceiptView } from './receipt-view';

/** The receipt as this POS prints it: its template for the receipt's kind. */
export function KioskReceiptView(
  props: Omit<ComponentProps<typeof ReceiptView>, 'layout' | 'tillId'>,
) {
  const layout = useReceiptLayout(props.receipt.kind);
  const tillId = useReceiptTillId();
  return <ReceiptView {...props} layout={layout} tillId={tillId} />;
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
          <KioskReceiptView
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
