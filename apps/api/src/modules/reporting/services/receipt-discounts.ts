import { receiptDiscountOutsideCost, receiptLineVat } from '@tugeel/shared/inventory';
import { Decimal, type DecimalInput } from '@tugeel/shared/money';

const ZERO = new Decimal(0);

/**
 * What one costing row of a receipt line books as income on «Худалдан авалтын хөнгөлөлт» (ADR-0236
 * #1), as the receipt's bill works it out (`ReceiptsService.bookFacts`): a line that keeps its
 * discount out of its cost brings its cost plus the VAT inside what is owed for it, less what is
 * owed — its discount without the VAT that is not taken back on it. A line costed before ADR-0236
 * (the discount inside its cost), free goods and a line without a discount bring nothing.
 */
export function discountIncome(
  row: {
    docAmount: DecimalInput | null;
    discountAmount: DecimalInput | null;
    amount: DecimalInput;
    freeGoods: boolean;
  },
  receiptVatRatePct: DecimalInput,
): Decimal {
  if (row.freeGoods) return ZERO;
  const outside = receiptDiscountOutsideCost(row, receiptVatRatePct);
  if (!outside || row.docAmount === null) return ZERO;
  const owed = new Decimal(row.docAmount).minus(row.discountAmount ?? 0);
  return new Decimal(row.amount).plus(receiptLineVat(owed, outside.vatRatePct)).minus(owed);
}

/** A payable entry of the supplier report as far as a receipt's discount is concerned (ADR-0234). */
export interface ReceiptEntryRef {
  entryId: number;
  sourceDocType: unknown;
  sourceDocId: string | null;
  reversal: boolean;
}

/** One costing version's row of a receipt line (`stock_valuation_adjustments`, doc type GR). */
export interface ReceiptCostingRow {
  receiptId: number;
  lineId: number;
  version: number;
  /** The line's share of the delivery note's discounts at this version, VAT included; null: none. */
  discount: Decimal | null;
  freeGoods: boolean;
}

/**
 * The goods receipt behind a payable entry: the bill `GOODS_RECEIPT/<id>` (`version` null: the
 * version it was booked at is worked out from its re-costings) or a re-costing's difference
 * `RECEIPT_RECOST/<id>:<version>`; null for anything else.
 */
export function receiptOfEntry(
  sourceDocType: unknown,
  sourceDocId: string | null,
): { receiptId: number; version: number | null } | null {
  const match = /^(\d+)(?::(\d+))?$/.exec(sourceDocId ?? '');
  if (!match?.[1]) return null;
  const receiptId = Number.parseInt(match[1], 10);
  if (sourceDocType === 'GOODS_RECEIPT') return { receiptId, version: null };
  if (sourceDocType === 'RECEIPT_RECOST' && match[2]) {
    return { receiptId, version: Number.parseInt(match[2], 10) };
  }
  return null;
}

/**
 * A receipt's discount at each of its costing versions: Σ over its lines of the share at the
 * latest version up to it (free goods carry none), as the books' payable is worked out.
 */
function discountsByVersion(rows: readonly ReceiptCostingRow[]): [number, Decimal][] {
  const versions = [...new Set(rows.map((row) => row.version))].sort((a, b) => a - b);
  const lines = new Map<number, Decimal>();
  return versions.map((version) => {
    for (const row of rows) {
      if (row.version !== version) continue;
      lines.set(row.lineId, row.freeGoods ? ZERO : (row.discount ?? ZERO));
    }
    return [version, [...lines.values()].reduce((sum, value) => sum.plus(value), ZERO)];
  });
}

/** The discount at `version`: the latest costing up to it (0 before the first). */
function discountAt(byVersion: readonly [number, Decimal][], version: number): Decimal {
  let found = ZERO;
  for (const [v, discount] of byVersion) {
    if (v > version) break;
    found = discount;
  }
  return found;
}

/**
 * The receipt discount each payable entry carries (ADR-0234), so that the entry's amount before
 * the discount is `amount + discount`:
 * - a receipt's bill carries its discount at the version it was booked at: version 1 when
 *   re-costings followed it (the first of them less one), else the receipt's latest costing (the
 *   development re-post booked a bill at the latest version);
 * - a re-costing's difference carries the change of the discount since the version booked before
 *   it, so a receipt's entries together carry its latest booked discount;
 * - a reversal carries its original's with the sign turned; an entry of no receipt carries none.
 */
export function entryDiscounts(
  entries: readonly ReceiptEntryRef[],
  costing: readonly ReceiptCostingRow[],
): Map<number, Decimal> {
  const rowsByReceipt = new Map<number, ReceiptCostingRow[]>();
  for (const row of costing) {
    rowsByReceipt.set(row.receiptId, [...(rowsByReceipt.get(row.receiptId) ?? []), row]);
  }
  const byReceipt = new Map<number, { entry: ReceiptEntryRef; version: number | null }[]>();
  for (const entry of entries) {
    const receipt = receiptOfEntry(entry.sourceDocType, entry.sourceDocId);
    if (!receipt) continue;
    byReceipt.set(receipt.receiptId, [
      ...(byReceipt.get(receipt.receiptId) ?? []),
      { entry, version: receipt.version },
    ]);
  }
  const out = new Map<number, Decimal>();
  for (const [receiptId, list] of byReceipt) {
    const byVersion = discountsByVersion(rowsByReceipt.get(receiptId) ?? []);
    const recosts = list.flatMap((item) => (item.version === null ? [] : [item.version]));
    const latest = byVersion.at(-1)?.[0] ?? 0;
    const billVersion = recosts.length > 0 ? Math.min(...recosts) - 1 : latest;
    const hasBill = list.some((item) => item.version === null);
    const booked = [...new Set([...(hasBill ? [billVersion] : []), ...recosts])].sort(
      (a, b) => a - b,
    );
    const change = (version: number): Decimal => {
      const before = booked.filter((v) => v < version).at(-1);
      const base = before === undefined ? ZERO : discountAt(byVersion, before);
      return discountAt(byVersion, version).minus(base);
    };
    for (const { entry, version } of list) {
      const discount = change(version ?? billVersion);
      out.set(entry.entryId, entry.reversal ? discount.negated() : discount);
    }
  }
  return out;
}
