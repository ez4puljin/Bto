import type { EdgeReceipt, ReceiptLayout } from '@tugeel/shared/pos';
import { useCachedSession } from './queries';

/** The printed width of each paper (the printer's margins taken off; ADR-0141). */
export const RECEIPT_PRINT_WIDTH = { MM80: '72mm', MM58: '48mm' } as const;

/** The layout this POS prints a receipt of this kind with (ADR-0141); null: the built-in one. */
export function useReceiptLayout(kind: EdgeReceipt['kind'] | undefined): ReceiptLayout | null {
  const session = useCachedSession();
  return kind ? (session.data?.receiptLayouts?.[kind] ?? null) : null;
}

/** ADR-0142: this POS's id, for the receipt's barcode; null on an older edge. */
export function useReceiptTillId(): number | null {
  const session = useCachedSession();
  return session.data?.till.id ?? null;
}
