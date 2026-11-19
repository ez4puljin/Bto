import {
  isMaskedTaxId,
  normalizeTaxId,
  periodDays,
  periodOfDate,
} from '@tugeel/shared/ebarimt-check';
import { Decimal, toMoney } from '@tugeel/shared/money';
import { addDays } from '@tugeel/shared/time';
import type { EbarimtPurchase } from '../../../integrations/ebarimt';
import type { EbarimtSheet, EbarimtSheetRow } from './ebarimt-sheet';

/** The money columns hold NUMERIC(14,2): anything from here up does not fit. */
const AMOUNT_LIMIT = new Decimal('1000000000000');

/** The service answers at most this many days at once well: it has no paging (ADR-0228). */
export const EBARIMT_PULL_WINDOW_DAYS = 7;

export interface EbarimtPulledSheet extends EbarimtSheet {
  /** Lines whose seller's register came hidden by stars, kept as they came. */
  masked: number;
  /** Lines with no register or no day of this month: not the month's, left out. */
  skipped: number;
}

/** A line the month cannot hold: an amount past what the books store. */
export class EbarimtLineError extends Error {}

/** `from`…`to` in spans of at most a week, in order; both ends included. */
export function pullWindows(from: string, to: string): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, EBARIMT_PULL_WINDOW_DAYS)) {
    const stop = addDays(start, EBARIMT_PULL_WINDOW_DAYS - 1);
    windows.push({ from: start, to: stop < to ? stop : to });
  }
  return windows;
}

/**
 * A month's receipts from e-Barimt's API as the lines of a file (ADR-0228): ДДТД, the seller's
 * register and name, the day, VAT, net and total rounded to two decimals half up, and «Төрөл» from
 * the receipt's type, else where it was printed. No delivery note comes, so the key is the ДДТД,
 * else the day, the register and the total, as for a file. A register hidden by stars is kept as
 * it came and counted; a receipt listed twice is one line.
 */
export function sheetOfPurchases(
  period: number,
  purchases: readonly EbarimtPurchase[],
): EbarimtPulledSheet {
  const { from, to } = periodDays(period);
  const byKey = new Map<string, Omit<EbarimtSheetRow, 'rowNo'>>();
  let skipped = 0;
  for (const purchase of purchases) {
    const docDate = (purchase.date ?? '').slice(0, 10);
    const written = (purchase.sellerRegNo ?? '').trim();
    const ttd = isMaskedTaxId(written) ? written : normalizeTaxId(written);
    if (ttd === '' || periodOfDate(docDate) !== period || docDate < from || docDate > to) {
      skipped += 1;
      continue;
    }
    const total = toMoney(purchase.total);
    const vat = toMoney(purchase.vat);
    const net = toMoney(purchase.net);
    if ([total, vat, net].some((amount) => amount.abs().greaterThanOrEqualTo(AMOUNT_LIMIT))) {
      throw new EbarimtLineError(`a receipt of ${docDate} holds an amount past what fits`);
    }
    const ddtd = purchase.ddtd;
    const receiptKey = ddtd ?? `P|${docDate}|${ttd}|${total.toFixed(2)}`;
    if (byKey.has(receiptKey)) continue;
    byKey.set(receiptKey, {
      receiptKey,
      ddtd,
      deliveryNoteNo: null,
      docDate,
      partnerName: purchase.sellerName,
      ttd,
      vatAmount: vat,
      netAmount: net,
      totalAmount: total,
      kind: purchase.receiptType ?? purchase.fromType,
    });
  }
  const rows = [...byKey.values()]
    .sort((a, b) =>
      a.docDate === b.docDate
        ? a.receiptKey.localeCompare(b.receiptKey)
        : a.docDate.localeCompare(b.docDate),
    )
    .map((row, index) => ({ ...row, rowNo: index + 1 }));
  return {
    period,
    rows,
    vatAmount: rows.reduce((sum, row) => sum.plus(row.vatAmount), new Decimal(0)),
    totalAmount: rows.reduce((sum, row) => sum.plus(row.totalAmount), new Decimal(0)),
    masked: rows.filter((row) => isMaskedTaxId(row.ttd)).length,
    skipped,
  };
}
