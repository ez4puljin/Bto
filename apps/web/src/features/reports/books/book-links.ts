import type { LedgerLine, ProductSalesDocument } from './book-api';

/** The page of a stock document by the ledger's document code (ADR-0133's drill-down). */
export function stockDocHref(
  docType: string,
  docId: number,
  invoiceId?: number | null,
): string | null {
  switch (docType) {
    case 'GR':
      return `/inventory/receipts/${docId}`;
    case 'GI':
      return `/inventory/issues/${docId}`;
    case 'TR':
      return `/inventory/transfers/${docId}`;
    case 'ADJ':
      return `/inventory/adjustments/${docId}`;
    case 'ST':
      return `/inventory/stocktakes/${docId}`;
    case 'SO':
      return `/sales/orders/${docId}`;
    case 'POS':
      return `/pos/sales?sale=${docId}`;
    case 'CN':
      // A credit note has no page of its own: its invoice's panel lists it.
      return invoiceId ? `/finance/invoices?invoice=${invoiceId}` : null;
    default:
      return null;
  }
}

const idOf = (value: string | null): number | null => {
  const match = /^(\d+)(?::\d+)?$/.exec(value ?? '');
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
};

/**
 * Where a journal line came from: the invoice, the voucher, the receipt, the issue, the till's
 * shift or the stock document behind its entry; the journal entry itself otherwise (a manual
 * entry, a reversal, a credit note, the opening).
 */
export function ledgerLineHref(line: LedgerLine): string {
  const journal = `/finance/journal?entry=${line.entryId}`;
  if (line.system === 'FIN') {
    if ((line.sourceDocType === 'RECEIPT' || line.sourceDocType === 'PAYMENT') && line.documentId) {
      return `/finance/payments?payment=${line.documentId}`;
    }
    return journal;
  }
  const id = idOf(line.sourceDocId);
  switch (line.sourceDocType) {
    case 'SALES_INVOICE':
      return id ? `/finance/invoices?invoice=${id}` : journal;
    case 'GOODS_RECEIPT':
    case 'RECEIPT_RECOST':
    case 'STOCK_REVALUE':
      return id ? `/inventory/receipts/${id}` : journal;
    case 'SUPPLIER_RETURN':
    case 'DAMAGE_CHARGE':
      return id ? `/inventory/issues/${id}` : journal;
    case 'POS_SHIFT':
      return id ? `/pos/shifts?shift=${id}` : journal;
    case 'STOCK': {
      const match = /^([A-Z]+):(\d+):/.exec(line.sourceDocId ?? '');
      const href =
        match?.[1] && match[2] ? stockDocHref(match[1], Number.parseInt(match[2], 10)) : null;
      return href ?? journal;
    }
    default:
      return journal;
  }
}

/** The page of a sales document of «Борлуулалт /Бараагаар/». */
export function salesDocHref(doc: ProductSalesDocument): string | null {
  switch (doc.kind) {
    case 'INVOICE':
      return `/finance/invoices?invoice=${doc.id}`;
    case 'CREDIT_NOTE':
      return doc.invoiceId ? `/finance/invoices?invoice=${doc.invoiceId}` : null;
    case 'POS_SALE':
    case 'POS_RETURN':
      return `/pos/sales?sale=${doc.id}`;
    default:
      return null;
  }
}
