import { ExternalLink } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { InvoicePanel } from '@/features/finance/invoice-panel';
import { JournalEntryPanel } from '@/features/finance/journal-page';
import { PaymentPanel } from '@/features/finance/payments-page';
import { AdjustmentPage } from '@/features/inventory/adjustments-pages';
import { IssuePage } from '@/features/inventory/issues-pages';
import { ReceiptPage } from '@/features/inventory/receipts-pages';
import { StocktakePage } from '@/features/inventory/stocktakes-pages';
import { TransferPage } from '@/features/inventory/transfers-pages';
import { SalePanel } from '@/features/pos/sale-panel';
import { ShiftPanel } from '@/features/pos/shift-panel';
import { OrderPanel } from '@/features/sales/order-panel';
import type { PanelTab } from '@/features/sales/order-panel-tabs';
import type { RecordPeek } from './book-links';

export type { RecordPeek };

/**
 * The record a report's line opened, over the report (2026-11-16, the owner): the side panel its
 * own list uses (a voucher, an entry, an invoice, a till's shift or sale, an order) or, for a stock
 * document that has only a page, that page in a wide panel. The report stays as it was — its open
 * rows, its scroll — and closing the panel returns to it.
 */
export function RecordPeekPanel(props: { peek: RecordPeek | null; onClose: () => void }) {
  const [tab, setTab] = useState<PanelTab>('overview');
  const idOf = (kind: RecordPeek['kind']) => (props.peek?.kind === kind ? props.peek.id : null);
  const page = props.peek ? pageOf(props.peek) : null;
  return (
    <>
      <PaymentPanel paymentId={idOf('payment')} onClose={props.onClose} />
      <JournalEntryPanel entryId={idOf('entry')} onClose={props.onClose} />
      <InvoicePanel invoiceId={idOf('invoice')} onClose={props.onClose} />
      <ShiftPanel shiftId={idOf('shift')} onClose={props.onClose} />
      <SalePanel saleId={idOf('sale')} onClose={props.onClose} />
      <OrderPanel
        orderId={idOf('order')}
        tab={tab}
        onTab={setTab}
        onClose={() => {
          setTab('overview');
          props.onClose();
        }}
      />
      <PageSheet href={page?.href ?? null} onClose={props.onClose}>
        {page?.element}
      </PageSheet>
    </>
  );
}

/** A stock document's own page, rendered with the id given rather than read from the address. */
function pageOf(peek: RecordPeek): { href: string; element: ReactNode } | null {
  switch (peek.kind) {
    case 'receipt':
      return { href: `/inventory/receipts/${peek.id}`, element: <ReceiptPage id={peek.id} /> };
    case 'issue':
      return { href: `/inventory/issues/${peek.id}`, element: <IssuePage id={peek.id} /> };
    case 'transfer':
      return { href: `/inventory/transfers/${peek.id}`, element: <TransferPage id={peek.id} /> };
    case 'adjustment':
      return {
        href: `/inventory/adjustments/${peek.id}`,
        element: <AdjustmentPage id={peek.id} />,
      };
    case 'stocktake':
      return { href: `/inventory/stocktakes/${peek.id}`, element: <StocktakePage id={peek.id} /> };
    default:
      return null;
  }
}

function PageSheet(props: { href: string | null; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Sheet open={props.href !== null} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <SheetContent
        side="right"
        closeLabel={t('common.close')}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(80rem,94vw)]"
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border px-5 py-2 pr-14">
          <SheetTitle className="text-base">{t('reports.prompt.peekTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{props.href ?? ''}</SheetDescription>
          {props.href ? (
            <Button asChild variant="outline" size="sm">
              <Link to={props.href}>
                <ExternalLink />
                {t('reports.prompt.peekOpenPage')}
              </Link>
            </Button>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
          {props.children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A document's number that opens its record over the page, styled as the link it replaces. */
export function PeekLink(props: {
  peek: RecordPeek;
  onOpen: (peek: RecordPeek) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cursor-pointer text-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen(props.peek);
      }}
    >
      {props.children}
    </button>
  );
}
