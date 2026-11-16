import { InvoicePanel } from '@/features/finance/invoice-panel';
import { JournalEntryPanel } from '@/features/finance/journal-page';
import { PaymentPanel } from '@/features/finance/payments-page';
import { ShiftPanel } from '@/features/pos/shift-panel';
import type { RecordPeek } from './book-links';

/**
 * The record a report's line opened, in the side panel its own page uses, over the report: the
 * report stays as it was (its open rows, its scroll) and closing the panel returns to it.
 */
export function RecordPeekPanel(props: { peek: RecordPeek | null; onClose: () => void }) {
  const idOf = (kind: RecordPeek['kind']) => (props.peek?.kind === kind ? props.peek.id : null);
  return (
    <>
      <PaymentPanel paymentId={idOf('payment')} onClose={props.onClose} />
      <JournalEntryPanel entryId={idOf('entry')} onClose={props.onClose} />
      <InvoicePanel invoiceId={idOf('invoice')} onClose={props.onClose} />
      <ShiftPanel shiftId={idOf('shift')} onClose={props.onClose} />
    </>
  );
}
