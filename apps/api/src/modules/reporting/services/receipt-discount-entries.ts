import type { Decimal } from '@tugeel/shared/money';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../../common/db/db.types';
import { discountIncome, entryDiscounts, receiptOfEntry } from './receipt-discounts';
import type { DateRange } from './report-periods';
import { dec, decOrNull, int, intOrNull, rowsOf, scalar, textOrNull } from './report-sql';

/**
 * What a receipt's discount is measured as:
 * - `note`: the delivery note's discount, VAT included (the supplier report's view, ADR-0234);
 * - `income`: what the books credit to «Худалдан авалтын хөнгөлөлт» for it (ADR-0236): the
 *   discount without its VAT, and nothing for a receipt costed with its discount inside its cost.
 */
export type DiscountMeasure = 'note' | 'income';

export interface ReceiptDiscountEntry {
  entryId: number;
  partyId: number;
  supplierId: number | null;
  /** The entry's date. */
  date: string;
  /** The entry is dated in the range (the others only measure a re-costing's change). */
  inRange: boolean;
  discount: Decimal;
}

const RECEIPT_DOC_TYPES = sql`('GOODS_RECEIPT', 'RECEIPT_RECOST')`;

/**
 * The receipt discount of every payable entry of the receipts booked in the period (ADR-0234), of
 * one party or all: the receipts' entries of every date (a re-costing's change is measured from the
 * version booked before it), with `inRange` on those of the period. With `branchId` only the
 * receipt lines whose warehouse belongs to that branch count.
 */
export async function receiptDiscountEntries(
  db: Db,
  company: string,
  range: DateRange,
  options: { partyId?: number | null; measure: DiscountMeasure; branchId?: number | null },
): Promise<ReceiptDiscountEntry[]> {
  const party =
    options.partyId === null || options.partyId === undefined
      ? sql`TRUE`
      : sql`e.party_id = ${options.partyId}`;
  const entries = await rowsOf(
    db,
    sql`WITH receipts AS MATERIALIZED (
          SELECT e.entry_id, e.party_id, e.supplier_id, e.entry_date, e.source_doc_type, e.source_doc_id,
                 e.is_reversal, split_part(e.source_doc_id, ':', 1) AS receipt_key
            FROM reporting.ap_entries e
           WHERE e.company_code = ${company} AND ${party}
             AND e.source_doc_type IN ${RECEIPT_DOC_TYPES}
             AND e.source_doc_id ~ '^[0-9]+(:[0-9]+)?$')
        SELECT r.entry_id, r.party_id, r.supplier_id, r.source_doc_type, r.source_doc_id, r.is_reversal,
               r.entry_date::text AS entry_date, r.entry_date BETWEEN ${range.from}::date AND ${range.to}::date AS in_range
          FROM receipts r
         WHERE r.receipt_key IN (
                 SELECT p.receipt_key FROM receipts p
                  WHERE p.entry_date BETWEEN ${range.from}::date AND ${range.to}::date)`,
  );
  if (entries.length === 0) return [];
  const ids = [
    ...new Set(
      entries.flatMap((row) => {
        const receipt = receiptOfEntry(row.source_doc_type, textOrNull(row.source_doc_id));
        return receipt ? [receipt.receiptId] : [];
      }),
    ),
  ];
  const branch: SQL =
    options.branchId === null || options.branchId === undefined
      ? sql`TRUE`
      : sql`s.warehouse_id IN (SELECT w.id FROM public.warehouses w WHERE w.branch_id = ${options.branchId})`;
  const costing = await rowsOf(
    db,
    sql`SELECT s.doc_id, s.doc_line_id, s.version, s.discount_amount, s.free_goods, s.amount, s.doc_amount,
               g.vat_rate_pct
          FROM public.stock_valuation_adjustments s
          JOIN public.goods_receipts g ON g.id = s.doc_id
         WHERE s.doc_type = 'GR' AND s.doc_id = ANY(${`{${ids.join(',')}}`}::bigint[]) AND ${branch}`,
  );
  const discounts = entryDiscounts(
    entries.map((row) => ({
      entryId: int(row.entry_id),
      sourceDocType: row.source_doc_type,
      sourceDocId: textOrNull(row.source_doc_id),
      reversal: row.is_reversal === true,
    })),
    costing.map((row) => {
      const freeGoods = row.free_goods === true;
      return {
        receiptId: int(row.doc_id),
        lineId: int(row.doc_line_id),
        version: int(row.version),
        discount:
          options.measure === 'note'
            ? decOrNull(row.discount_amount)
            : discountIncome(
                {
                  amount: dec(row.amount),
                  docAmount: decOrNull(row.doc_amount),
                  discountAmount: decOrNull(row.discount_amount),
                  freeGoods,
                },
                dec(row.vat_rate_pct),
              ),
        freeGoods,
      };
    }),
  );
  return entries.map((row) => ({
    entryId: int(row.entry_id),
    partyId: int(row.party_id),
    supplierId: intOrNull(row.supplier_id),
    date: scalar(row.entry_date).slice(0, 10),
    inRange: row.in_range === true,
    discount: discounts.get(int(row.entry_id)) ?? dec(0),
  }));
}
