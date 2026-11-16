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

/** A record a report opens in a side panel over itself (no page change, 2026-11-16). */
export type RecordPeek = {
  kind:
    | 'payment'
    | 'entry'
    | 'invoice'
    | 'shift'
    | 'sale'
    | 'order'
    | 'receipt'
    | 'issue'
    | 'transfer'
    | 'adjustment'
    | 'stocktake';
  id: number;
};

/** The panel of a stock document by the ledger's document code (`stockDocHref`'s pages). */
export function stockDocPeek(
  docType: string,
  docId: number,
  invoiceId?: number | null,
): RecordPeek | null {
  switch (docType) {
    case 'GR':
      return { kind: 'receipt', id: docId };
    case 'GI':
      return { kind: 'issue', id: docId };
    case 'TR':
      return { kind: 'transfer', id: docId };
    case 'ADJ':
      return { kind: 'adjustment', id: docId };
    case 'ST':
      return { kind: 'stocktake', id: docId };
    case 'SO':
      return { kind: 'order', id: docId };
    case 'POS':
      return { kind: 'sale', id: docId };
    case 'CN':
      return invoiceId ? { kind: 'invoice', id: invoiceId } : null;
    default:
      return null;
  }
}

/** The panel a journal line opens: its voucher, invoice, receipt, issue, shift or stock document. */
export function ledgerLinePeek(line: LedgerLine): RecordPeek | null {
  const entry: RecordPeek = { kind: 'entry', id: line.entryId };
  if (line.system === 'FIN') {
    if ((line.sourceDocType === 'RECEIPT' || line.sourceDocType === 'PAYMENT') && line.documentId) {
      return { kind: 'payment', id: line.documentId };
    }
    return entry;
  }
  const id = idOf(line.sourceDocId);
  switch (line.sourceDocType) {
    case 'SALES_INVOICE':
      return id ? { kind: 'invoice', id } : entry;
    case 'GOODS_RECEIPT':
    case 'RECEIPT_RECOST':
    case 'STOCK_REVALUE':
      return id ? { kind: 'receipt', id } : entry;
    case 'SUPPLIER_RETURN':
    case 'DAMAGE_CHARGE':
      return id ? { kind: 'issue', id } : entry;
    case 'POS_SHIFT':
      return id ? { kind: 'shift', id } : entry;
    case 'STOCK': {
      const match = /^([A-Z]+):(\d+):/.exec(line.sourceDocId ?? '');
      const peek =
        match?.[1] && match[2] ? stockDocPeek(match[1], Number.parseInt(match[2], 10)) : null;
      return peek ?? entry;
    }
    default:
      return entry;
  }
}

/** The panel of a sales document of «Борлуулалт /Бараагаар/». */
export function salesDocPeek(doc: ProductSalesDocument): RecordPeek | null {
  switch (doc.kind) {
    case 'INVOICE':
      return { kind: 'invoice', id: doc.id };
    case 'CREDIT_NOTE':
      return doc.invoiceId ? { kind: 'invoice', id: doc.invoiceId } : null;
    case 'POS_SALE':
    case 'POS_RETURN':
      return { kind: 'sale', id: doc.id };
    default:
      return null;
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
